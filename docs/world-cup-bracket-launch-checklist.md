# World Cup Bracket Challenge — Launch Checklist

> FIFA World Cup 2026 · AllFantasy bracket feature · Prompts 1–7 complete

---

## 1. Local Validation Commands

```bash
# Schema validation
npx prisma validate

# Prisma client generation (stop dev server first on Windows)
npx prisma generate

# Windows clean retry if Prisma DLL is locked
powershell -ExecutionPolicy Bypass -File scripts/prisma-generate-win.ps1 -CleanLockedProcesses

# TypeScript check
npm run typecheck

# Lint
npm run lint

# Production build
npm run build
```

> **Windows note:** `npx prisma generate` may fail with `EPERM` if the Next.js dev server, Prisma Studio, Prisma MCP, or another Node process is holding the Prisma engine DLL. Stop the dev server (`Ctrl+C`) first. If it still fails, run `powershell -ExecutionPolicy Bypass -File scripts/prisma-generate-win.ps1 -CleanLockedProcesses`; this stops local Node/Prisma processes, removes `node_modules\.prisma\client`, and reruns generate.
> If Windows still locks `query_engine-windows.dll.node`, run generate from a clean terminal after fully closing Cursor/VS Code, or rely on CI/Linux/Vercel generate output for deploy confidence.

---

## 2. Required Environment Variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Supabase/Postgres pooler connection string |
| `DIRECT_URL` | Supabase direct connection (for migrations) |
| `NEXTAUTH_URL` | Production app base URL. Must not be localhost in Vercel production. |
| `NEXT_PUBLIC_APP_URL` | Public production app URL used for invite/callback-safe links. Must match `NEXTAUTH_URL` origin. |
| `APP_URL` / `PUBLIC_SITE_URL` | If set, must use the same production HTTPS origin as `NEXTAUTH_URL`; never localhost or `127.0.0.1` in Vercel production. |
| `NEXTAUTH_SECRET` | NextAuth JWT secret |
| `OPENAI_API_KEY` | Required for AI matchup previews and AI bracket builder |
| `WORLD_CUP_DATA_PROVIDER` | Provider selection: `apifootball` for production official data. `mock` is local/dev only. |
| `API_SPORTS_KEY` | API-Sports key for teams, fixtures, live scores, and standings when `WORLD_CUP_DATA_PROVIDER=apifootball` (aliases: `API_FOOTBALL_KEY`, `APISPORTS_FOOTBALL_KEY`). |
| `WORLD_CUP_CRON_SECRET` | Server-side secret for scheduled World Cup sync and readiness routes; send as `Authorization: Bearer <secret>` or `x-cron-secret`. |
| `WORLD_CUP_BEST_THIRD_MAPPING_CONFIRMED` | Keep `false` until the official best-third Round of 32 mapping table is configured. |
| `SPORTSDATA_API_KEY` _(optional)_ | SportsData.io key — required only when `WORLD_CUP_DATA_PROVIDER=sportsdata` |

> Provider keys are server-only. Do not create `NEXT_PUBLIC_*` API provider key variables. All provider calls must go through authenticated admin routes, ingestion scripts, or cron jobs via `worldCupDataSyncService.ts` and `worldCupGroupStageResultService.ts`, never directly from user-facing client routes.

---

## 3. Prisma Migration

```bash
# Apply pending migrations
npx prisma migrate deploy

# Or run the apply-migrations script (see VS Code Tasks)
powershell -File scripts/apply-migrations.ps1
```

World Cup models to verify in `schema.prisma`:
- `WorldCupBracketChallenge`
- `WorldCupBracketEntry`
- `WorldCupBracketMatch`
- `WorldCupBracketPick`
- `WorldCupBracketSlot`
- `WorldCupBracketParticipant`
- `WorldCupBracketInvite`
- `WorldCupBracketScoringProfile`
- `WorldCupTeam`

---

## 4. Create a Test World Cup Bracket League

1. Sign in as a test user.
2. Navigate to `/brackets/world-cup`.
3. Click **Create World Cup Bracket League**.
4. Fill in:
   - **League Name**: e.g. `Test WC Pool 2026`
   - **Privacy**: Private (to test invite flow) or Public (to test discovery)
   - **Max Users**: 10 (for testing)
   - **Brackets per User**: 5 (default)
   - **Lock Rule**: Tournament Lock
