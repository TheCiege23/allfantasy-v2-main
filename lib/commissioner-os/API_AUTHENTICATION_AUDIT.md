# API Authentication Audit — Phase L2

Commercial Readiness / Phase L2 — API Security Hardening. Audits every
authentication path the Decision OS Intelligence API and Commissioner
OS's own call into it can take, identifying every point where a
permissive, test-only, or preview-only behavior could reach Production.
Read-and-verify audit; the one concrete fix this audit identified is
implemented and covered separately in `API_SECURITY_HARDENING_REPORT.md`.

## 1. Every Authentication Path, End to End

There are exactly two authentication layers in play, and they are
independent of each other:

### 1a. Decision OS Intelligence API's own gate (the real security boundary)
**File:** `lib/decision-os/behavioral/api/gate.ts`, `checkIntelligenceGate()`.
Every one of the 6 route handlers in `lib/decision-os/behavioral/api/intelligence-handlers.ts`
(`platformIntelligenceHandler`, `leagueIntelligenceHandler`,
`leagueManagersIntelligenceHandler`, `leagueTrendIntelligenceHandler`,
`leagueDeadlineIntelligenceHandler`, `managerIntelligenceHandler`) calls
this gate as its very first line — confirmed by reading all 6; there is
no route that skips it, and no route file (`app/api/v1/intelligence/**/route.ts`)
contains any logic of its own beyond passing the request through to its
handler. This is the single chokepoint for the entire API.

Checks performed, in order:
1. **Feature flag** — `DECISION_OS_INTELLIGENCE_API_ENABLED !== 'true'` → `503`. Fail-safe: absent or any other value means disabled.
2. **API key header presence** — `X-AllFantasy-API-Key` missing → `401`.
3. **Key format** — must match `^afk_(test|live)_([A-Za-z0-9]{16,})$` → else `401`.
4. **Tier resolution** — looks up the full key in `INTELLIGENCE_API_TEST_KEYS` (a JSON map of key → tier).

### 1b. Commissioner OS's admin-only live-mode gate (Phase L1, unrelated purpose)
**File:** `lib/commissioner-os/liveModeAccess.ts`, `canAccessLiveDecisionOSData()`.
This is *not* part of the Decision OS API's own authentication — it is
Commissioner OS's own, additional, independent check (added in Phase L1)
that decides whether *Commissioner OS itself* will even attempt to call
the Decision OS API on a given session's behalf. It reuses the existing
site-admin allowlist (`isSiteAdmin()`, `lib/auth/admin.ts`) and sits
entirely upstream of `callDecisionOS()`. Confirmed unaffected by this
phase's changes (see §5).

## 2. Where Test/Dev/Fallback/Permissive/Preview-Only Behavior Could Reach Production

| Candidate | Found? | Reaches Production? | Disposition |
|---|---|---|---|
| **Unregistered test-key fallback** (`afk_test_*` not in the map → `'basic'` tier, `gate.ts`, previously unconditional) | **Yes** | **Yes, if Gate B were ever enabled without also fixing this** | **Fixed this phase** — see `API_SECURITY_HARDENING_REPORT.md`. Now rejected whenever `VERCEL_ENV === 'production'`. |
| Unregistered live-key fallback | Checked | No — live keys were already always rejected if unregistered, in every environment. No change needed. | Confirmed already strict. |
| A separate "development key" concept | Checked, not found | N/A | `KEY_REGEX` recognizes exactly two prefixes, `test` and `live` — no third, more-permissive prefix exists anywhere in `gate.ts` or `contracts.ts`. |
| Session-forwarding fallback in the transport layer (`X-Commissioner-User-Id`, `lib/commissioner-os/adapter/transport/auth.ts`) | Yes, exists | **No** — confirmed by grep: zero references to this header anywhere in `lib/decision-os/`. `gate.ts` is API-key-only; this header is never read. | Inert. Documented, not modified (see §6 — modifying this touches the transport layer, out of scope, and it poses no actual risk since nothing reads it). |
| Preview-only Decision OS credentials leaking into Production | Checked | No | `DECISION_OS_BASE_URL`, `DECISION_OS_API_KEY`, `DECISION_OS_INTELLIGENCE_API_ENABLED`, `DECISION_OS_INTELLIGENCE_API_PROVIDER`, `INTELLIGENCE_API_TEST_KEYS` are all Preview-only in Vercel today (re-confirmed via `vercel env ls` this phase) — zero rows for Production. Genuine per-environment isolation, not shared values. |
| A hidden query parameter or debug flag bypassing the gate | Checked, not found | N/A | Every handler's only branch point before the gate is the route file itself, which does nothing but forward to the handler. No `?debug=`, `?admin=`, or similar parameter exists anywhere in `intelligence-handlers.ts` or the 6 route files. |
| Vercel Deployment Protection bypass (`VERCEL_AUTOMATION_BYPASS_SECRET`) | Yes, exists, but a different concern | No — this is Vercel's own platform-level bypass for Commissioner OS's self-referential calls (added Phase 4.5), unrelated to the Decision OS API's own `X-AllFantasy-API-Key` authentication. It gets a caller *past* Vercel's edge SSO wall, not past `checkIntelligenceGate()`. | Reviewed, correct use of Vercel's documented mechanism, no change needed. |

