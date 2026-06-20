//! RUNECHAIN real-money settlement (PRD F6).
//!
//! A single, atomic instruction routes a wrapped-SOL (or whichever mint is settled in,
//! Q-F6b) payment three ways — **50% true SPL burn · 35% marketing · 15% ops** (F5.4) — and
//! emits a `GoldPurchased` event the authoritative Chainwell server reconciles to credit
//! Gold off-chain (S1.2 seam). Gold is **never minted here**; this program only moves the
//! real-money leg and proves the split happened.
//!
//! Invariants:
//! - F6.1 Atomicity: all three legs happen in one instruction, or the tx reverts. A partial
//!   split is impossible.
//! - F6.2 True burn: `burn` (SPL Burn) reduces supply, not the incinerator address.
//! - F6.3 Go-live gate: `Config.paused` starts `true`. Flipping it live is a hard
//!   legal/compliance precondition, performed by the admin via `set_paused` — not a date.
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, TransferChecked};

declare_id!("A7A2G4qnQaKBZiCqUPtuNbeDrvdPGK4gE9wip61dXPpN");

/// F5.4 split, in basis points. Must sum to 10_000.
pub const BURN_BPS: u16 = 5_000; // 50% burned (F6.2)
pub const MARKETING_BPS: u16 = 3_500; // 35% operator-discretion marketing bucket (not a prize pool)
pub const OPS_BPS: u16 = 1_500; // 15% ops fee (single recipient)

/// The three legs of a settled payment (F5.4).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Split {
    pub burn: u64,
    pub marketing: u64,
    pub ops: u64,
}

/// Pure F5.4 split — the load-bearing money math, factored out so it is unit-testable without a
/// validator. `burn` and `marketing` are floor(bps) of `amount`; `ops` takes the exact remainder,
/// so `burn + marketing + ops == amount` with **zero lamports lost or created** (F6.1 atomicity).
/// Rejects a zero amount and a bps set that does not sum to 10_000.
pub fn compute_split(amount: u64, burn_bps: u16, marketing_bps: u16, ops_bps: u16) -> Result<Split> {
    require!(amount > 0, SettlementError::ZeroAmount);
    require_eq!(
        burn_bps as u32 + marketing_bps as u32 + ops_bps as u32,
        10_000u32,
        SettlementError::InvalidSplit
    );
    let burn = (amount as u128 * burn_bps as u128 / 10_000) as u64;
    let marketing = (amount as u128 * marketing_bps as u128 / 10_000) as u64;
    // ops absorbs the rounding remainder; checked_sub guards against any underflow.
    let ops = amount
        .checked_sub(burn)
        .and_then(|v| v.checked_sub(marketing))
        .ok_or(SettlementError::MathOverflow)?;
    Ok(Split { burn, marketing, ops })
}

#[program]
pub mod runechain_settlement {
    use super::*;