5. Click **Create Challenge** and confirm redirect to the new challenge page.
6. Verify the Invite tab shows a valid invite code and link.

---

## 5. Create 5 Bracket Entries

1. Open the challenge you just created.
2. In the Picks tab → Entry Dashboard, click **Create Your First Bracket**.
3. Repeat 4 more times (up to the `maxEntriesPerParticipant` limit).
4. Verify the "You've used all 5 bracket entries" message appears after the 5th.
5. Verify the Create button is disabled when at the limit.

---

## 6. Test Guided Picker

1. Open a bracket entry and click **Start Guided Picks**.
2. Verify:
   - Header shows entry name and `0/N picks` counter.
   - X button is always visible.
   - Team cards stack vertically on mobile (< 640 px), side-by-side on desktop.
   - Picking a team advances to the next match automatically after ~400 ms.
   - Progress bar updates after each pick.
   - "Bracket Complete!" screen appears after all picks are made.
3. Tap **Back** and verify you can change an earlier pick.
4. If a downstream pick is invalidated, verify the toast shows "cleared X downstream pick(s)".

---

## 7. Test AI Preview Fallback

1. Open the guided picker on a match with both teams set.
2. Expand the AI Matchup Preview panel.
3. Switch strategy (Safe / Balanced / Upset / Chaos) and verify preview reloads.
4. Click **Use AI Pick** and verify the pick is applied.
5. To test fallback: set `OPENAI_API_KEY` to an invalid value temporarily; verify the AI panel shows an error message instead of crashing.

---

## 8. Test Live Match Fields Manually

1. In Prisma Studio or Supabase, find a `WorldCupBracketMatch` row.
2. Manually set:
   - `status = "live"`
   - `homeScore = 1`
   - `awayScore = 0`
   - `statusMinute = 43`
3. Reload the bracket challenge page.
4. Verify:
   - Live score ticker shows the match.
   - Match card in the board view shows the score.
   - The pick state badge updates (winning/losing/drawing).
5. Set `status = "final"` and `winnerTeamId` to one of the team IDs.
6. Verify the correct pick badge updates and downstream projected slots fill.

---

## 9. Run Admin Integrity Check

1. Sign in as a challenge owner or site admin.
2. Open any World Cup bracket challenge.
3. Select a bracket entry (Picks tab → open any entry).
4. In the Admin Integrity section, click **Run Integrity Check**.
5. Verify:
   - Stats show Participants, Entries, Matches, Picks counts.
   - If no issues: "No blocking integrity issues detected."
   - If issues: error/warning rows appear.
6. Review the Launch Checklist directly below the integrity panel:
   - ✓ = confirmed
   - ✗ = needs attention
   - ○ = not yet checked / insufficient data

---

## 10. Mobile QA Checklist

Test at 375 px (iPhone SE width) and 390 px (iPhone 14 width) using browser DevTools or a real device.

| Surface | Check |
|---------|-------|
| Landing page (`/brackets/world-cup`) | Header, feature bullets, CTA buttons all fit |
| Create league modal | Form fields don't overflow; scrolls properly |
| Entry dashboard | Cards stack vertically; Create button visible |
| Guided picker | Team cards full-width; X button top-right visible; footer not obscured by home bar |
| Leaderboard | Row cards don't overflow; username + entry name fit |
| Invite tab | URL box wraps; Copy + Share buttons accessible |
| Live score ticker | Scrolls horizontally if multiple matches |
| AI preview panel | Strategy selector wraps; Use AI Pick button full-width |
| Admin panel | Launch checklist readable at small width |

---

## 11. Public Discovery

No dedicated public discovery page has been built yet.

**TODO:** If public leagues are needed in a browsable format, add a route at `/brackets/world-cup/discover` that queries `WorldCupBracketChallenge` where `visibility = "public"` and `status = "open"`. See `docs/PROMPT107_PUBLIC_LEAGUE_DISCOVERY_DELIVERABLE.md` for the general discovery pattern.

---

## 12. Known TODOs for Prompt 8

