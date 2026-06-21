//! Instruction-level integration tests for the character program (issue #37 / PRD F7).
//! Exercises the compiled `.so` in litesvm: the F7.3 transfer gate (can't list mid-season or
//! with tasks unfinished), the escrow-gated sale, and the F7.3-rule-3 seller-restart flag.
mod common;

use anchor_lang::{InstructionData, ToAccountMetas};
use common::*;
use litesvm::LiteSVM;
use solana_sdk::{
    instruction::Instruction, pubkey::Pubkey, signature::Keypair, signer::Signer, system_program,
    sysvar,
};

const SO: &[u8] = include_bytes!("../../target/deploy/runechain_character.so");

fn pid() -> Pubkey {
    runechain_character::ID
}
fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[b"config"], &pid()).0
}
fn season_pda(id: u64) -> Pubkey {
    Pubkey::find_program_address(&[b"season", &id.to_le_bytes()], &pid()).0
}
fn character_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"character", mint.as_ref()], &pid()).0
}
fn listing_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"listing", mint.as_ref()], &pid()).0
}
fn escrow_auth_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"escrow-auth", mint.as_ref()], &pid()).0
}
fn escrow_token_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[b"escrow", mint.as_ref()], &pid()).0
}

fn setup() -> LiteSVM {
    let mut svm = LiteSVM::new();
    svm.add_program(pid(), SO);
    svm
}

