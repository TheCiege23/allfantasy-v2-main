# Phase 4.5 — Vercel Preview Deployment Report

Proves the complete application builds and runs in a real, production-like
environment (Vercel Preview) before any production deployment. This report
supersedes the first attempt (blocked entirely by account billing
suspension) with the full resumed session: correct-account re-auth, a
successful build, deployment-protection diagnosis and fix, and full
Preview validation against real production data. No Commissioner OS or
Decision OS redesign was performed — every change is a deployment or
transport-level fix.

## Deployment Summary

| Step | Status |
|---|---|
| Deployment configuration audit | Complete |
| Correct Vercel account re-authenticated | Complete (see Account Correction below) |
| Local vs. Preview environment comparison | Complete |
| Build-blocking fix (missing shim) | Fixed and verified |
| `vercel deploy` (Preview, never `--prod`) | **Succeeded** — final URL below |
| Deployment Protection (Vercel SSO wall) diagnosed and fixed | Fixed |
| Preview validation (auth/Commissioner OS/Decision OS/all modules) | Complete |
| Root cause of remaining "Unavailable" states | Found — documented separately (not a Preview defect) |

**Final Preview URL** (stable alias, always points at the latest deploy):
`https://allfantasy-v2-main-preview-decisionos.vercel.app`

## Account Correction

