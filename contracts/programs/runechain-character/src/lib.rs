//! RUNECHAIN character lifecycle (PRD F7), reconciled with bible rulings 7–10 (C1–C4).
//!
//! The character is a normal NFT whose **transfer is program-gated by season-state** (F7.2):
//! locked while a season is open / tasks unfinished, sellable only once it is "season-
//! complete." Selling a season-complete character is the **single way value leaves the
//! system** (bible ruling 9 / U5). This program implements the **escrow-gate** mechanism
//! (the transfer-hook alternative, Q-F7b is still open); the NFT sits in a program escrow
//! while listed and is only released on a valid sale.
//!
//! What lives where (bible ruling 8 / C3): the on-chain program gates the transfer, records
//! ownership + the restart flag, and emits events. The **collection (items + cosmetics, some
//! rare) and the stats reset** are applied by the authoritative Chainwell server (U7) when it
//! reconciles `CharacterSold` — items/cosmetics carry to the buyer, **stats reset to zero**,
//! and the seller's account restarts next season. Power is never inherited, only re-earned.
//!
//! Go-live (F6.3/F7): `Config.paused` starts `true`. Enabling real sales in production is a
//! hard legal/compliance precondition flipped by the admin, not a date.
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

declare_id!("FAidaRiKduPztNQmKK1C1T4ikmmqAXpiWwMzXbnJhNN3");

/// F7.3 transfer gate (rules 1 & 2), factored out so the conditional-transfer rule is
/// unit-testable without a validator. A character may be listed for sale **only** when sales
/// are live, its mandatory tasks are done, and the season window has closed:
///   - paused           → sales not yet legally enabled (F6.3/F7)
///   - !tasks_done       → can't sell a half-completed season (F7.3 rule 2)
///   - season_open       → can't sell mid-season (F7.3 rule 1)
/// Checks are ordered so the most fundamental gate (paused) reports first.
pub fn ensure_listable(paused: bool, tasks_done: bool, season_open: bool) -> Result<()> {
    require!(!paused, CharacterError::Paused);
    require!(tasks_done, CharacterError::TasksUnfinished);
    require!(!season_open, CharacterError::SeasonStillOpen);
    Ok(())
}

/// F7.3 rule 3 + bible ruling 8: the on-chain half of a completed sale. The seller's account is
/// flagged to restart at zero next season, ownership moves to the buyer, and sale-eligibility is
/// cleared so the buyer must re-earn it (stats reset off-chain by the server — power is never
/// inherited, only re-earned). Pure + unit-testable.
pub fn apply_post_sale(cs: &mut CharacterState, buyer: Pubkey) {
    cs.must_restart = true; // seller restarts next season (F7.3 rule 3)
    cs.owner = buyer;
    cs.tasks_done = false; // buyer inherits collection, not sale-eligibility
}

#[program]
pub mod runechain_character {
    use super::*;

    /// Admin: singleton config. `oracle` is the authoritative server key (U7) allowed to mark
    /// season-completion. Starts PAUSED — no sales until legal sign-off flips it live.
    pub fn init_config(ctx: Context<InitConfig>, oracle: Pubkey) -> Result<()> {
        let c = &mut ctx.accounts.config;
        c.authority = ctx.accounts.authority.key();
        c.oracle = oracle;
        c.paused = true;
        c.bump = ctx.bumps.config;
        Ok(())
    }

    pub fn set_paused(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        Ok(())
    }

    /// Admin: open or close a season window (shared real-world clock, F7.1).
    pub fn set_season(ctx: Context<SetSeason>, season_id: u64, open: bool) -> Result<()> {
        let s = &mut ctx.accounts.season;
        s.season_id = season_id;
        s.open = open;
        s.bump = ctx.bumps.season;
        Ok(())
    }

    /// A player registers their character NFT into lifecycle state for a season.
    pub fn register_character(ctx: Context<RegisterCharacter>, season_id: u64) -> Result<()> {
        let cs = &mut ctx.accounts.character_state;
        cs.mint = ctx.accounts.mint.key();
        cs.owner = ctx.accounts.owner.key();
        cs.season_id = season_id;
        cs.tasks_done = false;
        cs.must_restart = false;
        cs.bump = ctx.bumps.character_state;
        Ok(())
    }

    /// Oracle (authoritative server, U7): mark the mandatory tasks done. Sale-eligibility is
    /// "tasks done while the window was open" (F7.1); the window must still be open here.
    pub fn mark_complete(ctx: Context<MarkComplete>) -> Result<()> {
        require!(ctx.accounts.season.open, CharacterError::SeasonClosed);
        ctx.accounts.character_state.tasks_done = true;
        Ok(())
    }

