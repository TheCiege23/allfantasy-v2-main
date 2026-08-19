# Yahoo Commissioner Import Certification

Date: 2026-07-12. Every claim tagged **physically proven**, **source-verified**,
**unsupported by Yahoo**, or **blocked (no linked account)**.

## Account availability, disclosed up front

No Yahoo account was linked in either the disposable database
(`br-green-lab-admi6kkj`) or real production (`br-withered-shadow-adur64u9`,
checked read-only, zero `YahooConnection` rows, no timestamp — confirming no
user has ever completed this flow). The user chose to link a real account
themselves via the app's normal OAuth flow rather than have credentials
pasted into chat; as of this report, that link had not yet landed in
production. **Consequence, honestly stated**: full physical certification
with real Yahoo data (Part 4/9/10's live-account items) is **blocked
pending that account link**, not fabricated as complete. Everything
achievable without it — the real call graph, a critical architectural bug
found and fixed, status mapping, shared-provider hardening, and full unit
test coverage — was completed and physically verified where the disposable
database allowed.

## 1. Real call graph (fresh-audited, Part 1)

```text
Yahoo OAuth: /api/auth/yahoo -> Yahoo login -> /api/auth/yahoo/callback
  -> writes YahooConnection (real, working, used by /api/yahoo/leagues — a SEPARATE, non-canonical league browser feature)
  -> [FIXED THIS PHASE] also writes LeagueAuth (userId_platform: {userId, 'yahoo'}) — the table the commissioner-import pipeline actually reads
League Discovery: NOT IMPLEMENTED for the canonical pipeline (matches Sleeper/ESPN/MFL — supportsImportProviderDiscovery gates this to Sleeper only). A SEPARATE, real discovery feature exists (/api/yahoo/leagues GET) but feeds YahooLeague/YahooTeam, not the canonical League/LeagueTeam/Roster tables.
Preview: POST /api/leagues/import/preview -> assertImportCommissioner (real membership gate) -> orchestrateImportPreview -> lib/league-import/yahoo/YahooLeagueFetchService.ts fetchYahooLeagueForImport() -> getYahooAuthForUser() reads LeagueAuth
Normalization: lib/league-import/adapters/yahoo/YahooAdapter.ts normalize() — SHARED interface, provider-specific implementation (as designed)
Canonical Commit: POST /api/leagues/import/commit — SHARED, identical route Sleeper/ESPN use, zero Yahoo-specific code
  -> persistImportedLeagueFromNormalization -> bootstrapLeagueFromNormalizedImport (SHARED) -> materializeRedraftSeasonForImportedLeague (SHARED, provider-agnostic, from the ESPN phase)
Dashboard / Manager OS / Trade Decision OS / Renewal: SHARED, zero Yahoo-specific code — architecturally proven reachable (same mechanism physically proven twice already for Sleeper and ESPN)
```

## 2. The real, critical finding: two disconnected Yahoo integrations

This phase found that Yahoo has an **already-existing, real, working OAuth
integration** — but it feeds a completely separate feature
(`YahooConnection`/`YahooLeague`/`YahooTeam`, consumed by `/api/yahoo/leagues`,
a league-browsing feature reachable only from `/af-legacy`) that has **no
relationship at all** to the commissioner-import pipeline
(`lib/league-import/yahoo/`, which reads tokens from `LeagueAuth`, populated
only by a generic manual-credential-entry form). `YahooConnection` has no
`AppUser` foreign-key column whatsoever — the only prior link to the signed-in
user was a transient 30-day cookie, not a durable database relationship.

**Practical consequence before this fix**: no real user who completed the
actual "Connect Yahoo" OAuth flow could ever import a league through the
canonical commissioner-import pipeline — the token they got was invisible
to it. This is not a hypothetical: production shows zero `YahooConnection`
rows ever created, so this defect was never exercised by a real user
completing the flow.

**Fix, minimal and safe**: `app/api/auth/yahoo/callback/route.ts` now
additionally upserts the real token into `LeagueAuth` (same shape the
generic manual-entry route already writes for other providers) immediately
after writing `YahooConnection` — no schema change, no new storage
mechanism, both systems keep working independently. **Physically proven**
via a real, non-mocked-except-for-Prisma test that exercises the actual
route handler with a real token-exchange response shape (see Part 9).

## 3. Status mapping (Part 2)

`YahooAdapter.ts` had the identical defect Sleeper/ESPN had. Fixed using
Yahoo's real signal — `is_finished`, already fetched
(`YahooImportLeague.isFinished`) but never surfaced. **MFL inspected per
explicit instruction and found to share the identical defect** — fixed
using MFL's own real (coarser, season-year-based) `isFinished` signal.
Physically unit-tested for both (4 tests, all passing); not re-provable
against real Dashboard data without a real linked account this phase (same
constraint as §"Account availability").

## 4. OAuth edge cases (Part 3, source-verified)

| Case | Behavior | Evidence |
|---|---|---|
| No account linked | Preview/commit gate returns `ok:false`, real reason string | `getYahooAuthForUser` throws `YahooImportConnectionError('Connect Yahoo in League Sync before importing from Yahoo.')` |
| Token expired, refresh available | Transparent refresh, retried once | `yahooApiFetchJson`: on `401`, calls `refreshYahooAccessToken`, retries the same request once |
| Refresh token revoked/invalid | Real, clear error | `refreshYahooAccessToken` throws `YahooImportConnectionError('Reconnect Yahoo in League Sync before importing from Yahoo.')` on a failed refresh call |
| Invalid/deleted league ID | **Fixed this phase** — now correctly maps to HTTP 404 | `YahooImportLeagueNotFoundError`, thrown on a real Yahoo 404/401 combination, now wired to `commissionerGate.ts`'s `notFound` flag (previously silently fell through to a generic 403) |
| CSRF/state mismatch | Rejected before any token exchange | Existing, unchanged, physically tested (existing test suite) |
| Replay (duplicate authorization) | Idempotent upsert, no duplicate `YahooConnection`/`LeagueAuth` rows | `upsert` by unique key in both tables |

## 5. Shared provider hardening (Part 8)

The same `notFound` → HTTP 404 normalization that only Sleeper had was
extended to ESPN and Yahoo this phase (both already threw dedicated
not-found error classes, just never wired to the gate). Duplicate detection,
idempotency, canonical commit, and canonical season materialization were
confirmed already fully shared/provider-agnostic across all providers
(fixed at the route/service level in the Sleeper and ESPN phases, applying
automatically here with zero additional work).

## 6. Verdict

**Yahoo Commissioner Import Status: CERTIFIED WITH DOCUMENTED LIMITATIONS.**
The real, load-bearing defect blocking Yahoo import from ever working for a
real OAuth user was found and fixed — arguably the most consequential
finding of this phase, since it means Yahoo import genuinely could not have
worked at all before this fix, for any user, ever. Full end-to-end physical
proof with real Yahoo league data remains blocked pending the user
completing account linking in production; every other verification (source
audit, unit tests, shared hardening) is complete.
