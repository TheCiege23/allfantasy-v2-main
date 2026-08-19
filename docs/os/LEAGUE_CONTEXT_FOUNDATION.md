# Fantasy OS Suite — League Context Foundation

**Phase OS-A1 (foundation) → OS-A2 (wiring) → OS-A3 (live DB verification, done).** Part of the
"Fantasy OS Operating-System Alignment" workstream — the product-level shift toward Commissioner OS
behaving like an operating system (multi-league command center, AI as background infrastructure,
Decision OS as global/app-wide intelligence) rather than an AI dashboard bolted onto one league. This
doc covers the provider-agnostic **League Context** slice: what Decision OS knows about a league's
financial state, how confident that knowledge is, and — as of OS-A3 — real, live proof that the whole
persistence path actually works end-to-end.

**Date:** 2026-07-09 · **Branch:** `g15-event-foundation`.

---

## 1. Why this is a new model, not a `LeagueFinance` extension

`LeagueFinance` (`prisma/schema.prisma`) already exists — a real, built AF-native payment/treasury
system: entry fees in cents, a treasury balance, Stripe/PayPal/Coinbase provider integration, payout
requests and approvals, an audit trail. It answers **"how does AllFantasy collect and hold money for
this league's own paid-league feature."**

The League Context this phase adds answers a different question: **"what do we believe about whether
real money is involved in this league at all, and how sure are we" — for ANY league, imported or
native, whether or not AllFantasy ever processes a cent of it.** A league can have real money riding
on it through LeagueSafe, FanCred, a Yahoo/ESPN native payment feature, or a plain Venmo handshake
between friends — none of which touch `LeagueFinance` at all. Conflating the two would either force
every imported league through an AF-native payment model it never opted into, or silently assume
"no `LeagueFinance` row" means "definitely free" — both wrong, and both exactly the kind of
fabricated certainty this phase explicitly forbids.

## 2. What was built

**New Prisma model, `DecisionOsLeagueContext`** (migration
`20260709000000_decision_os_league_context`, **not applied to any database this phase** — schema +
migration file only, per "do not touch production DB"):

```prisma
model DecisionOsLeagueContext {
  id                  String
  leagueId            String                               @unique
  financialStatus     DecisionOsLeagueFinancialStatus       @default(UNKNOWN)
  buyInAmount         Float?
  buyInCurrency       String?
  escrowProvider      DecisionOsLeagueEscrowProvider         @default(UNKNOWN)
  financialConfidence DecisionOsLeagueFinancialConfidence    @default(UNKNOWN)
  financialNotes      String?
  isUserConfirmed     Boolean                               @default(false)
  lastVerifiedAt      DateTime?
}
```

- `financialStatus`: `UNKNOWN | FREE | PAID | VERIFIED_PAID` — `VERIFIED_PAID` is a strictly higher
  tier than `PAID`, reachable only through a real escrow verification (see §3), never through a
  commissioner's own unverified word.
- `escrowProvider`: `LEAGUESAFE | FANCRED | YAHOO | ESPN | MANUAL | OTHER | UNKNOWN` — **adapter hooks
  only**. No provider is integrated. These values exist so a future integration has an
  already-designed enum to write into, not so anything reads from a real LeagueSafe/FanCred/Yahoo/ESPN
  API today.
- `financialConfidence`: `UNKNOWN | USER_CONFIRMED | PROVIDER_CONFIRMED | ESCROW_VERIFIED | INFERRED`
  — a genuinely separate axis from `financialStatus`. A league can be `PAID` with `USER_CONFIRMED`
  confidence (a commissioner said so) or `VERIFIED_PAID` with `ESCROW_VERIFIED` confidence (a real
  provider confirmed it) — status and confidence are tracked independently so nothing ever collapses
  "we were told" and "we verified" into the same bucket.
