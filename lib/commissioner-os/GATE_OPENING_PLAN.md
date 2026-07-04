# Commissioner OS — Controlled Gate Opening Plan

**Planning document only. Nothing in this file has been implemented.** No
flags were changed, no env vars were touched, no code was modified while
producing this plan. Builds directly on the two gates identified in
`PRODUCTION_VISUAL_UPDATE_AUDIT.md`:

- **Gate A** — the `commissioner_os_data_mode` cookie (default `demo`;
  the only setter, `DataModeIndicator`, is hard-disabled whenever
  `NODE_ENV === 'production'`).
- **Gate B** — the Decision OS Intelligence API itself, which requires
  **both** `DECISION_OS_BASE_URL` (checked client-side, in
  `adapter/transport/config.ts`'s `isDecisionOSConfigured()`, before any
  network call is attempted) **and** `DECISION_OS_INTELLIGENCE_API_ENABLED`
  (checked server-side, in `lib/decision-os/behavioral/api/gate.ts:81`,
  once a call actually arrives). Both are currently unset in Production.

A relevant existing mechanism found this pass: `lib/auth/admin.ts` already
defines a static, reusable "all-access" allowlist —
`STATIC_ALL_ACCESS_USERNAMES = ["theciege26"]` (line 8), exposed via
`isSiteAdmin()` / `hasAllFantasyTestAccess()`, and already backed by the
`ALL_ACCESS_USERNAMES`/`ADMIN_EMAILS` Production env vars. **TheCiege26 is
already in this allowlist today, with no new provisioning required** —
this is the natural, reuse-not-invent mechanism for any "admin/test
account only" option below, rather than building a new one.

---

## Option A — Admin-only `commissioner_os_data_mode=live`, Decision OS API stays disabled

**What it would do:** loosen `DataModeIndicator.tsx`'s production check
from an unconditional `NODE_ENV === 'production'` block to an
admin-only check (reusing `isSiteAdmin()`), while leaving Gate B fully
closed.

| | |
|---|---|
| **Risk** | **Low.** With Gate B still closed, `callDecisionOS()` short-circuits at `isDecisionOSConfigured()` (`DECISION_OS_BASE_URL` absent) before any network call is ever attempted — there is no path to a real intelligence response, so this cannot leak real data or add real load to any backend. The only functional change is what the admin's own browser renders. |
| **User-visible effect** | **Only for whichever account(s) are granted the check** — everyone else sees no change at all. Important nuance: the admin would see Analytics/Mission Control switch from the current *polished demo cards* to the honest `upstream_unavailable`/"not yet integrated" placeholder state — a visual **downgrade** in perceived polish, not an upgrade, since Gate B still blocks any real data. Useful for proving the honest-degradation path end-to-end in Production, not for showing "real intelligence works." |
| **Rollback** | Revert the admin-check condition (redeploy), or simply never grant any account the flag. No data changes, nothing to undo in the database. |
| **Exact files/env vars touched** | `components/commissioner-os/demo-mode/DataModeIndicator.tsx` (change the gate condition), `app/commissioner-os/layout.tsx` (resolve session server-side, pass an `isAdmin` boolean down), `components/commissioner-os/shell/CommissionerHeader.tsx` (thread the prop through to `DataModeIndicator`). **No new env vars required** — reuses the existing `ALL_ACCESS_USERNAMES`/`ADMIN_EMAILS`/static allowlist already in Production. |
| **Exposes live data?** | **No.** At most exposes an honest "not available" state — never fabricated or real intelligence. |
| **Limitable to TheCiege26 only?** | **Yes, trivially** — `theciege26` is already hardcoded in `STATIC_ALL_ACCESS_USERNAMES`; `isSiteAdmin()` already returns `true` for that account with zero new configuration. |

---

## Option B — Enable Decision OS Intelligence API in Production, `commissioner_os_data_mode` locked to `demo`

