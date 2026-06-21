//! Shared litesvm helpers for the RUNECHAIN program integration tests.
//!
//! These run the COMPILED `.so` programs in an in-process SVM (no validator), so they exercise
//! the real instruction handlers, account constraints, and CPIs — not just the pure helpers the
//! unit tests cover. Host-only: the SVM runtime needs native OpenSSL, so these run on Linux/CI
//! (see `.github/workflows/contracts.yml`), not on a bare Windows dev box.
#![allow(dead_code)]

use anchor_lang::AccountDeserialize;
use litesvm::types::{FailedTransactionMetadata, TransactionMetadata};
use litesvm::LiteSVM;
use solana_sdk::{
    instruction::Instruction, program_pack::Pack, pubkey::Pubkey, rent::Rent, signature::Keypair,
    signer::Signer, system_instruction, transaction::Transaction,
};

/// Send a transaction, deduplicating signers by pubkey (so passing the same keypair as both
/// payer and authority is harmless). Returns the SVM result so callers can assert success/revert.
pub fn send(
    svm: &mut LiteSVM,
    payer: &Keypair,
    signers: &[&Keypair],
    ixs: &[Instruction],
) -> Result<TransactionMetadata, FailedTransactionMetadata> {
    let mut uniq: Vec<&Keypair> = Vec::new();
    for s in signers {
        if !uniq.iter().any(|k| k.pubkey() == s.pubkey()) {
            uniq.push(s);
        }
    }
    let bh = svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(ixs, Some(&payer.pubkey()), &uniq, bh);
    svm.send_transaction(tx)
}

pub fn send_ok(svm: &mut LiteSVM, payer: &Keypair, signers: &[&Keypair], ixs: &[Instruction]) {
    send(svm, payer, signers, ixs).expect("transaction should succeed");
}

/// A new keypair pre-funded with `lamports`.
pub fn funded(svm: &mut LiteSVM, lamports: u64) -> Keypair {
    let kp = Keypair::new();
    svm.airdrop(&kp.pubkey(), lamports).unwrap();
    kp
}

pub fn create_mint(svm: &mut LiteSVM, payer: &Keypair, authority: &Pubkey, decimals: u8) -> Pubkey {
    let mint = Keypair::new();
    let rent = Rent::default().minimum_balance(spl_token::state::Mint::LEN);
    let create = system_instruction::create_account(
        &payer.pubkey(),
        &mint.pubkey(),
        rent,
        spl_token::state::Mint::LEN as u64,
        &spl_token::id(),
    );
    let init =
        spl_token::instruction::initialize_mint(&spl_token::id(), &mint.pubkey(), authority, None, decimals)
            .unwrap();
    send_ok(svm, payer, &[payer, &mint], &[create, init]);
    mint.pubkey()
}

pub fn create_token_account(svm: &mut LiteSVM, payer: &Keypair, mint: &Pubkey, owner: &Pubkey) -> Pubkey {
    let acc = Keypair::new();
    let rent = Rent::default().minimum_balance(spl_token::state::Account::LEN);
    let create = system_instruction::create_account(
        &payer.pubkey(),
        &acc.pubkey(),
        rent,
        spl_token::state::Account::LEN as u64,
        &spl_token::id(),
    );
    let init =
        spl_token::instruction::initialize_account(&spl_token::id(), &acc.pubkey(), mint, owner).unwrap();
    send_ok(svm, payer, &[payer, &acc], &[create, init]);
    acc.pubkey()
}

pub fn mint_to(svm: &mut LiteSVM, payer: &Keypair, mint: &Pubkey, dest: &Pubkey, authority: &Keypair, amount: u64) {
    let ix =
        spl_token::instruction::mint_to(&spl_token::id(), mint, dest, &authority.pubkey(), &[], amount)
            .unwrap();
    send_ok(svm, payer, &[payer, authority], &[ix]);
}

pub fn token_amount(svm: &LiteSVM, account: &Pubkey) -> u64 {
    let acc = svm.get_account(account).expect("token account exists");
    spl_token::state::Account::unpack(&acc.data).unwrap().amount
}

pub fn mint_supply(svm: &LiteSVM, mint: &Pubkey) -> u64 {
    let acc = svm.get_account(mint).expect("mint exists");
    spl_token::state::Mint::unpack(&acc.data).unwrap().supply
}

/// Deserialize an Anchor account (discriminator-checked) from the SVM.
pub fn load<T: AccountDeserialize>(svm: &LiteSVM, key: &Pubkey) -> T {
    let acc = svm.get_account(key).expect("account exists");
    T::try_deserialize(&mut acc.data.as_slice()).expect("decode account")
}