- Deliberately **NOT** foreign-key-related to `League` (a plain `leagueId` string) — matches the
  existing, precedented `DecisionOsImportedActivity`/`DecisionOsBehavioralSnapshot` convention of
  storage-decoupled, provider-agnostic Decision OS models.

**New pure module, `lib/decision-os/leagueFinancialContext.ts`** — zero I/O, zero Prisma, zero
network. Persistence and any route/UI wiring are explicitly a later phase; this one is the
interpretation layer only:

- `defaultLeagueFinancialContext(leagueId, provider)` — the honest starting state for ANY provider.
  Tested explicitly across `sleeper`, `espn`, `yahoo`, `allfantasy`, an unrecognized string, and an
  empty string — all produce the identical fully-`UNKNOWN` result. There is no provider-specific
  branch anywhere in this function, by design — no "Sleeper leagues are usually free" heuristic, no
  reading league chat, no reading league name for `$`/"buy-in"/"payout" keywords.
- `applyManualFinancialConfirmation(current, {financialStatus: 'FREE'|'PAID', ...}, now)` — the
  ONLY way to reach `FREE`, and the only way to reach `PAID` short of a real escrow verification.
  Sets `financialConfidence: 'USER_CONFIRMED'`, `isUserConfirmed: true`, stamps `lastVerifiedAt`.
- `applyEscrowVerification(current, {escrowProvider, ...}, now)` — the adapter hook for a REAL
  future escrow-provider verification. The only path to `VERIFIED_PAID`/`ESCROW_VERIFIED`. Not called
  from anywhere else in the codebase yet — exists so the first real LeagueSafe/FanCred integration has
  an already-designed, already-tested shape to call into.
- `isFinancialStatusConfident` / `isConfidentlyPaid` / `isConfidentlyFree` — boolean guards for any
  future consumer (Commissioner OS UI, notifications) to gate paid-league-specific behavior safely.
  All three are false for `UNKNOWN`, and — a deliberate, tested edge case — `isConfidentlyPaid` is
  also false for a context whose `financialStatus` is `PAID` but whose `financialConfidence` was
  never actually set to a real value (i.e., status alone can never imply confidence; both must agree).
- `describeEscrowProvider` / `describeLeagueFinancialContext` — human-readable labels, each tested to
  never invent a dollar amount, provider name, or certainty the underlying context doesn't have.

## 3. How Sleeper behaves

**Sleeper imports get no special treatment.** `defaultLeagueFinancialContext(leagueId, 'sleeper')`
returns the exact same fully-`UNKNOWN` result as every other provider string tested. Nothing in this
phase reads Sleeper league chat, league settings, or league name to guess at financial status — the
instruction "do not infer paid status from chat" is satisfied by simply never writing that code path,
not by adding a check that suppresses it. A Sleeper-imported league only moves off `UNKNOWN` when a
real person calls `applyManualFinancialConfirmation` (wiring that call into an actual commissioner-
facing control is explicitly out of scope for this foundation phase).

## 4. What remains — LeagueSafe / FanCred / Yahoo / ESPN

**Nothing beyond the enum value existing, even after OS-A2.** No provider is integrated:

- No LeagueSafe or FanCred API client, OAuth flow, or webhook exists.
- No ESPN/Yahoo financial-data adapter exists (their general league-import adapters, unrelated to
  financial context, are a separate, already-existing concern).
