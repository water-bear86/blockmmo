//! Instruction-level integration tests for the settlement program (issue #36 / PRD F6).
//! Exercises the compiled `.so` in litesvm: the F6.3 pause gate, and the atomic 50/35/15
//! split with a true SPL burn (F5.4 / F6.2).
mod common;

use anchor_lang::{InstructionData, ToAccountMetas};
use common::*;
use litesvm::LiteSVM;
use solana_sdk::{
    instruction::Instruction, pubkey::Pubkey, signature::Keypair, signer::Signer, system_program,
};

const SO: &[u8] = include_bytes!("../../target/deploy/runechain_settlement.so");
const DECIMALS: u8 = 9;

fn pid() -> Pubkey {
    runechain_settlement::ID
}
fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"config"], &pid()).0
}

fn setup() -> LiteSVM {
    let mut svm = LiteSVM::new();
    svm.add_program(pid(), SO);
    svm
}

fn init_config(svm: &mut LiteSVM, admin: &Keypair, marketing: Pubkey, ops: Pubkey) {
    let ix = Instruction {
        program_id: pid(),
        accounts: runechain_settlement::accounts::InitConfig {
            config: config_pda(),
            authority: admin.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: runechain_settlement::instruction::InitConfig { marketing, ops }.data(),
    };
    send_ok(svm, admin, &[admin], &[ix]);
}

fn set_paused(svm: &mut LiteSVM, admin: &Keypair, paused: bool) {
    let ix = Instruction {
        program_id: pid(),
        accounts: runechain_settlement::accounts::AdminOnly {
            config: config_pda(),
            authority: admin.pubkey(),
        }
        .to_account_metas(None),
        data: runechain_settlement::instruction::SetPaused { paused }.data(),
    };
    send_ok(svm, admin, &[admin], &[ix]);
}

#[allow(clippy::too_many_arguments)]
fn purchase_ix(
    buyer: &Keypair,
    mint: Pubkey,
    buyer_token: Pubkey,
    marketing_token: Pubkey,
    ops_token: Pubkey,
    amount: u64,
) -> Instruction {
    Instruction {
        program_id: pid(),
        accounts: runechain_settlement::accounts::PurchaseGold {
            config: config_pda(),
            buyer: buyer.pubkey(),
            mint,
            buyer_token,
            marketing_token,
            ops_token,
            token_program: spl_token::id(),
        }
        .to_account_metas(None),
        data: runechain_settlement::instruction::PurchaseGold { amount }.data(),
    }
}

/// Build the token world: a settled mint, a funded buyer token account, and marketing/ops
/// destination accounts owned by the configured pubkeys.
fn token_world(
    svm: &mut LiteSVM,
    admin: &Keypair,
    buyer: &Keypair,
    mkt_owner: &Pubkey,
    ops_owner: &Pubkey,
    amount: u64,
) -> (Pubkey, Pubkey, Pubkey, Pubkey) {
    let mint = create_mint(svm, admin, &admin.pubkey(), DECIMALS);
    let buyer_token = create_token_account(svm, admin, &mint, &buyer.pubkey());
    mint_to(svm, admin, &mint, &buyer_token, admin, amount);
    let mkt_token = create_token_account(svm, admin, &mint, mkt_owner);
    let ops_token = create_token_account(svm, admin, &mint, ops_owner);
    (mint, buyer_token, mkt_token, ops_token)
}

#[test]
fn init_config_starts_paused_with_full_bps() {
    let mut svm = setup();
    let admin = funded(&mut svm, 100_000_000_000);
    init_config(&mut svm, &admin, Pubkey::new_unique(), Pubkey::new_unique());

    let cfg: runechain_settlement::Config = load(&svm, &config_pda());
    assert!(cfg.paused, "F6.3: settlement must start PAUSED");
    assert_eq!(cfg.burn_bps + cfg.marketing_bps + cfg.ops_bps, 10_000, "F5.4: split is exhaustive");
}

#[test]
fn purchase_reverts_while_paused() {
    let mut svm = setup();
    let admin = funded(&mut svm, 100_000_000_000);
    let buyer = funded(&mut svm, 100_000_000_000);
    let mkt_owner = Pubkey::new_unique();
    let ops_owner = Pubkey::new_unique();
    init_config(&mut svm, &admin, mkt_owner, ops_owner);
    // default config is paused; do NOT unpause.
    let amount = 1_000_000u64;
    let (mint, buyer_token, mkt_token, ops_token) =
        token_world(&mut svm, &admin, &buyer, &mkt_owner, &ops_owner, amount);

    let ix = purchase_ix(&buyer, mint, buyer_token, mkt_token, ops_token, amount);
    assert!(
        send(&mut svm, &buyer, &[&buyer], &[ix]).is_err(),
        "F6.3: purchase must revert while paused (legal go-live gate)"
    );
    // No partial state: nothing moved.
    assert_eq!(token_amount(&svm, &buyer_token), amount, "buyer untouched");
    assert_eq!(mint_supply(&svm, &mint), amount, "supply untouched");
}

#[test]
fn purchase_executes_atomic_50_35_15_with_true_burn() {
    let mut svm = setup();
    let admin = funded(&mut svm, 100_000_000_000);
    let buyer = funded(&mut svm, 100_000_000_000);
    let mkt_owner = Pubkey::new_unique();
    let ops_owner = Pubkey::new_unique();
    init_config(&mut svm, &admin, mkt_owner, ops_owner);
    set_paused(&mut svm, &admin, false);

    let amount = 1_000_000u64;
    let (mint, buyer_token, mkt_token, ops_token) =
        token_world(&mut svm, &admin, &buyer, &mkt_owner, &ops_owner, amount);
    assert_eq!(mint_supply(&svm, &mint), amount);

    let ix = purchase_ix(&buyer, mint, buyer_token, mkt_token, ops_token, amount);
    send_ok(&mut svm, &buyer, &[&buyer], &[ix]);

    // F5.4 split lands exactly; F6.1 atomicity means the legs reconstruct the input.
    assert_eq!(token_amount(&svm, &mkt_token), 350_000, "35% -> marketing");
    assert_eq!(token_amount(&svm, &ops_token), 150_000, "15% -> ops");
    assert_eq!(token_amount(&svm, &buyer_token), 0, "buyer spends the full amount");
    // F6.2 true burn: the 50% leg reduces supply (not parked at an incinerator).
    assert_eq!(mint_supply(&svm, &mint), amount - 500_000, "burn reduces supply");
}