    /// Seller lists a **season-complete** character. Reverts if the window is still open or
    /// tasks are unfinished (F7.3 rules 1 & 2). Moves the NFT into program escrow.
    pub fn list_for_sale(ctx: Context<ListForSale>, price: u64) -> Result<()> {
        ensure_listable(
            ctx.accounts.config.paused,
            ctx.accounts.character_state.tasks_done,
            ctx.accounts.season.open,
        )?;

        let listing = &mut ctx.accounts.listing;
        listing.mint = ctx.accounts.mint.key();
        listing.seller = ctx.accounts.seller.key();
        listing.price = price;
        listing.bump = ctx.bumps.listing;

        token::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.seller_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.escrow_token.to_account_info(),
                    authority: ctx.accounts.seller.to_account_info(),
                },
            ),
            1,
            0,
        )?;

        emit!(CharacterListed { mint: listing.mint, seller: listing.seller, price });
        Ok(())
    }

    /// Buyer purchases the listed character: pays the seller, the escrow releases the NFT to
    /// the buyer, the seller is flagged to restart at zero (F7.3 rule 3), and ownership moves.
    /// The server then carries the collection and **resets stats** (ruling 8).
    pub fn buy(ctx: Context<Buy>) -> Result<()> {
        require!(!ctx.accounts.config.paused, CharacterError::Paused);
        let price = ctx.accounts.listing.price;

        // pay the seller in lamports
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.buyer.to_account_info(),
                    to: ctx.accounts.seller.to_account_info(),
                },
            ),
            price,
        )?;

        // release the NFT from escrow to the buyer (escrow authority PDA signs)
        let mint_key = ctx.accounts.mint.key();
        let seeds: &[&[u8]] = &[b"escrow-auth", mint_key.as_ref(), &[ctx.bumps.escrow_authority]];
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.escrow_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.buyer_token.to_account_info(),
                    authority: ctx.accounts.escrow_authority.to_account_info(),
                },
                &[seeds],
            ),
            1,
            0,
        )?;

        // seller restarts at zero next season; ownership + stats-reset marker move to buyer
        apply_post_sale(&mut ctx.accounts.character_state, ctx.accounts.buyer.key());

        emit!(CharacterSold {
            mint: mint_key,
            seller: ctx.accounts.seller.key(),
            buyer: ctx.accounts.buyer.key(),
            price,
        });
        Ok(())
    }

    /// Seller reclaims an unsold listing; escrow returns the NFT.
    pub fn cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
        let mint_key = ctx.accounts.mint.key();
        let seeds: &[&[u8]] = &[b"escrow-auth", mint_key.as_ref(), &[ctx.bumps.escrow_authority]];
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.escrow_token.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.seller_token.to_account_info(),
                    authority: ctx.accounts.escrow_authority.to_account_info(),
                },
                &[seeds],
            ),
            1,
            0,
        )?;
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
#[instruction(season_id: u64)]
pub struct SetSeason<'info> {
    #[account(seeds = [b"config"], bump = config.bump, has_one = authority)]
    pub config: Account<'info, Config>,
    #[account(init_if_needed, payer = authority, space = 8 + Season::LEN, seeds = [b"season", season_id.to_le_bytes().as_ref()], bump)]
    pub season: Account<'info, Season>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(season_id: u64)]
pub struct RegisterCharacter<'info> {
    #[account(init, payer = owner, space = 8 + CharacterState::LEN, seeds = [b"character", mint.key().as_ref()], bump)]
    pub character_state: Account<'info, CharacterState>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MarkComplete<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, seeds = [b"character", character_state.mint.as_ref()], bump = character_state.bump)]
    pub character_state: Account<'info, CharacterState>,
    #[account(seeds = [b"season", character_state.season_id.to_le_bytes().as_ref()], bump = season.bump)]
    pub season: Account<'info, Season>,
    #[account(constraint = oracle.key() == config.oracle @ CharacterError::Unauthorized)]
    pub oracle: Signer<'info>,
}