| Item | Status |
|------|--------|
| Official FIFA 2026 best-third slot mapping | Waiting for FIFA publication |
| Official team and fixture seed import wiring | `worldCupSeedData.ts` has helpers; import script not yet built |
| Real sports API sync (API-Sports / api-football) | Provider abstraction built; set `WORLD_CUP_DATA_PROVIDER=apifootball` + `API_SPORTS_KEY` to enable |
| SportsData.io endpoint mapping | Scaffold in place; endpoints must be verified against subscription |
| Scheduled sync approach | Use Vercel Cron or trusted server cron to call the routes below with an authenticated/admin execution path and `CRON_SECRET` where applicable |
| POST `/admin/repair` dry-run endpoint | Optional; deferred |
| Paid prize / legal compliance if paid pools are enabled | Must be reviewed before enabling paid entry |
| `npx prisma generate` on Windows dev server | Stop dev server before running |

---

## 13. Sync Commands Reference

All sync routes require an authenticated session with admin/owner access.

### Sync Teams (global — no challengeId)

```bash
# Dry run — no DB writes
curl -X POST /api/brackets/world-cup/admin/sync-teams \
  -H "Content-Type: application/json" \
  -d '{"provider":"apifootball","dryRun":true}'

# Live run
curl -X POST /api/brackets/world-cup/admin/sync-teams \
  -H "Content-Type: application/json" \
  -d '{"provider":"apifootball"}'
```

This writes `WorldCupTeam.groupName` when the provider includes Group A-L assignment. Production launch requires 48 official teams with exactly 4 teams in each group; the response reports `officialGroupsReady`, `groupsAssigned`, and `incompleteGroups`.

### Sync Fixtures (per-challenge)

```bash
# Dry run
curl -X POST /api/brackets/world-cup/{challengeId}/admin/sync-fixtures \
  -H "Content-Type: application/json" \
  -d '{"provider":"apifootball","dryRun":true}'

# Live run (also infers pickLockAt from first fixture start time)
curl -X POST /api/brackets/world-cup/{challengeId}/admin/sync-fixtures \
  -H "Content-Type: application/json" \
  -d '{"provider":"apifootball"}'
```

### Sync Live Scores (per-challenge, real-time)

```bash
# Sync + recalculate leaderboard
curl -X POST /api/brackets/world-cup/{challengeId}/admin/sync-live \
  -H "Content-Type: application/json" \
  -d '{"provider":"apifootball","recalculate":true}'

# Dry run
curl -X POST /api/brackets/world-cup/{challengeId}/admin/sync-live \
  -H "Content-Type: application/json" \
  -d '{"provider":"apifootball","dryRun":true}'
```

**Recommended schedule during tournament:** Call the live-scores route every 2–5 minutes while matches are in progress. The mock provider is safe for local dev and returns empty results without crashing.

### Sync Group Standings / Results (per-challenge)

```bash
curl -X POST /api/brackets/world-cup/{challengeId}/admin/sync-group-standings \
  -H "Content-Type: application/json" \
  -d '{"provider":"apifootball"}'
```

This applies provider group standings into `WorldCupGroupTeam.actualRank`, `points`, `goalDifference`, and `goalsFor`, derives the eight actual third-place advancers, and recalculates the leaderboard. Manual admin result entry remains the fallback through:

- `POST /api/brackets/world-cup/{challengeId}/admin/group-results`
- `POST /api/brackets/world-cup/{challengeId}/admin/third-place-results`

### Scheduled Production Sync Path

Run these jobs in order:

1. Teams/groups: call global Sync Teams before launch and whenever FIFA group assignments change.
2. Fixtures: call per-challenge Sync Fixtures after fixtures are official and after provider schedule corrections.
3. Live scores: call Sync Live Scores every 2-5 minutes while matches are active; include leaderboard recalculation.
4. Group standings/results: call Sync Group Standings after group tables are official or at a controlled cadence late in group-stage matchdays.
5. Leaderboard recalculation: call Recalculate after official result ingestion, or rely on result ingestion routes that recalculate automatically.

The scheduled endpoint is:

