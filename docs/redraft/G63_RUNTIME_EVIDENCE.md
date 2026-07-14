# G63 — Runtime Evidence

**Runtime SHA:** `daacd0a2163819e151de511d82aeb1d7cbbd7019` (`release/nfl-redraft-invited-mvp-rc1`)
**App:** Next.js 14.2.35, run from worktree `C:/Users/Guap_/OneDrive/Documents/AF/af-nfl-invited-mvp-rc1`, `http://localhost:3011`
**Database:** disposable Neon branch `br-restless-sound-add08fqz` (endpoint `ep-delicate-field-adpo7gt9`), a copy-on-write clone of prod `icy-field-51189449` "All Fantasy". **Prod endpoint `ep-curly-block-ad0dlt9o` was never written.** Branch auto-expires 2026-07-14 12:00 UTC.
**Isolation guards:** every write script required (1) `DATABASE_URL` host = branch endpoint AND (2) a branch-only marker table `_rc_verify_marker` checked *through* Prisma.

> **Note on screenshots:** the browser pane's screenshot capture timed out repeatedly (the dashboard's live-polling widgets keep the renderer busy). Evidence below is therefore captured via the accessibility/DOM tree (`read_page`), authenticated `fetch` calls, server logs, and direct DB queries — which are more precise than pixels for validation.

## Server bring-up
```
▲ Next.js 14.2.35  - Local: http://127.0.0.1:3011  - Environments: .env.local
✓ Ready in 15s
✓ Compiled / in 43.1s (1312 modules) → GET / 200
✓ GET /dashboard 200 in 8198ms
```

## Phase A — auth + onboarding + dashboard (browser)
| Step | Evidence |
|------|----------|
| Homepage | `GET / 200`; renders "Sign In" / "Get Started" |
| Login page | `/login` renders password + "Continue with Google — Coming Soon"; `/api/auth/signin` → redirects to custom `/login` |
| Dev-bypass auth | `POST /api/auth/callback/dev-bypass 200` → `/api/auth/session` returns `{user:{id:"fea0c8f1-6e9f-4198-8d0b-804e3cc00976", email:"commissioner-dev@allfantasy.local"}}` |
| Onboarding | `/choose-username` → set username → `PATCH /api/user/profile 200 {"ok":true}` → `POST /api/auth/session 200` (updateSession) → redirect. **Flow correct.** |
| Dashboard | `GET /dashboard 200`; DOM shows **Create League** + **Import league** buttons, War Room, Commissioner Hub, and the commissioner's leagues (see below) |

**Leagues visible in the live dashboard** (cross-confirms create/import worked):
- `RC-VERIFY NFL 2026-07-13T00:15:33` (`ad7ff2f6…`) — created
- `RC-VERIFY NCAAF 2026-07-13T00:21:33` (`69da610f…`) — created
- `Premier League of Mediocrity` (`529a24a7…`) — Sleeper-imported

## Phase B — create (service + DB + UI-confirmed)
`createRedraftLeagueInTransaction` executed against the branch:
| Sport | leagueId | Time | Rows created |
|-------|----------|------|--------------|
| NFL | `ad7ff2f6-4b4b-4ce9-94b4-4aaf7d4d5a31` | 2.2s | `leagues`(+1) · `league_teams`(1, commissioner) · `league_settings`(1) · `redraft_league_extended_settings`(1) · `draft_sessions`(1) |
| NCAAF | `69da610f-c714-4009-ae00-b37ab24dbb50` | 0.7s | `leagues`(+1) |

`league.count` on branch: 66 → 69 across create+import. Homepage URL returned includes the invite entry: `…?created=1&guide=settings&showInvite=1`. NCAAF draftable pool present: **`SportsPlayer` NCAAF = 44,897** (NFL = 17,257).

## Phase C — Sleeper import (service + DB)
`processLeague(sleeperLeague, afUserId, 2025, NFL)` on branch:
```
imported "Premier League of Mediocrity" (12 teams, status=complete, settings.type=2)
→ AF league 529a24a7-d5ed-474a-8164-ba91ee18ac48  leagueType=redraft  in 2.8s
```
Depth query for the imported league:
| Table | Rows |
|-------|------|
| `league_teams` | **12** (standings: `ownerName`, `teamName`, `wins`, `pointsFor/Against`, `projectedWins`) |
| `redraft_rosters` | 0 |
| generic `rosters` | 0 |
| `league_settings` | 0 |
| `league_seasons` | 0 |

→ History/standings import; **no player-level rosters** (see Defect Log C-1).

## Phase D — league-type mapping (code + DB)
`lib/league/sleeper-import-process.ts:358` `buildLeagueUpdateData` sets `isDynasty: settings.type === 2` and **omits `leagueType`** (→ schema default `redraft`). Confirmed in DB: imported type=2 league → `leagueType=redraft`, and dynasty tracked separately. Keeper (`type===1`) undistinguished. (Defect Log D-1.)

## 🔴 League home — HTTP 500 (P0-1)
Navigating `/league/ad7ff2f6-4b4b-4ce9-94b4-4aaf7d4d5a31` as the authenticated commissioner → page body is Next's `_error` with `statusCode: 500`:
```
Module not found: Can't resolve '@/components/decision-os/UserOsCardConnected'
> 22 | import UserOsCardConnected from '@/components/decision-os/UserOsCardConnected'
Import trace: ./app/league/[leagueId]/LeagueShell.tsx → LeagueShellClient.tsx
```
`find` confirms: RC1 has `components/decision-os/UserOsCard.tsx` but **no** `UserOsCardConnected.tsx`; the later `feat/fantasy-os-*` branch **does** have it. → RC1 is a bad cut. (Defect Log P0-1.)

## Phase G — regression
`node scripts/redraft-launch-gate.mjs --runtime` (RC1): **Test Files 10 failed | 96 passed (106); Tests 22 failed | 1116 passed (1138); 114s.** Failing files: `redraft/playoff-advance`, `redraft/playoff-finalize`, `redraft-trade-playoff-routes-contract`, `redraft/redraft-core-contract`, `nfl-redraft-pre-draft-fix-action-listener` (7/10), `g37-...-live-scoring-runtime`, `nfl-redraft-league-dashboard`, `nfl-redraft-player-headshot`, `g49j-...-provider-migration-certification`, `g32-...-home-dashboard` (0 collected — the P0-1 import break). Nature: real (`prisma.redraftSeason.findUnique is not a function`; DST `expected 17 got 0`) + brittle source-assertion drift. (Defect Log REG-1.)

## Not driven (environment constraints, honest)
- **Create wizard full UI walk** — create *logic* + persistence + UI listing proven; the multi-step wizard was opened but not clicked to completion (renderer under heavy load; each route compile ~40s).
- **Phase E invite flow** — requires 3 distinct authenticated identities (commissioner + Manager A + B); impractical with a single dev-bypass identity in one browser. Invite URL generation is present; `/api/commissioner/leagues/[id]/invite/send` emails via Resend (no mail configured in this env).
- **Phase F draft room + real picks** — not driven (browser speed/time). Draft session is created at league creation; player pools present.