## 3. Review — By Category

- **API authentication** — one chokepoint (`checkIntelligenceGate`), consistently applied. Hardened this phase (see report).
- **Authorization** — scope/tier gating (`hasScope()` against `TIER_SCOPE_MAP`) is separate from and downstream of authentication, applied identically in every handler; unaffected by and unrelated to this phase's fix.
- **Session validation** — `getServerSession(authOptions)` used identically everywhere it appears (`resolveDecisionOSAuthHeaders`, `resolveActiveLeagueId`, `canAccessLiveDecisionOSData`, `app/commissioner-os/layout.tsx`) — same call convention throughout, no new session mechanism introduced anywhere in this program.
- **API key validation** — format + registration, both enforced server-side, hardened this phase for Production specifically.
- **Environment isolation** — confirmed intact: Production has zero Decision OS credentials; Preview's are separate, real, encrypted values. Re-verified fresh this phase.
- **Secret handling** — `DECISION_OS_API_KEY` and `VERCEL_AUTOMATION_BYPASS_SECRET` are both read directly from `process.env` and never appear in any `logStructured()` call or thrown-error message anywhere in `lib/commissioner-os/adapter/transport/` (confirmed by grep across the transport layer). `fetchJsonWithRetry` (`lib/error-handling/fetch-with-retry.ts`) never logs request headers.
- **Error responses** — `IntelligenceApiError` is a fixed `{code, message, requestId}` shape; messages are static strings, never interpolating the raw key, tenantId, or any internal Decision OS type back to the caller (`contracts.ts`'s own header comment: "Never returned to the caller" for `tenantId`).
- **Logging** — **a real, pre-existing gap, not introduced this phase**: `gate.ts` is documented as "Pure — reads only `process.env`. No IO, no DB, no mutations," meaning **no authentication attempt, successful or failed, is logged anywhere at the gate level**. `callDecisionOS()`'s own `logStructured()` calls only fire for Commissioner OS's *own* self-referential calls succeeding/failing at the transport layer — they say nothing about a third-party caller hitting the API directly with an invalid or unknown key. Flagged as a remaining licensing risk below; not fixed this phase (adding IO to a function explicitly documented as pure is a larger, separate decision than removing a permissive fallback, and was not one of this phase's numbered tasks).

## 4. Verification: Preview and Development Still Function

Both environments' behavior is *unchanged* by this phase's fix — the new
Production check (`VERCEL_ENV === 'production'`) never evaluates true
in either:
- Preview: `vi.stubEnv('VERCEL_ENV', 'preview')` test — dev-mode test-key fallback still resolves `'basic'`, `200`.
- Development: `vi.stubEnv('VERCEL_ENV', 'development')` test, and a third test with `VERCEL_ENV` entirely unset (true local dev) — both still resolve `'basic'`, `200`.

See `API_SECURITY_HARDENING_REPORT.md` for the full test list and results.

## 5. Verification: Admin-Only Live Mode Unaffected

`canAccessLiveDecisionOSData()` (Phase L1) and `gate.ts` (this phase) are
independent, non-overlapping checks — the former decides whether
Commissioner OS attempts a call at all; the latter decides whether the
Decision OS API accepts that call once made. This phase touched zero
files from Phase L1 (`liveModeAccess.ts`, `DataModeIndicator.tsx`,
`CommissionerHeader.tsx`, `app/commissioner-os/layout.tsx`, either
`live.ts`). Re-ran the full Commissioner OS test suite (with local `.env`
pollution removed) — all 399 tests, including
`commissioner-os-live-mode-access.test.ts` (6 tests) and
`commissioner-os-data-mode-indicator.test.tsx` (4 tests), still pass
unmodified.

## 6. Why the Session-Forwarding Fallback Was Not Removed

`resolveDecisionOSAuthHeaders()`'s second path (forwarding
`X-Commissioner-User-Id` when no `DECISION_OS_API_KEY` is configured)
lives in `lib/commissioner-os/adapter/transport/auth.ts` — the transport
layer, which this phase's instructions explicitly say not to restructure
("Do not change transport or adapter boundaries"). It was audited and
confirmed inert (§2) — `gate.ts` never reads this header, so it cannot
grant unauthorized access today. Removing it would be a transport-layer
change with no security benefit (since nothing consumes it), so it was
left in place, documented here instead.

## Remaining Licensing Risks (carried into `API_SECURITY_HARDENING_REPORT.md`)

1. **No audit logging at the gate level** — failed authentication
   attempts against the Decision OS Intelligence API are invisible today.
   Recommend adding a single structured log line inside `checkIntelligenceGate()`
   (or at each route's boundary) before any external licensee is issued a
   real key — out of scope for this phase's specific tasks.
2. **Rate limiting remains modeled but unenforced** (`RATE_LIMITS_BY_TIER`
   in `contracts.ts`) — carried forward unchanged from
   `EXECUTIVE_LICENSING_READINESS_REPORT.md` §10; still not fixed, not in
   scope for this phase (no new endpoints/architecture was to be
   introduced, and a real rate limiter is a materially larger addition).