**What it would do:** set `DECISION_OS_BASE_URL`, `DECISION_OS_API_KEY`,
`DECISION_OS_INTELLIGENCE_API_ENABLED=true` (and `INTELLIGENCE_API_TEST_KEYS`
if using test-tier keys) for Production, with **no** code change to
`DataModeIndicator` — Gate A stays closed for every UI session.

| | |
|---|---|
| **Risk** | **Medium — and the risk is not where it looks.** Because Gate A remains closed for literally every Commissioner OS session (no code path sets the cookie), `getDecisionOSClient()`/`getDecisionOSAdapter()` never select the `live` implementation for **anyone** — this option is **completely inert for the Commissioner OS UI**, for the identical reason the two already-enabled `isLiveReady` flags are inert (see `PRODUCTION_VISUAL_UPDATE_AUDIT.md`). The real effect of Option B is elsewhere: it makes `/api/v1/intelligence/*` genuinely reachable **as a standalone API** by anyone presenting a valid `X-AllFantasy-API-Key` — not just by this app's own UI. That reopens the two concrete gaps already flagged in `EXECUTIVE_LICENSING_READINESS_REPORT.md` §10: unknown *test*-env keys silently resolve to `'basic'` tier instead of being rejected, and rate limiting is modeled in `contracts.ts` but never enforced anywhere in code. Enabling this flag in Production is the point where those two previously-theoretical gaps become live exposure. |
| **User-visible effect** | **In the Commissioner OS UI: none** (Gate A still shut for all UI sessions). **For any external caller with a valid key: the raw Intelligence API becomes queryable directly**, independent of and invisible to the Commissioner OS UI entirely. |
| **Rollback** | Fast — `vercel env rm DECISION_OS_INTELLIGENCE_API_ENABLED production` (or set to `false`) takes effect on the next request, no redeploy needed (`gate.ts` reads `process.env` at request time, not at build time). Removing `DECISION_OS_BASE_URL`/`DECISION_OS_API_KEY` closes the self-referential-call side too. |
| **Exact files/env vars touched** | No code changes. Vercel Production env vars only: `DECISION_OS_INTELLIGENCE_API_ENABLED=true`, `DECISION_OS_BASE_URL` (e.g. `https://www.allfantasy.ai`), `DECISION_OS_API_KEY` (format `afk_{test|live}_{16+ chars}`), optionally `INTELLIGENCE_API_TEST_KEYS`. |
| **Exposes live data?** | To the Commissioner OS UI: no. **To anyone holding a valid API key: yes** — real Decision OS Intelligence API responses, for whatever a given key's tier permits. This is the material exposure of Option B, and it is an API-surface decision, not a UI decision. |
| **Limitable to TheCiege26 only?** | **Only weakly.** The API key mechanism is service/tier-scoped (`basic`/`commissioner`/`manager`/`platform`), not per-`AppUser` — you can hand out exactly one key to yourself, but nothing in `gate.ts` ties a key to a specific account, and (per the licensing audit) an unregistered test-env key still resolves to `basic` rather than being rejected outright. Real single-account scoping is not native to this mechanism. |

---

## Option C — Open both gates, restricted to one admin/test account only

**What it would do:** combine Option A (admin-gated cookie) with Option
B (API enablement) — but constrain end-to-end visibility of *real* data
to TheCiege26 specifically, not to anyone holding a key.

**Important implementation nuance surfaced by comparing A and B
directly:** naively doing "A, then B" is not sufficient to keep exposure
to one account. Gate B's env var is environment-wide with no per-user
concept — turning it on for TheCiege26's UI session also turns it on for
any external caller with a valid key, exactly as in Option B. **True
single-account restriction requires one additional, targeted check** —
verifying the caller's session identity against the same
`isSiteAdmin()`/allowlist *inside* `analytics/decision-os-client/live.ts`
and `decision-os-client/live.ts` (Mission Control), before ever calling
`callDecisionOS()` — independent of the blanket environment flag. This
touches the Decision OS Intelligence API consumption boundary that
`ARCHITECTURE_FREEZE.md` treats as frozen, so per that project's own
convention it would warrant a short ADR before implementation, not be
folded silently into "just flip two flags."

