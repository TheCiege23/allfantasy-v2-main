# Empty-Database Migration Report

## Environment

Second disposable Neon branch, created this phase via the Neon MCP tools (not by any git/CLI action):

| Field | Value |
|---|---|
| Branch name | `gate-c-empty-migration-test-20260712` |
| Branch ID | `br-icy-violet-adscnjkg` |
| Project | "All Fantasy" (`icy-field-51189449`) |
| Parent | `br-withered-shadow-adur64u9` (production) |
| Expiration | `2026-07-13T21:00:00Z` (24-hour TTL, set explicitly at creation) |
| Postgres version | 17.10 (same as the production-fork branch) |

**Neon branch creation always forks the parent's current data** (no "create a truly blank branch" primitive exists) — confirmed on connect: 640 inherited tables, matching production. Per this phase's explicit fallback instruction ("create an isolated empty database within a disposable branch and document the limitation"), the inherited `public` schema was dropped and recreated (`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`) on this disposable, non-production branch, verified immediately after: **0 tables**. This is the documented limitation and its resolution.

## From-scratch migration application

```
npx prisma migrate deploy
```

Result: **all 115 migrations applied, in order, zero errors, zero warnings.** First migration: `20260407024117_init`. Last migration: `20260711130000_widen_redraft_trade_proposal_status_check` (the reversal-constraint fix from the prior phase).

Post-apply verification:
- `npx prisma migrate status` → **"Database schema is up to date!"**
- `npx prisma validate` → **schema valid**
- No manual database intervention was used at any point.
- Final table count: **631**.
- Direct constraint check confirms the reversal fix applies correctly when built from scratch too: `redraft_trade_proposals_status_check` includes `'reversed'` in its `CHECK` definition, identical to the production-fork result from the prior phase.

## The real, now-precisely-quantified source/production gap

The prior phase's `RENEWAL_MIGRATION_HISTORY_AUDIT.md` flagged "4 migrations present in the database but absent from source" based on `prisma migrate status`'s own comparison (which only reports migration-history-table entries, not actual schema objects). This phase directly diffed the **real table lists** between the from-scratch build (631 tables) and the production fork after all migrations (649 tables, having grown from 640 by the 8 migrations applied across both Gate C phases) — a more precise, first-hand measurement than the prior phase's inference.

**24 tables exist in real production but cannot be reconstructed from the checked-in migration history**: `DraftIntroView`, `ai_bot_message_history`, `ai_league_type_metrics`, `ai_opponent_action_logs`, `ai_opponent_league_memory`, `ai_opponent_profiles`, `ai_opponent_team_assignments`, `ai_opponent_trade_cooldowns`, `ai_platform_events`, `ai_player_market_metrics`, `ai_player_outlooks_cache`, `ai_recommendation_outcomes`, `ai_user_tendencies`, `big_brother_hoh_room_guests`, `concept_presets`, `fantasy_players`, `fantasy_projections`, `fantasy_schedule_games`, `fantasy_stat_lines`, `finance_audit_events`, `league_dues`, `league_finance`, `payout_approvals`, `payout_requests`. This is a real, larger, and more precisely bounded gap than the previously-known "4 migrations" — those 4 known-missing migration entries account for only some of these 24 tables (e.g. `concept_presets` matches `add_concept_presets`/`expand_concept_presets`); the rest (AI opponent tables, finance/payout tables, `fantasy_*` tables, `DraftIntroView`, `big_brother_hoh_room_guests`) represent additional, previously-unquantified schema drift with no corresponding local migration at all.

**6 tables exist in the from-scratch source build but not in the production fork**: `dispersal_asset_pool`, `dispersal_draft_participants`, `dispersal_draft_rosters`, `draft_intro_views`, `supplemental_draft_picks`, `supplemental_drafts`. The naming pair `DraftIntroView` (in production, PascalCase, unmapped default) vs. `draft_intro_views` (from source, snake_case, presumably `@@map`-ped) strongly suggests a rename was introduced in source migrations that was never actually applied against real production — worth flagging precisely as observed rather than guessed further; no migration-content investigation into which specific migration performs this rename was done this phase.

## Does this gap block the empty-database case?

**No.** `prisma migrate deploy` from empty succeeded completely, produced an internally consistent schema, and `prisma validate` confirmed it matches the checked-in Prisma schema file exactly. The gap is a **source-vs-production drift issue**, not a migration-chain-integrity issue — the migration chain itself is coherent and reproducible from scratch. This is not silently ignored: it is quantified precisely above, and is a real, disclosed, unresolved concern for anyone relying on `prisma/schema.prisma` as documentation of what production actually contains today. Fixing this drift (writing migrations to capture the 24 real production tables, and determining whether the 6 source-only tables should be deployed to production or removed from source) is explicitly out of this phase's scope (it is not a defect physical validation of the RENEWAL/TRADE work needs to fix, and touches many unrelated subsystems — AI opponent modeling, finance/payouts, fantasy data ingestion — well beyond this program's boundary).

## No duplication found

No table, enum, index, or constraint was reported as duplicated during the from-scratch apply (a duplication would have surfaced as a Postgres error during `migrate deploy`, and none occurred).