#[derive(Accounts)]
pub struct ListForSale<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [b"season", character_state.season_id.to_le_bytes().as_ref()], bump = season.bump)]
    pub season: Account<'info, Season>,
    #[account(mut, seeds = [b"character", mint.key().as_ref()], bump = character_state.bump, has_one = owner @ CharacterError::Unauthorized)]
    pub character_state: Account<'info, CharacterState>,
    #[account(init, payer = seller, space = 8 + Listing::LEN, seeds = [b"listing", mint.key().as_ref()], bump)]
    pub listing: Account<'info, Listing>,
    pub mint: Account<'info, Mint>,
    /// CHECK: PDA escrow authority that owns the escrow token account
    #[account(seeds = [b"escrow-auth", mint.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,
    #[account(init, payer = seller, seeds = [b"escrow", mint.key().as_ref()], bump, token::mint = mint, token::authority = escrow_authority)]
    pub escrow_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = seller)]
    pub seller_token: Account<'info, TokenAccount>,
    /// the character_state owner == seller
    #[account(mut, address = character_state.owner)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub seller: Signer<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct Buy<'info> {
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, close = seller, seeds = [b"listing", mint.key().as_ref()], bump = listing.bump, has_one = seller, has_one = mint)]
    pub listing: Account<'info, Listing>,
    #[account(mut, seeds = [b"character", mint.key().as_ref()], bump = character_state.bump)]
    pub character_state: Account<'info, CharacterState>,
    pub mint: Account<'info, Mint>,
    /// CHECK: PDA escrow authority
    #[account(seeds = [b"escrow-auth", mint.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"escrow", mint.key().as_ref()], bump, token::mint = mint, token::authority = escrow_authority)]
    pub escrow_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = buyer)]
    pub buyer_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: paid in lamports; must match the listing's seller
    #[account(mut)]
    pub seller: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CancelListing<'info> {
    #[account(mut, close = seller, seeds = [b"listing", mint.key().as_ref()], bump = listing.bump, has_one = seller, has_one = mint)]
    pub listing: Account<'info, Listing>,
    pub mint: Account<'info, Mint>,
    /// CHECK: PDA escrow authority
    #[account(seeds = [b"escrow-auth", mint.key().as_ref()], bump)]
    pub escrow_authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"escrow", mint.key().as_ref()], bump, token::mint = mint, token::authority = escrow_authority)]
    pub escrow_token: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint, token::authority = seller)]
    pub seller_token: Account<'info, TokenAccount>,
    #[account(mut)]
    pub seller: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub oracle: Pubkey,
    pub paused: bool,
    pub bump: u8,
}
impl Config {
    pub const LEN: usize = 32 + 32 + 1 + 1;
}

#[account]
pub struct Season {
    pub season_id: u64,
    pub open: bool,
    pub bump: u8,
}
impl Season {
    pub const LEN: usize = 8 + 1 + 1;
}

#[account]
pub struct CharacterState {
    pub mint: Pubkey,
    pub owner: Pubkey,
    pub season_id: u64,
    pub tasks_done: bool,
    pub must_restart: bool,
    pub bump: u8,
}
impl CharacterState {
    pub const LEN: usize = 32 + 32 + 8 + 1 + 1 + 1;
}

#[account]
pub struct Listing {
    pub mint: Pubkey,
    pub seller: Pubkey,
    pub price: u64,
    pub bump: u8,
}
impl Listing {
    pub const LEN: usize = 32 + 32 + 8 + 1;
}

#[event]
pub struct CharacterListed {
    pub mint: Pubkey,
    pub seller: Pubkey,
    pub price: u64,
}

#[event]
pub struct CharacterSold {
    pub mint: Pubkey,
    pub seller: Pubkey,
    pub buyer: Pubkey,
    pub price: u64,
}

#[error_code]
pub enum CharacterError {
    #[msg("Sales are paused pending legal/compliance sign-off")]
    Paused,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Mandatory tasks are unfinished — character is not season-complete")]
    TasksUnfinished,
    #[msg("Cannot sell mid-season; the window is still open")]
    SeasonStillOpen,
    #[msg("Season window is closed")]
    SeasonClosed,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gate_allows_only_complete_closed_unpaused() {
        // The single sale-eligible state: live sales, tasks done, season closed.
        assert!(ensure_listable(false, true, false).is_ok());
    }

    #[test]
    fn gate_blocks_each_failing_condition() {
        assert!(ensure_listable(true, true, false).is_err());   // paused
        assert!(ensure_listable(false, false, false).is_err()); // F7.3 rule 2: tasks unfinished
        assert!(ensure_listable(false, true, true).is_err());   // F7.3 rule 1: mid-season
    }

    #[test]
    fn gate_truth_table_is_exhaustive() {
        // Sale-eligibility is exactly (!paused && tasks_done && !season_open) — nothing else opens it.
        for paused in [false, true] {
            for tasks_done in [false, true] {
                for season_open in [false, true] {
                    let allowed = ensure_listable(paused, tasks_done, season_open).is_ok();
                    assert_eq!(
                        allowed,
                        !paused && tasks_done && !season_open,
                        "paused={paused} tasks_done={tasks_done} season_open={season_open}"
                    );
                }
            }
        }
    }

    #[test]
    fn post_sale_restarts_seller_reassigns_owner_clears_eligibility() {
        let seller = Pubkey::new_unique();
        let buyer = Pubkey::new_unique();
        let mut cs = CharacterState {
            mint: Pubkey::new_unique(),
            owner: seller,
            season_id: 1,
            tasks_done: true,
            must_restart: false,
            bump: 1,
        };
        apply_post_sale(&mut cs, buyer);
        assert_eq!(cs.owner, buyer, "ownership moves to the buyer");
        assert!(cs.must_restart, "seller is flagged to restart at zero (F7.3 rule 3)");
        assert!(!cs.tasks_done, "buyer must re-earn sale-eligibility; power is never inherited");
    }
}