| | |
|---|---|
| **Risk** | **Medium** — same as Option A for the UI side (low/no exposure), same as Option B for the raw API side (external-key exposure) **unless** the additional per-account check above is also built. Without it, Option C's real-world risk profile is identical to Option B's, just with an extra, cosmetic UI restriction that doesn't actually close the underlying exposure. |
| **User-visible effect** | TheCiege26 (and only TheCiege26, assuming the account-scoping check is added) sees real Decision OS data in Analytics/Mission Control, since both already-enabled `isLiveReady` flags would finally have both gates open for that one session. Everyone else's UI is unaffected. Anyone holding a valid API key can still reach the raw endpoints directly, same caveat as Option B, unless the per-account check is added to `gate.ts` itself (a materially larger change to frozen code, not recommended as part of this plan). |
| **Rollback** | Revert both Option A's admin-check change and Option B's env vars (and the additional per-account `live.ts` check, if built). No data changes. |
| **Exact files/env vars touched** | Everything in Option A + everything in Option B, plus (if truly restricting exposure) `lib/commissioner-os/analytics/decision-os-client/live.ts` and `lib/commissioner-os/decision-os-client/live.ts` for the per-account check. |
| **Exposes live data?** | To TheCiege26: yes, by design. To the general public/UI: no. To anyone holding a valid API key directly: **yes**, same as Option B, unless the additional per-account check is also implemented. |
| **Limitable to TheCiege26 only?** | **Yes for the Commissioner OS UI path** (reuses the existing allowlist, zero new provisioning). **Only "yes, with a caveat" for the raw API path** — genuinely restricting that requires the additional `live.ts`-level check described above, which is a small but real code change to the Decision OS consumption boundary, not a pure Commissioner OS change. |

---

## Side-by-Side Comparison

| | Option A | Option B | Option C |
|---|---|---|---|
| Risk | Low | Medium (API-surface exposure) | Medium (same, unless scoped) |
| Commissioner OS UI changes for real users | No | No | No |
| TheCiege26 sees real intelligence in the UI | No (sees honest error state instead) | No | **Yes** |
| Raw API becomes reachable by any valid key-holder | No | **Yes** | Yes, unless the extra per-account check is added |
| Code changes required | Small (UI gate only) | None (env vars only) | Small–medium (UI gate + optional API-boundary check) |
| Touches frozen Decision OS architecture | No | No | Only if the per-account check is added |
| Fully reversible without redeploy | Partial (env-only parts yes; code parts need redeploy) | Yes | Partial, same as A |

---

## Observation Worth Flagging Before Any Decision

**Option A and Option B, taken alone, each solve only half the problem
documented in `PRODUCTION_VISUAL_UPDATE_AUDIT.md`.** Neither one, by
itself, would make TheCiege26 (or anyone) actually see real Decision OS
data in the Commissioner OS UI — Option A still hits Gate B's closed
door, Option B still never gets selected because Gate A never opens.
Only Option C (with its additional per-account scoping check) achieves
the specific outcome "one named account sees real data end-to-end,
nobody else's UI changes." Option B's real consequence is independent of
the UI entirely — it is a decision about opening the Decision OS
Intelligence API as its own reachable surface, which should be evaluated
on those terms (see the licensing-audit gaps above), not treated as a
step toward a UI demo.

## No Action Taken

Per your instruction, nothing above has been implemented: no flags
changed, no env vars touched, no code modified, no additional
`isLiveReady` flags enabled, no changes to NFL Redraft, no architecture
redesign. This is a comparison for you to choose from — awaiting your
decision on which option (if any) to pursue, and for whom.