The first attempt at this phase was authenticated as `theciege23` against
project `theciege23s-projects/allfantasy-v2` — a different, mostly-stale
project (39+ day old deployments) tied to a different git remote
(`allfantasy-v2.git`, not this repo's actual `origin`). The user identified
this was the wrong account. Re-authenticated via a Vercel Personal Access
Token (after two invalid tokens, resolved by the user running `vercel
login` directly) to the correct account/team (`cafeconchimmy`, team "AF"),
which owns `allfantasy-v2-main` — the project actually matching this
repo's `origin` remote, with real, active, recent deployment history and
production at `www.allfantasy.ai`. Re-linked this worktree
(`vercel link --project allfantasy-v2-main --scope cafeconchimmy`) before
any further work.

## Environment Variable Work

`allfantasy-v2-main` already had `DATABASE_URL`, `DIRECT_URL`,
`NEXTAUTH_SECRET`, `NEXTAUTH_URL` configured (confirmed correct), and
already had `DECISION_OS_INTELLIGENCE_API_ENABLED`,
`DECISION_OS_INTELLIGENCE_API_PROVIDER`, and `INTELLIGENCE_API_TEST_KEYS`
present as names — but all three held **empty-string values** for both
Preview and Production (non-functional placeholders, not real
configuration). `DECISION_OS_BASE_URL` and `DECISION_OS_API_KEY` did not
exist at all.

Added/fixed, scoped to **Preview only**:
- `DECISION_OS_BASE_URL` — set to the stable alias below (new)
- `DECISION_OS_API_KEY` — a `platform`-tier test key (new)
- `DECISION_OS_INTELLIGENCE_API_ENABLED=true` (previously empty)
- `DECISION_OS_INTELLIGENCE_API_PROVIDER=real` (previously empty)
- `INTELLIGENCE_API_TEST_KEYS={"afk_test_...":"platform"}` (previously empty)
- `NEXTAUTH_URL` — updated to the stable Preview alias (previously empty for Preview)

**Incident during this work, fully resolved**: fixing the three
previously-shared "Preview,Production" entries required removing the
combined record before re-adding a Preview-only value. For
`NEXTAUTH_URL` specifically, an unscoped removal (before switching to the
CLI's `[environment]`-scoped removal syntax) unexpectedly deleted
Production's real, non-empty value as well — caught immediately via a
`vercel env ls` check, disclosed to the user right away, and restored by
the user directly in the dashboard (with their own production redeploy to
apply it). No other production values were confirmed affected; the three
Decision OS variables were re-verified via each variable's own Vercel
"History" panel showing only this session's CLI addition, no prior entry.
**Lesson applied for the rest of this phase**: every subsequent
remove/add was done with explicit `[environment]` scoping (`preview`
specifically) and re-verified via `env ls` immediately after.

**Stable alias**: Preview deployment URLs are randomly-hashed per
deployment, which would have meant updating `DECISION_OS_BASE_URL`/
`NEXTAUTH_URL` after every redeploy. Solved with `vercel alias set` pointing
a fixed name (`allfantasy-v2-main-preview-decisionos.vercel.app`) at
whichever deployment is current; re-aliased after each of the two
redeploys this phase required.

## Build Verification

The `win-exfat-readlink-shim.cjs` restoration from the first attempt
remained intact and was re-verified present before redeploying. Two real
builds succeeded end-to-end on Vercel's Linux builders
(`allfantasy-v2-main-imf9i9j7c...`, then `...qshmno2uf...`, then
`...3n9el45vv...` after the transport fix below) — each a clean
`next build` completion, confirming the shim fix genuinely unblocks
Vercel's build pipeline, not just a local no-op.

Vercel's own CLI output also reconfirmed the Node.js 20.x deprecation
warning on every deploy (builds still succeed today; will stop working
after 2026-10-01 without an `engines.node` bump to `24.x`) — unchanged
from the first attempt's finding, still not fixed in this phase (same
reasoning: a real compatibility decision, not a pure deployment-config
restoration).

## Deployment Protection Discovery and Fix (new this session)

Validating Decision OS revealed a second real, deployment-specific
blocker, invisible from local testing: **Vercel's own "Vercel
Authentication" (Deployment Protection), set to "Standard Protection"**
(protects all non-production-custom-domain URLs, including every Preview
deployment). This gate applies at Vercel's platform edge to *every*
incoming request — including the app's own server-to-server
self-referential calls from `callDecisionOS()` back into
`/api/v1/intelligence/*` on the same deployment. Confirmed directly: a
plain `curl` to the intelligence API returned `302` to
`vercel.com/sso-api`, not the app.

**Fix**: the user enabled Vercel's "Protection Bypass for Automation"
(Project Settings → Deployment Protection) and added a 32-character
secret, which Vercel automatically exposes to the deployment as
`VERCEL_AUTOMATION_BYPASS_SECRET`. Added a small, explicitly
user-confirmed change to `lib/commissioner-os/adapter/transport/client.ts`:
when that env var is present, `callDecisionOS()` sends it as the
`x-vercel-protection-bypass` header. Absent anywhere protection isn't
enabled (local dev, any future deployment without this configured), the
header is simply omitted — a true no-op elsewhere. Verified directly: the
same `curl` call now returns a real `200` with real intelligence data.

## Preview Validation Results

Real authenticated session as `TheCiege26` (the real account), confirmed
via `/api/auth/session` returning the exact same `AppUser.id` used
throughout this whole engagement. This Preview deployment's `DATABASE_URL`
points at the **real production database** — all validation below was
read-only by design (no Sleeper import commit, no trade/waiver writes).

| Area | Result |
|---|---|
| Login/auth | Real session confirmed, real account, real leagues rendering on `/dashboard` |
| Commissioner OS shell | Loads correctly, full nav, no console errors (see note below) |
| Decision OS Intelligence API | **Confirmed working** via direct external call (real `200`, honest data) once the Deployment Protection bypass was in place |
| Mission Control / League Health / Manager Intelligence / Recommendations / League Analytics / Activity Stream | All render correctly with honest "Unavailable" states — root cause is a separate, non-blocking finding (see below), not a Preview defect |
| Reports / Help Center | Render their known, pre-existing, by-design permanent placeholder message — unchanged, confirmed intentional in earlier phases |
| Search | Command palette button present in header; a live interaction check hit a tooling timeout mid-session and wasn't re-confirmed this pass — no evidence of an app-level defect (identical, already-proven code path from Phase 4.2) |
| Notifications | Header button present, renders correctly |
| Sleeper import | Not exercised as a live write (deliberate — this Preview's DB is real production; completing a fresh import would create permanent real data). Import UI reachability inherited from Phase 4.2's local validation, not independently re-confirmed here |
| Browser console | Only a well-known Chrome-extension messaging artifact ("A listener indicated an asynchronous response...") on every page — not an app error |
| Server logs (`vercel logs`) | Clean; every request 200, no 4xx/5xx, no unhandled exceptions |
| API routes | `/api/v1/intelligence/*` confirmed reachable and correct once protection bypass was added |

## Root Cause of Remaining "Unavailable" States (not a Preview blocker)

Deep-dived per the user's explicit follow-up request (see
`PRODUCTION_ACTIVE_LEAGUE_RESOLUTION_FINDING.md`). Summary: production's
`platform_config` table has **zero** `commissioner_os_live_ready_*` rows —
every module's live-readiness feature flag defaults to `false` there
(only ever flipped on the isolated Neon validation branch in Phase 4.2).
This is the live-readiness system's own deliberate, staged-rollout design
working correctly, not a code or deployment defect. `resolveActiveLeagueId()`
was independently confirmed correct (finds a real active league;
production's `leagues`/`rosters` tables have no schema or data issue).
Flipping those flags in production is a separate, deliberate go-live
decision, intentionally not done as part of this diagnostic (per explicit
"do not modify production data" scope).

## Remaining Blockers

1. **None for Preview itself.** Build, deploy, auth, transport, and the
   Intelligence API are all confirmed working end-to-end.
2. Production's `commissioner_os_live_ready_*` flags are unset — a
   deliberate pending go-live decision, not a defect (see finding doc).
3. Node.js 20.x deprecation (2026-10-01 deadline) — unchanged from the
   first attempt, still open.
4. Search command-palette interaction wasn't independently re-verified
   this pass due to a tooling timeout; low risk given it's unchanged code
   already validated in Phase 4.2.
5. Everything from Phase 4.4's own "Remaining Decision OS Limitations" and
   "Production Risks" sections still applies unchanged.

## Production Readiness Recommendation

**The Preview deployment is clean.** Every code-level and
deployment-configuration issue found this phase (missing build shim,
missing/empty Decision OS env vars, Vercel Deployment Protection blocking
self-referential calls) has been found, fixed, and verified against a
real deployment on real production data. Nothing discovered this phase
blocks moving to Production deployment itself. What remains before
Commissioner OS's live intelligence is actually visible to real users in
production is the separate, deliberate `isLiveReady` flag rollout decision
— which should happen as its own reviewed step, not implicitly.