fn init_config(svm: &mut LiteSVM, admin: &Keypair, oracle: Pubkey) {
    let ix = Instruction {
        program_id: pid(),
        accounts: runechain_character::accounts::InitConfig {
            config: config_pda(),
            authority: admin.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: runechain_character::instruction::InitConfig { oracle }.data(),
    };
    send_ok(svm, admin, &[admin], &[ix]);
}

fn set_paused(svm: &mut LiteSVM, admin: &Keypair, paused: bool) {
    let ix = Instruction {
        program_id: pid(),
        accounts: runechain_character::accounts::AdminOnly {
            config: config_pda(),
            authority: admin.pubkey(),
        }
        .to_account_metas(None),
        data: runechain_character::instruction::SetPaused { paused }.data(),
    };
    send_ok(svm, admin, &[admin], &[ix]);
}

fn set_season(svm: &mut LiteSVM, admin: &Keypair, season_id: u64, open: bool) {
    let ix = Instruction {
        program_id: pid(),
        accounts: runechain_character::accounts::SetSeason {
            config: config_pda(),
            season: season_pda(season_id),
            authority: admin.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: runechain_character::instruction::SetSeason { season_id, open }.data(),
    };
    send_ok(svm, admin, &[admin], &[ix]);
}

fn register_character(svm: &mut LiteSVM, owner: &Keypair, mint: Pubkey, season_id: u64) {
    let ix = Instruction {
        program_id: pid(),
        accounts: runechain_character::accounts::RegisterCharacter {
            character_state: character_pda(&mint),
            mint,
            owner: owner.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: runechain_character::instruction::RegisterCharacter { season_id }.data(),
    };
    send_ok(svm, owner, &[owner], &[ix]);
}

fn mark_complete(svm: &mut LiteSVM, oracle: &Keypair, mint: Pubkey, season_id: u64) {
    let ix = Instruction {
        program_id: pid(),
        accounts: runechain_character::accounts::MarkComplete {
            config: config_pda(),
            character_state: character_pda(&mint),
            season: season_pda(season_id),
            oracle: oracle.pubkey(),
        }
        .to_account_metas(None),
        data: runechain_character::instruction::MarkComplete {}.data(),
    };
    send_ok(svm, oracle, &[oracle], &[ix]);
}

fn list_ix(seller: &Keypair, mint: Pubkey, seller_token: Pubkey, season_id: u64, price: u64) -> Instruction {
    Instruction {
        program_id: pid(),
        accounts: runechain_character::accounts::ListForSale {
            config: config_pda(),
            season: season_pda(season_id),
            character_state: character_pda(&mint),
            listing: listing_pda(&mint),
            mint,
            escrow_authority: escrow_auth_pda(&mint),
            escrow_token: escrow_token_pda(&mint),
            seller_token,
            owner: seller.pubkey(),
            seller: seller.pubkey(),
            token_program: spl_token::id(),
            system_program: system_program::ID,
            rent: sysvar::rent::ID,
        }
        .to_account_metas(None),
        data: runechain_character::instruction::ListForSale { price }.data(),
    }
}

fn buy_ix(buyer: &Keypair, seller: Pubkey, mint: Pubkey, buyer_token: Pubkey) -> Instruction {
    Instruction {
        program_id: pid(),
        accounts: runechain_character::accounts::Buy {
            config: config_pda(),
            listing: listing_pda(&mint),
            character_state: character_pda(&mint),
            mint,
            escrow_authority: escrow_auth_pda(&mint),
            escrow_token: escrow_token_pda(&mint),
            buyer_token,
            buyer: buyer.pubkey(),
            seller,
            token_program: spl_token::id(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
        data: runechain_character::instruction::Buy {}.data(),
    }
}

struct World {
    svm: LiteSVM,
    admin: Keypair,
    oracle: Keypair,
    seller: Keypair,
    buyer: Keypair,
    mint: Pubkey,
    seller_token: Pubkey,
    season_id: u64,
}

/// Unpaused config, an OPEN season, a 1-supply NFT held by the seller, and a registered
/// character with tasks NOT yet complete.
fn base() -> World {
    let mut svm = setup();
    let admin = funded(&mut svm, 100_000_000_000);
    let oracle = funded(&mut svm, 100_000_000_000);
    let seller = funded(&mut svm, 100_000_000_000);
    let buyer = funded(&mut svm, 100_000_000_000);
    init_config(&mut svm, &admin, oracle.pubkey());
    set_paused(&mut svm, &admin, false);
    let season_id = 1u64;
    set_season(&mut svm, &admin, season_id, true);
    let mint = create_mint(&mut svm, &admin, &admin.pubkey(), 0);
    let seller_token = create_token_account(&mut svm, &admin, &mint, &seller.pubkey());
    mint_to(&mut svm, &admin, &mint, &seller_token, &admin, 1);
    register_character(&mut svm, &seller, mint, season_id);
    World { svm, admin, oracle, seller, buyer, mint, seller_token, season_id }
}

#[test]
fn list_reverts_with_tasks_unfinished() {
    let mut w = base();
    // F7.3 rule 2: tasks not done -> cannot list.
    let ix = list_ix(&w.seller, w.mint, w.seller_token, w.season_id, 1_000);
    assert!(send(&mut w.svm, &w.seller, &[&w.seller], &[ix]).is_err(), "tasks unfinished must revert");
    assert_eq!(token_amount(&w.svm, &w.seller_token), 1, "NFT stays with seller");
}

#[test]
fn list_reverts_mid_season() {
    let mut w = base();
    mark_complete(&mut w.svm, &w.oracle, w.mint, w.season_id); // tasks done, but window still open
    // F7.3 rule 1: season still open -> cannot list even when complete.
    let ix = list_ix(&w.seller, w.mint, w.seller_token, w.season_id, 1_000);
    assert!(send(&mut w.svm, &w.seller, &[&w.seller], &[ix]).is_err(), "mid-season must revert");
}

#[test]
fn sale_releases_escrow_and_flags_seller_restart() {
    let mut w = base();
    mark_complete(&mut w.svm, &w.oracle, w.mint, w.season_id);
    set_season(&mut w.svm, &w.admin, w.season_id, false); // close the window -> now sellable

    // List: NFT moves into program escrow.
    let ix = list_ix(&w.seller, w.mint, w.seller_token, w.season_id, 5_000);
    send_ok(&mut w.svm, &w.seller, &[&w.seller], &[ix]);
    assert_eq!(token_amount(&w.svm, &w.seller_token), 0, "NFT left the seller");
    assert_eq!(token_amount(&w.svm, &escrow_token_pda(&w.mint)), 1, "NFT is in escrow");

    // Buy: pays seller, releases escrow to buyer, flags seller restart, moves ownership.
    let buyer_token = create_token_account(&mut w.svm, &w.admin, &w.mint, &w.buyer.pubkey());
    let buy = buy_ix(&w.buyer, w.seller.pubkey(), w.mint, buyer_token);
    send_ok(&mut w.svm, &w.buyer, &[&w.buyer], &[buy]);

    assert_eq!(token_amount(&w.svm, &buyer_token), 1, "buyer received the NFT");
    assert_eq!(token_amount(&w.svm, &escrow_token_pda(&w.mint)), 0, "escrow released");
    // Anchor `close` drains lamports + zeroes the account; litesvm keeps the 0-lamport husk
    // (a real validator purges it), so "closed" == gone-or-zero-lamports.
    let listing_after = w.svm.get_account(&listing_pda(&w.mint));
    assert!(listing_after.map_or(true, |a| a.lamports == 0), "listing closed");

    let cs: runechain_character::CharacterState = load(&w.svm, &character_pda(&w.mint));
    assert!(cs.must_restart, "F7.3 rule 3: seller flagged to restart at zero");
    assert_eq!(cs.owner, w.buyer.pubkey(), "ownership moved to the buyer");
    assert!(!cs.tasks_done, "buyer must re-earn eligibility; power is never inherited");
}

#[test]
fn buy_reverts_while_paused() {
    let mut w = base();
    mark_complete(&mut w.svm, &w.oracle, w.mint, w.season_id);
    set_season(&mut w.svm, &w.admin, w.season_id, false);
    let ix = list_ix(&w.seller, w.mint, w.seller_token, w.season_id, 5_000);
    send_ok(&mut w.svm, &w.seller, &[&w.seller], &[ix]);

    // Re-pause (legal gate) -> buy must revert (F6.3/F7).
    set_paused(&mut w.svm, &w.admin, true);
    let buyer_token = create_token_account(&mut w.svm, &w.admin, &w.mint, &w.buyer.pubkey());
    let buy = buy_ix(&w.buyer, w.seller.pubkey(), w.mint, buyer_token);
    assert!(send(&mut w.svm, &w.buyer, &[&w.buyer], &[buy]).is_err(), "paused sale must revert");
    assert_eq!(token_amount(&w.svm, &escrow_token_pda(&w.mint)), 1, "NFT stays in escrow");
}