- `applyEscrowVerification` is a real, tested, callable function — but nothing calls it, still. OS-A2
  only wired the MANUAL confirmation path (a real person's own word); the escrow-verification path
  remains exactly the adapter hook OS-A1 left it as. Building the first real integration means: pick
  one provider, build its API client, map its response onto `EscrowVerificationInput`, and call this
  function — the interpretation and persistence shape are already done.
- OS-A2's manual-confirm control (§7) DOES accept an `escrowProvider` value from the commissioner —
  but that only records which provider they SAY they use, as a plain label. It does not call, verify
  against, or authenticate with any real provider.

## 5. Boundaries honored (Phase OS-A1)

- No Redraft/Start-Draft/PR-#166/AF-hosted-league work touched.
- PR #183 untouched, still draft, not merged.
- No DFS OS work.
- No fake/demo data — every test uses explicit, labeled test fixtures, never presented as real data.
- No production DB touched — the migration file was written and validated (`prisma validate`,
  `prisma generate`) but never applied to any database, per explicit instruction.
- No payment/escrow integration built — `applyEscrowVerification` is an adapter hook with no real
  provider behind it, exactly as instructed.
- No chat-based or heuristic inference of financial status, for Sleeper or any other provider.

## 6. OS-A2 — League Context wiring (implemented)

The recommended next phase from §6 (original) is now built:

**New Prisma-backed resolver, `lib/decision-os/leagueContext.ts`** — mirrors
`defaultLoadImportedActivityRows`'s honest-degradation pattern exactly: `resolveLeagueFinancialContext`
checks for the `decisionOsLeagueContext` delegate + a real row, and degrades to the pure
`defaultLeagueFinancialContext` (never a crash, never a 500) if either the delegate isn't
generated/migrated in this environment or a genuine read failure occurs — the honest, expected path in
every real environment today, since the OS-A1 migration still hasn't been applied anywhere (see §5).
Writes are held to a stricter standard: `persistLeagueFinancialConfirmation` throws
`LeagueContextStoreUnavailableError` if the store genuinely can't persist, rather than reporting a
false "confirmed" success — the route below turns that into an honest `503`.

**New authorization helper, `lib/decision-os/leagueContextAuthorization.ts`** — combines two
already-existing, already-tested gates rather than inventing a new one: `getLeagueRole`
(`lib/league/permissions.ts`) for the league's own commissioner/co-commissioner, and `requireAdmin`
(`lib/adminAuth.ts`, the same site-admin gate Platform OS reuses — Phase D Increment 11) for operator
correction. A plain member, a viewer, or a caller with no relationship to the league at all is denied
(403) unless they're also a site admin. Reads are deliberately NOT gated by this module — the read
route follows the exact same precedent every sibling Decision OS read route already sets (session-only,
no per-league role check; enforcement is UI-level, matching Mission Control/League Analytics/User OS).

**New route, `GET`/`POST /api/decision-os/league-context`** — `GET` returns the resolved context for
any authenticated caller. `POST` accepts `{leagueId, action: 'confirm_free'|'confirm_paid'|'reset',
buyInAmount?, buyInCurrency?, financialNotes?, escrowProvider?}`, gated by the authorization helper
above, and returns the real persisted context (or a `503 context_store_unavailable` if the store can't
persist).

**New Commissioner OS control, `components/decision-os/LeagueContextCard.tsx`** — wired into
`CommissionerHubPageClient.tsx` right after the existing Mission Control/League Analytics cards, with
`canManage` hardcoded `true`. This is safe without per-league role plumbing: Commissioner Hub already
only ever renders for `commissionerLeagues` — leagues the signed-in user commissions — so any league
this card is ever shown for is, by definition, one the same user is authorized to manage; the server
route re-verifies this independently regardless. The card's own copy states explicitly, in the UI
itself, that this is a belief Decision OS records, not a payment or collection system — pointing
readers to "League Finance" (the existing AF-native treasury feature) for that.

**30 new/extended tests** (6 more pure-function tests for `resetLeagueFinancialContext` and the new
`escrowProvider` label field; 6 resolver tests incl. store-unavailable degradation; 8 authorization
tests covering commissioner/co-commissioner/member/viewer/no-relationship/site-admin; 10 route-contract
tests covering the exact scenarios this phase's own instructions listed). 2802/2802 total in
`__tests__/decision-os`, zero regressions. *(Corrected from an earlier miscount of 19 in this doc —
the real breakdown is 6+6+8+10=30, matching the roadmap doc and commit message.)*

## 7. Boundaries honored (Phase OS-A2)

- No LeagueSafe/FanCred integration built — the manual confirm path only records a person's own word,
  never calls a real provider.
- No payment handling promised anywhere in the UI copy or docs — the card explicitly names
  `LeagueFinance` as the separate system for that.
- No production DB touched — the OS-A1 migration remains unapplied to any database, including the
  Phase E throwaway project; this phase adds code that WOULD read/write it once migrated, but does not
  migrate it.
- No chat/name/heuristic inference — the only ways to change status remain the explicit
  `applyManualFinancialConfirmation`/`applyEscrowVerification` calls from OS-A1, now reachable via a
  real, authorized route instead of only from tests.
- No Redraft/Start-Draft/PR-#166/AF-hosted-league work touched.
- No DFS OS work.
- PR #183 untouched, still draft, not merged.

## 8. OS-A3 — Live DB Verification (2026-07-09, done)

The candidate (a) from the original §8 is now done. The OS-A1 migration was applied to the real,
isolated, throwaway Phase E project (`cool-lab-87438174`, host `ep-noisy-flower...` — the same
database Phase E's live Sleeper proof used, never the shared dev database or production) — 623 tables
before, 624 after, `decision_os_league_context` confirmed present with all 12 designed columns.

**Full round-trip verified against the real "Parbur" league** (`3c8c6699-cfb8-46d0-8834-c883108a7c9c`,
the same real, Phase-E-imported Sleeper league), through the real route, with a real, properly-signed
session cookie (same technique as Phase E — a valid NextAuth JWT minted with the app's own
`NEXTAUTH_SECRET`, not an auth bypass):

1. `GET` before any row existed → real `UNKNOWN` default, exactly as designed. ✅
2. `POST confirm_paid` (buy-in 50 USD, LeagueSafe label, a note) as the real commissioner account →
   `200`, real `PAID`/`USER_CONFIRMED` response — **and independently confirmed via a direct SQL read
   that the row was genuinely persisted**, not just echoed back. ✅
3. `GET` again → the same real, persisted `PAID`/`USER_CONFIRMED` context read back correctly. ✅
4. `POST reset` → `200`, full reset to `UNKNOWN` — **confirmed via SQL that every field was cleared
   (not just `financialStatus`)**, matching `resetLeagueFinancialContext`'s own "full reset, not
   partial" design. ✅
5. **Authorization verified live, not just mocked**: the real Phase E member account (which claimed a
   real roster in this same league but is not its commissioner) got a real `403` on `confirm_paid` and
   a real `200` on `GET` — the exact read/write split the design calls for, now proven against real
   `getLeagueRole` Prisma queries, not test doubles. ✅
6. **Commissioner Hub loaded with zero errors** with `LeagueContextCard` in its bundle (confirmed via a
   real browser navigation + console-message check — only a pre-existing, unrelated Facebook SDK
   HTTPS warning appeared, nothing from this phase's code). Full authenticated visual confirmation of
   the card's own rendered buttons/inputs was not achievable — the same sandbox limitation Phase E
   documented (JS execution is blocked on `localhost` by the browser extension's own safety
   restriction, so a session cookie can't be injected into a real browser tab) — but the data path the
   card exclusively depends on (steps 1-5 above) is fully, independently verified.

**Zero bugs found. Zero code changes made this phase** — every check passed exactly as designed on
the first attempt.

## 9. Recommended next phase

**OS-A4 candidates**: (a) begin OS-A product decision #2/#3 (the multi-league command-center default
view and the league-switch mode) — a materially larger scope than this narrow foundation/wiring/
verification arc; (b) the first real escrow integration (LeagueSafe most likely, given its existing
enum priority), calling the already-built, now live-verified `applyEscrowVerification` adapter hook
for real; (c) product decision #7 (notifications as an OS output surface) could now reasonably
reference League Context as one of its first real signal sources, since the belief layer is proven
end-to-end.