    /// Admin: create the singleton config. Starts PAUSED (F6.3) — settlement cannot run
    /// until an admin flips it live after legal/compliance sign-off.
    pub fn init_config(ctx: Context<InitConfig>, marketing: Pubkey, ops: Pubkey) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.authority = ctx.accounts.authority.key();
        c.marketing = marketing;
        c.ops = ops;
        c.burn_bps = BURN_BPS;
        c.marketing_bps = MARKETING_BPS;
        c.ops_bps = OPS_BPS;
        c.paused = true;
        c.bump = ctx.bumps.config;
        require_eq!(
            c.burn_bps as u32 + c.marketing_bps as u32 + c.ops_bps as u32,
            10_000,
            SettlementError::InvalidSplit
        );
        Ok(())
    }

    /// Admin: the legal/compliance go-live toggle (F6.3). Designed now, flipped later.
    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        Ok(())
    }

    /// Atomically settle `amount` of the configured mint: burn 50%, send 35% to marketing,
    /// 15% to ops. The buyer signs and the legs all draw from their token account. Dust from
    /// integer division is absorbed by the ops leg so the three legs sum exactly to `amount`.
    pub fn purchase_gold(ctx: Context<PurchaseGold>, amount: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.paused, SettlementError::Paused);

        let Split { burn: burn_amt, marketing: mkt_amt, ops: ops_amt } =
            compute_split(amount, config.burn_bps, config.marketing_bps, config.ops_bps)?;

        let decimals = ctx.accounts.mint.decimals;
        let token_program = ctx.accounts.token_program.to_account_info();

        // 1) true SPL burn — reduces supply, not the incinerator (F6.2)
        token::burn(
            CpiContext::new(
                token_program.clone(),
                Burn {
                    mint: ctx.accounts.mint.to_account_info(),
                    from: ctx.accounts.buyer_token.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            burn_amt,
        )?;

        // 2) 35% -> marketing
        token::transfer_checked(
            CpiContext::new(
                token_program.clone(),
                TransferChecked {
                    from: ctx.accounts.buyer_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.marketing_token.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            mkt_amt,
            decimals,
        )?;

        // 3) 15% -> ops
        token::transfer_checked(
            CpiContext::new(
                token_program,
                TransferChecked {
                    from: ctx.accounts.buyer_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.ops_token.to_account_info(),
                    authority: ctx.accounts.buyer.to_account_info(),
                },
            ),
            ops_amt,
            decimals,
        )?;

        emit!(GoldPurchased {
            buyer: ctx.accounts.buyer.key(),
            mint: ctx.accounts.mint.key(),
            amount,
            burn: burn_amt,
            marketing: mkt_amt,
            ops: ops_amt,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(init, payer = authority, space = 8 + Config::LEN, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(mut, seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct PurchaseGold<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    #[account(mut)]
    pub mint: Account<'info, Mint>,
    #[account(mut, token::mint = mint, token::authority = buyer)]
    pub buyer_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, constraint = marketing_token.owner == config.marketing @ SettlementError::WrongDestination)]
    pub marketing_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, constraint = ops_token.owner == config.ops @ SettlementError::WrongDestination)]
    pub ops_token: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub marketing: Pubkey,
    pub ops: Pubkey,
    pub burn_bps: u16,
    pub marketing_bps: u16,
    pub ops_bps: u16,
    pub paused: bool,
    pub bump: u8,
}

impl Config {
    pub const LEN: usize = 32 * 3 + 2 * 3 + 1 + 1;
}

#[event]
pub struct GoldPurchased {
    pub buyer: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub burn: u64,
    pub marketing: u64,
    pub ops: u64,
}

#[error_code]
pub enum SettlementError {
    #[msg("Settlement is paused pending legal/compliance sign-off")]
    Paused,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Split basis points must sum to 10000")]
    InvalidSplit,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Destination token account owner does not match config")]
    WrongDestination,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn split(amount: u64) -> Split {
        compute_split(amount, BURN_BPS, MARKETING_BPS, OPS_BPS).unwrap()
    }

    #[test]
    fn constants_sum_to_full_basis_points() {
        // F5.4: the configured split must be exhaustive — no implicit fourth bucket.
        assert_eq!(BURN_BPS + MARKETING_BPS + OPS_BPS, 10_000);
    }

    #[test]
    fn split_is_exact_and_lossless() {
        // F6.1 atomicity in numbers: the three legs must reconstruct the input exactly, for any
        // amount — no dust burned into the void, none conjured.
        for a in [1u64, 2, 3, 7, 10, 99, 100, 101, 1_000, 1_000_000, 999_999_937, u64::MAX / 2, u64::MAX] {
            let s = split(a);
            assert_eq!(s.burn + s.marketing + s.ops, a, "legs must sum to amount for {a}");
        }
    }

    #[test]
    fn round_amount_hits_exact_50_35_15() {
        assert_eq!(split(10_000), Split { burn: 5_000, marketing: 3_500, ops: 1_500 });
        assert_eq!(split(1_000_000), Split { burn: 500_000, marketing: 350_000, ops: 150_000 });
    }

    #[test]
    fn ops_absorbs_the_rounding_remainder() {
        // 101: floor(50%)=50, floor(35%)=35, leaving 16 for ops (its 15 + the 1-unit remainder).
        assert_eq!(split(101), Split { burn: 50, marketing: 35, ops: 16 });
    }

    #[test]
    fn burn_leg_is_at_least_the_marketing_leg() {
        // 50% floor >= 35% floor for every amount — the burn is always the largest *configured* leg.
        for a in [1u64, 100, 101, 12_345, 7_777_777, u64::MAX] {
            let s = split(a);
            assert!(s.burn >= s.marketing, "burn must be >= marketing for {a}");
        }
    }

    #[test]
    fn rejects_zero_amount() {
        assert!(compute_split(0, BURN_BPS, MARKETING_BPS, OPS_BPS).is_err());
    }

    #[test]
    fn rejects_bps_that_do_not_sum_to_10000() {
        assert!(compute_split(1_000, 5_000, 3_500, 1_400).is_err()); // 9_900
        assert!(compute_split(1_000, 6_000, 3_500, 1_500).is_err()); // 11_000
    }
}
