# G39 NFL Redraft Trade Runtime Integration

## Scope

G39 adds a canonical NFL redraft trade runtime for the playable league product. It does not build Decision OS, Commissioner OS, Manager OS, or downstream intelligence consumers.

## Architecture

- `lib/trade-runtime/canonicalNflRedraftTradeRuntime.ts` is the pure runtime. It validates assets, deadline state, roster capacity, locked players, FAAB, draft-pick gating, league votes, execution, transaction state, and canonical events without database access.
- `lib/trade-runtime/resolveNflRedraftTradeRuntime.ts` is the persistence bridge. It resolves G33 canonical rules, G35 roster config, redraft rosters, proposals, votes, and trade transactions from Prisma.
- `app/api/redraft/trade-runtime/route.ts` exposes authenticated runtime read/action endpoints while preserving manager and commissioner permission checks.
- `app/league/[leagueId]/tabs/redraft/TradeCenter.tsx` now shows a read-only runtime summary for pending trades, votes, history, and pick-trading execution status.

## Canonical Rules

Trade validation uses:

- G33 `rules.trades.reviewHours`
- G33 `rules.trades.deadlineWeek`
- G33 `rules.trades.draftPickTrading`
- G33/G35 active roster limit
- G35 lineup validation warnings surfaced as non-blocking roster impact warnings
- `rules.roster.lockAllMoves` and runtime member move locks

## Lifecycle

The runtime supports:

- create proposal
- accept and execute
- reject
- cancel
- expire
- commissioner approve
- commissioner veto
- league vote approve/veto
- transaction history records

Accepted trades move active `RedraftRosterPlayer` rows, reset incoming players to `BENCH`, set acquisition type to `trade`, transfer FAAB balances, and write `RedraftLeagueTransaction` history rows for both affected rosters.

## Validation

The pure runtime blocks:

- unknown or same-roster trades
- missing assets
- invalid asset direction
- duplicate player/pick assets
- player assets not owned by the sending roster
- locked players unless commissioner override is used
- roster overflow after uneven trades
- insufficient FAAB
- trade deadline violations
- draft-pick trades when disabled

## Draft Pick Trading

Redraft pick trading is validated and recorded when enabled. Execution remains reference-only because this redraft proposal table does not have a complete owned-pick inventory to mutate. The runtime marks this honestly with `pickExecutionStatus: "reference_only"` and validation warnings.

## Events

G39 extends the canonical runtime catalog with:

- `trade.cancelled`
- `trade.expired`
- `trade.league_vote.opened`
- `trade.league_vote.cast`
- `trade.league_vote.passed`
- `trade.league_vote.failed`
- `trade.executed`
- `trade.roster.updated`
- `trade.transaction.recorded`
- `commissioner.trade_override`

Existing `trade.processed` remains for compatibility with current consumers.

## Commissioner Functionality

Commissioners can approve, veto, expire, and cancel via the runtime route. Commissioner overrides emit `commissioner.trade_override` and write best-effort audit rows where the local schema supports them.

## Known Limitations

- Browser proof uses a deterministic runtime-backed Pages Router harness at `/e2e-g39-nfl-redraft-trade-runtime`, not a fully authenticated seeded league route.
- App Router E2E pages currently compile and then stall during root page rendering in this dirty local workspace; G39 avoids changing root layout/session behavior and documents that authenticated app-route browser coverage remains a separate gap.
- Existing `/api/redraft/trade-proposals` and `/api/redraft/trade-votes` remain intact for current Trade Center compatibility; G39 adds the canonical runtime route and summary instead of rewriting the entire trade UI flow.
- Redraft draft-pick execution is reference-only until an owned-pick inventory exists for this league model.
- Full repo typecheck was not run due unrelated dirty/global worktree risk.