```bash
curl -X POST /api/brackets/world-cup/cron/sync \
  -H "Authorization: Bearer $WORLD_CUP_CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"job":"live","provider":"apifootball","recalculate":true}'
```

Supported `job` values: `teams`, `fixtures`, `live`, `standings`, `recalculate`, `all`. Pass `challengeId` for a single pool, or omit it to process open/locked/live World Cup pools in a bounded batch.

Vercel cron calls this endpoint with GET. `vercel.json` includes scheduled GET jobs for teams, fixtures, standings, live scores, and recalculation. The endpoint still requires `WORLD_CUP_CRON_SECRET` through Vercel cron auth headers / shared cron auth; do not expose provider keys in cron paths.

Readiness diagnostic:

```bash
curl /api/brackets/world-cup/admin/readiness \
  -H "Authorization: Bearer $WORLD_CUP_CRON_SECRET"
```

The readiness response exposes only non-secret status: provider name, provider/API key presence booleans, production-safe origin booleans, group completeness, fixture count, standings sync status, live route availability, and best-third mapping confirmation.

### Production Deployment Safety Checklist

- [ ] Set Vercel production envs: `NEXTAUTH_URL`, `NEXT_PUBLIC_APP_URL`, `APP_URL` or `PUBLIC_SITE_URL` if used, `DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_SECRET`, `WORLD_CUP_DATA_PROVIDER`, provider API key, `WORLD_CUP_CRON_SECRET`, `WORLD_CUP_BEST_THIRD_MAPPING_CONFIRMED`.
- [ ] Confirm no production origin env uses `localhost`, `127.0.0.1`, or `http://`.
- [ ] Run `npx prisma migrate deploy`.
- [ ] Run `npx prisma generate`.
- [ ] Run `npx prisma validate`.
- [ ] Run `npx vitest run world-cup`.
- [ ] Verify `/api/brackets/world-cup/admin/readiness` as admin or with cron secret.
- [ ] Verify cron sync with a safe job: `GET /api/brackets/world-cup/cron/sync?job=teams&provider=apifootball` or `job=standings`.
- [ ] Verify production invite join flow on the production origin.
- [ ] Verify copied/generated invites do not contain localhost or `127.0.0.1`.
- [ ] Verify bracket lock deadline behavior for group rankings, third-place picks, knockout picks, and finalized entries.

### Admin Click Audit

| Operation | UI handler | API route | Permission check | Success state | Error state |
|-----------|------------|-----------|------------------|---------------|-------------|
| Sync teams | `runSyncTeams` in `WorldCupBracketShell` | `POST /api/brackets/world-cup/admin/sync-teams` | Site admin via `getWorldCupAdminState` | Toast + Teams sync result row, readiness summary | Toast error |
| Sync fixtures | `runSyncFixtures` in `WorldCupBracketShell` | `POST /api/brackets/world-cup/{challengeId}/admin/sync-fixtures` | Owner/admin via `assertWorldCupManager` | Toast + Fixtures sync result row | Toast error |
| Sync live | `runSyncLive` in `WorldCupBracketShell` | `POST /api/brackets/world-cup/{challengeId}/admin/sync-live` | Owner/admin via `assertWorldCupManager` | Toast + Live sync result row + view refresh | Toast error |
| Group standings/results | `runSyncGroupStandings` in `WorldCupBracketShell`; manual API fallback | `POST /api/brackets/world-cup/{challengeId}/admin/sync-group-standings`; `POST /admin/group-results` | Owner/admin via `assertWorldCupManager` | Toast + Standings sync result row + view refresh | Toast/API error |
| Third-place results | API-only manual fallback | `POST /api/brackets/world-cup/{challengeId}/admin/third-place-results` | Owner/admin via `assertWorldCupManager` | JSON result + refreshed view | JSON error |
| Recalculate leaderboard | `runOwnerAction("recalculate")` and leaderboard tab action | `POST /api/brackets/world-cup/{challengeId}/recalculate` | Owner/admin via `assertWorldCupManager` | View refresh / leaderboard result | Non-OK response, no broad UI replacement in this slice |

Round of 32 population from official group results is intentionally service-gated. Do not enable a UI button until FIFA publishes/validates the best-third matchup table and an explicit mapping is configured.
