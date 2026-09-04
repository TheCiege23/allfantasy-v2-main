# Commissioner OS — Deployment Readiness Note

Compiled at the close of the Decision OS live-integration audit program
(Phases 3.2–3.15, twelve modules). This is a factual checklist of what
stands between the current state of this worktree and a real Vercel
preview/production deployment — not a recommendation to deploy, and not
an action taken.

## 1. Nothing here is committed yet — the largest blocker

Every file this entire program touched — all of `lib/commissioner-os/`,
`components/commissioner-os/`, `app/commissioner-os/`, and all
`__tests__/commissioner-os-*` test files — is **untracked** on this
branch (`claude/hungry-swartz-45f298`), confirmed via `git status`
directly, not assumed. Four pre-existing files (`.env.example`,
`app/globals.css`, `middleware.ts`, `vitest.setup.ts`) are modified but
also uncommitted. Nothing can reach Vercel — preview or production —
until this work is actually committed and pushed. This note does not
commit anything; that is the user's call, per this session's own
standing instruction to only commit when explicitly asked.

## 2. The Decision OS backend port has never been merged

Every `live.ts` file this program wired talks to Decision OS through
`callDecisionOS()` → HTTP → `DECISION_OS_BASE_URL`. That backend's code
only exists on `port/decision-os-backend`, a separate branch, in a
separate worktree, never merged into this branch or into `main` —
verified repeatedly this session via direct `git log`/`git status`
checks, and independently confirmed by this repository's own
`.env.example` (line 426): *"...until the selective port,
`lib/commissioner-os/DECISION_OS_PORT_MANIFEST.md`, is merged."* Without
this merge, `DECISION_OS_BASE_URL` has nothing real to point at, no
matter what else is configured.

## 3. Decision OS environment variables are unset by design

`.env.example` defines `DECISION_OS_BASE_URL`, `DECISION_OS_API_KEY`,
`DECISION_OS_TIMEOUT_MS` — all blank templates. `isDecisionOSConfigured()`
(`lib/commissioner-os/adapter/transport/config.ts`) is explicitly
`false` whenever `DECISION_OS_BASE_URL` is empty, "never assumed true"
per its own doc comment. These need real values in Vercel's environment
configuration, and only make sense *after* item 2 is resolved (there
must be a real, deployed Decision OS endpoint to point at).

## 4. Prisma migrations from the port branch need to be applied

The port branch's additive schema changes (7 models added in the
original port, `IntelligenceLeagueSnapshotHistory` added in Phase 3.3)
exist only on `port/decision-os-backend`. Once that branch is merged,
its migrations need to run against whatever database the Vercel
preview/production deployment connects to.

## 5. Per-module live-readiness flags all default to false

`isLiveReady(moduleId)` (`lib/commissioner-os/liveReadiness.ts`) reads a
DB-backed flag (via `lib/feature-toggle`) that defaults `false` for
every namespace, including the two platform services (`search`,
`notifications`) added to its accepted type in Phase 3.12. **This is by
design, not a blocker** — it's the intended gradual-rollout mechanism
("each namespace can be switched on independently... rather than
all-or-nothing," per the file's own doc comment). No namespace has ever
been flipped on in this program. Once items 1–4 are resolved, flipping
these is a deliberate, separate decision per module — not an automatic
consequence of deploying.

**Recommended flip order, based on this program's own findings:**
Mission Control and League Analytics first (genuinely complete or
partial real data today); League Health second (1-of-4 methods real);
Manager Intelligence / Recommendations Center / Search / Notifications /
Activity Stream next (composition layers or gapped modules — flipping
them is safe and inert today, since their sources still degrade
honestly); Workspace / Automation Center / Reports / Help Center last,
or not at all until their named structural gaps close (see each
module's own `*_LIVE_INTEGRATION_REPORT.md`).

## 6. Commissioner OS module flags need no action

`DEFAULT_COMMISSIONER_MODULE_FLAGS`
(`lib/commissioner-os/featureFlags.ts`) — all eleven modules default
`true` ("every module defaults to enabled during this scaffolding
phase — there is nothing yet to hide"). No change needed unless the
team wants to stage which modules are even *visible* independent of
their live-readiness.

## 7. Local build cannot fully verify — use a real Vercel preview

This machine hits a Windows-only `readlink`/`EISDIR` error running
`npm run vercel-build` locally (pre-existing, documented, unrelated to
Commissioner OS). Full build verification has never happened for any of
this program's twelve phases — it needs a real Vercel preview deploy (or
equivalent Linux CI run), not a local command, before this is trusted as
build-clean.

## 8. TypeScript baseline (3156 errors) is pre-existing and unchanged

Confirmed unchanged across all twelve phases in this program (every
phase's report verified this exact count). These are not Commissioner OS
errors — they predate this program and live elsewhere in the repository
(`server/services/standingsEngine.ts`, `weeklyProcessor.ts`, etc., per
spot-checks this session). Whether `next build` itself is blocked by
these (vs. only `tsc --noEmit` in strict/full-repo mode) has not been
verified in this session — worth confirming directly on a real preview
build rather than assuming either way.

## 9. What deploying today, as-is, would actually do

If items 1–2 were resolved (committed and pushed) but items 3–5 were
left untouched (no Decision OS URL, no flags flipped): Commissioner OS
would behave exactly as it does in this worktree's demo/stub modes today
— every `live.ts` gate returns the honest placeholder, nothing new is
exposed, nothing breaks. This is a **low-risk deploy shape**: shipping
the code is safe on its own; shipping *live Decision OS behavior* is a
separate, explicit, per-module decision gated behind steps 2–5.

## 10. One thing not yet done: a holistic demo/stub smoke test

Every `live.ts` change across all twelve phases was verified by
typecheck + vitest, with browser/preview verification explicitly skipped
each time (per this session's own `<when_to_verify>` guidance — the
changes are gated behind flags that default false, so they are not
browser-observable in their live-mode behavior). What has **not** been
re-verified in a running browser across this whole program is that
Commissioner OS's existing *demo/stub* experience (the actual thing
users see today) still renders correctly after twelve phases of touching
shared infrastructure (`resolveActiveLeagueId.ts` extraction,
`isLiveReady`'s type widening, the `conditionToEventSeverity` /
`SETTINGS_RESULTS` shared-module extractions). The full Commissioner OS
vitest suite (382/382, including the pre-existing UI/shell/component
tests) passing is strong evidence nothing broke, but an actual browser
smoke test of `/commissioner-os` in demo mode has not been performed in
this program and would be a reasonable final check before any real
deploy.

## Summary checklist

| # | Item | Status |
|---|---|---|
| 1 | Commit + push this branch's work | **Not done** |
| 2 | Merge `port/decision-os-backend` | **Not done** |
| 3 | Set `DECISION_OS_BASE_URL`/`DECISION_OS_API_KEY` in Vercel | **Not done** (blocked on #2) |
| 4 | Apply port branch's Prisma migrations to the target DB | **Not done** (blocked on #2) |
| 5 | Flip `isLiveReady` per module, in the recommended order | **Not started** (deliberate, staged decision) |
| 6 | Commissioner OS module flags | No action needed — all enabled by default |
| 7 | Real Vercel/Linux build verification | **Not done this program** — local build cannot verify |
| 8 | Confirm whether the 3156-error TS baseline blocks `next build` | **Not verified** |
| 9 | Deploy-as-is risk | Low — inert until flags 3–5 are flipped |
| 10 | Browser smoke test of demo/stub experience | **Not done this program** |
