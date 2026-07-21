# AF_LEGACY_AUTH_SWEEP_BUILD — Close the systemic legacy IDOR (24 routes)

_Decision: full sweep (Jul 19, 2026). This generalizes the player-finder fix to the rest and adds a CI guard so the class can't silently reopen._

## STATUS (updated Jul 20)
- **Scope corrected: 18 routes**, not 24 — only routes taking `sleeper_username` as REQUEST INPUT are IDOR-able; of 31 modules mentioning the column, 12 derive it server-side (already safe).
- **✅ DONE — PR #287:** player-finder IDOR closed, `players/sync` gated, `limit` capped, `proxyToExisting` XFF fixed. Rebased onto post-#284 main, 9 tests green.
- **✅ DONE — foundation pushed on `claude/legacy-auth-sweep`:** `requireLegacySleeperIdentity` helper (session-or-guest, 401/403/409/429, 12 tests + 4 neg-controls). Discovery: `af_guest_session` is a signed JWT carrying `{legacyUserId, sleeperUsername}` — real crypto binding, so the guest path is sound.
- **REMAINING (continue from the branch):** migrate the 18 request-input routes onto the helper (classify guest-usable vs full-auth), retire/rename `requireAuthOrOrigin` + fix the `requireAuth` collision, and add the CI guard — guard ships in the SAME PR as the fixes.

## The hole (verified)
`lib/api-auth.ts` `requireAuthOrOrigin` returns `{authenticated:true, user:null}` whenever `validateRequestOrigin` passes — and that's only an `Origin`/`Referer` `startsWith` check (returns `true` entirely in dev). Those headers are trivially set by any non-browser client, so the ~20 legacy routes using it are effectively UNAUTHENTICATED. Sibling `requireAuth(req)` requires the `af_session` cookie, but that cookie is HMAC-signed over a `sleeperUsername` the user SELF-ASSERTS via `POST /api/legacy/session` (never verified) → IDOR-able. Net: **25 of 31 legacy routes reading `sleeper_username` expose any user's rosters/trades/owners.** Sleeper has no OAuth, so handle ownership can't be proven — the achievable goal is "no anonymous enumeration, attributable, rate-limited," not true authorization.

## The fix pattern (from player-finder)
Derive the caller's Sleeper identity SERVER-SIDE from the NextAuth session: `AppUser.legacyUserId → LegacyUser.sleeperUsername` (server-managed, exclusive — a legacy user can't be claimed by two accounts). **NOT `UserProfile.sleeperUsername`** (mutable display handle → reintroduces the hole). 403 when a body-supplied username disagrees with the caller's own link; 409 when no Sleeper account is linked. Per-user rate limit with `includeIpInKey: true` — **confirm the #278 rate-limit hardening is present on the working branch first** (memory: it isn't on every branch).

## Guest funnel — the product constraint
`guest-import` creates `LegacyUser` rows with no `AppUser`, so guests have no NextAuth session; requiring one locks them out of their own imported data. For routes a guest legitimately uses, accept EITHER identity: a NextAuth session (derive username) OR a valid guest session (`af_guest_session`, tied to the guest's own claimed username). That closes anonymous unlimited enumeration (the actual vuln) while preserving the funnel. Routes exposing cross-user / commissioner data with no guest use-case require full auth.

## Scope of work
1. **Neutralize the decorative helper.** Rename/repurpose `requireAuthOrOrigin` so it reads as the CSRF-origin check it is, never "auth." Fix the `requireAuth` name-collision with `lib/auth-guard` (arity is the only tell — a real trap).
2. **One shared `requireLegacySleeperIdentity(req)` helper** implementing the pattern (session-or-guest → resolved username, 403/409 shapes, rate-limit hook). One tested helper, not 24 hand-rolled checks.
3. **Enumerate + classify all 31 legacy routes reading `sleeper_username`** (25 unguarded). Per route: does a guest legitimately use it? → session-or-guest; else → full session. Move each onto the shared helper.
4. **`proxyToExisting` must forward `x-forwarded-for`** (done on the player-finder branch — confirm it lands) so per-IP limits don't collapse into one `ip:unknown` bucket.
5. **Cap unbounded `limit` params** feeding queries (player-finder capped at 50; audit the rest).

## Build checklist (7)
Visuals n/a (API). Backend: helper + ~24 route edits. UI/UX: clean 401/403/409, and the client shows a real "sign in / link Sleeper" state, not a terse Unauthorized — the guest-breakage follow-up on `app/af-legacy/page.tsx` (a 5k-line file; copy-only, separate change). Delete old code: retire/rename `requireAuthOrOrigin`. Fixes/gaps: the whole class. SEO n/a. Brand: honest error copy, no "AI".

## CI guard (the durable win — into #281 Security suites)
A vitest guard enumerating every legacy route reading `sleeper_username` from the body, asserting each imports the shared identity helper (or is on an explicit public allowlist). Same shape as `admin-api-protection`: **collect ALL offenders → assert empty + non-empty floor** (don't `expect()` inside the loop — that antipattern made two guards dead this session). Negative-control it.

## Verification
Per route: anonymous → 401; wrong-username with a valid session → 403; own username → 200; guest own-data → 200. Negative-control EACH guard — and beware the control that hits a same-shaped `where:{sleeperUsername}` in the wrong function (it silently passed on player-finder; use exact-match edits). Serialize vitest workers on this box (`--no-file-parallelism` worked). tsc via the CI ratchet, not local (false-cleans).

## Claude Code prompt
`implement the plan in AF_LEGACY_AUTH_SWEEP_BUILD.md` — first land the player-finder branch (`claude/cranky-wu-f2871b`) as its own PR (it closes one live IDOR), then generalize. Ship the CI guard in the same PR as the sweep.
