# NFL Redraft Launch Gate — Status

## Runtime gate: GREEN

```bash
npm run gate:nfl-redraft-launch:runtime
```

Result: **71/71 test files, 1016/1016 tests passing.**

Covers the full redraft product surface: lineup locks (G1), score sync,
standings, waivers, trades/settlement, playoffs (bracket generation,
advancement, champion finalization), draft-room/session behavior, and
sport-adapter parity — everything under `__tests__/redraft/` plus
`__tests__/nfl-redraft-*.test.ts(x)` and `__tests__/redraft-*.test.ts(x)`.

This is the practical **"is NFL redraft behavior safe?"** signal. Run it
before any redraft-affecting change.

## Strict gate: BLOCKED

```bash
npm run gate:nfl-redraft-launch:strict
```

Runs `prisma validate` → repo-wide `npm run typecheck` → the runtime gate
above. Currently blocked at the typecheck step by **repo-wide pre-existing
TypeScript debt (~3,200 errors)** on this branch — the same baseline debt
`gate:draft:full` already inherits. This is **not** redraft-specific and
**not** a regression from the runtime-gate work; it's a repo-wide cleanup
item tracked separately.

## Which command to use

- **Day-to-day redraft confidence check:** `npm run gate:nfl-redraft-launch:runtime`
- **Full launch readiness (blocked until typecheck debt is cleared):** `npm run gate:nfl-redraft-launch:strict`

## How we got here

1. Verified the NFL redraft feature set (lineup locks, score sync, playoffs,
   trade settlement, champion finalization) was already real and tested —
   not the placeholder/missing state an earlier stale audit assumed.
2. Built the missing piece: a single command running the full redraft test
   surface (`scripts/redraft-launch-gate.mjs`).
3. First run surfaced 13 pre-existing failures across 4 files. Root-caused
   each one individually:
   - `nfl-redraft-core-tab-bar.test.ts` — stale test, predated the documented
     G32 League Home tab overhaul.
   - `nfl-redraft-pre-draft-fix-action-listener.test.ts` — stale test anchor
     (em dash vs. hyphen in a source comment); the listener itself was
     correct throughout.
   - `redraft-display-players.test.ts` — stale test assumption; `imageUrl`
     is a headshot-fallback alias by design, not an independent raw field.
   - `redraft-sport-adapter-parity.test.ts` — test didn't account for
     team-defense (DST) scoring categories being scored through a separate
     pipeline that bypasses the per-player stat adapter.
   - None were real product regressions.
4. Split the gate into `:runtime` (vitest only, green today) and `:strict`
   (adds prisma validate + repo-wide typecheck, blocked on pre-existing debt)
   so redraft confidence isn't held hostage to unrelated repo-wide TypeScript
   cleanup.
