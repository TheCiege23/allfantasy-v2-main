# Commissioner Import Provider Matrix

Date: 2026-07-12, updated in the Import Security Closure phase. Statuses
below use the phase's expanded, stricter vocabulary: **CERTIFIED**,
**CERTIFIED WITH DOCUMENTED LIMITATIONS**, **SOURCE-VERIFIED ONLY**,
**BLOCKED**, **CSV CERTIFIED**, **CSV CERTIFIED WITH DOCUMENTED
LIMITATIONS**, **DEFERRED**. Two real statuses changed this phase (MFL
downgraded, Fantrax's ownership gap closed); three providers (MFL, ESPN,
Yahoo) gained a real, previously-undisclosed authorization requirement.

## Authorization matrix (see `IMPORT_AUTHORIZATION_CONTRACT.md`)

| Provider | Membership proof | `isCommissioner` signal | Full-commit outcome | Attestation UI exists? |
|---|---|---|---|---|
| **Sleeper** | Real API | `true`/`false`, real | Pass (`true`) or fail-closed (`false`) — no attestation needed | N/A |
| **ESPN** | Real API | Never set (`undefined`) | Requires attestation | **Yes** — `CommissionerAttestationPanel`, Commissioner Import Attestation UI phase |
| **Yahoo** | Real API | Never set (`undefined`) | Requires attestation | **Yes** — same shared component |
| **MFL** | Real API, `TYPE=myleagues` | Never set (`undefined`) — no such field exists in MFL's API | Requires attestation | **Yes** — same shared component |
| **Fantrax** | Upload-time ownership (`appUserId`) | Not applicable — no per-import commissioner concept, by design | Passes open-read; ownership (not commissioner authority) is the real boundary | N/A — commissioner authority is user-attested product copy, not a gate |
| **Fleaflicker** | Open-read, unchanged | Not applicable | Passes open-read | N/A |

**Import Security Closure phase finding (now closed by the Commissioner
Import Attestation UI phase)**: MFL, ESPN, and Yahoo full-league
commissioner commit was correctly, safely blocked for every real user
because no attestation-collection UI existed anywhere in the product. One
shared component (`components/unified-import-ui/CommissionerAttestationPanel.tsx`)
now closes that gap for all three, gated by the same real classification
(`providerRequiresCommissionerAttestation`, re-exported client-safe from
`lib/league-import/attestationProviders.ts`) the server itself uses — never
a UI-hard-coded provider list. This does not change any provider's
certification status (see each provider's own certification doc) — real,
credentialed provider-backed proof for MFL/ESPN/Yahoo remains blocked or
partial pending real accounts, unchanged by this UI work.

## Certification status

| Provider | Type | Auth model | Live API? | Certification status | Commissioner gate | Canonical lifecycle | `League.status` mapped |
|---|---|---|---|---|---|---|---|
| **Sleeper** | Live API | Keyless (public) | Yes | **CERTIFIED WITH DOCUMENTED LIMITATIONS** | Real, physically proven, 3-outcome contract (only provider with real `true`/`false`) | **Physically proven** | **Fixed, physically proven** |
| **ESPN** | Live API | Cookie (SWID/espn_s2) or public | Yes | **CERTIFIED WITH DOCUMENTED LIMITATIONS** | Real membership proven; **full commit now correctly blocked pending attestation UI (new finding this phase)** | **Physically proven** | **Fixed, physically proven** |
| **Yahoo** | Live API | OAuth 2.0 | Yes — `fantasysports.yahooapis.com` | **CERTIFIED WITH DOCUMENTED LIMITATIONS** | Real membership proven; OAuth-to-pipeline disconnect fixed (prior phase); **full commit now correctly blocked pending attestation UI (new finding this phase)** | Provider-agnostic mechanism, architecturally guaranteed; not independently re-proven for Yahoo without a real account | **Fixed, unit-tested; physical Dashboard proof pending account link** |
| **MFL** | Live API | API key | Yes — `api.myfantasyleague.com` | **SOURCE-VERIFIED ONLY** (downgraded this phase from "CERTIFIED WITH DOCUMENTED LIMITATIONS" — see below) | **Real membership check implemented and unit-tested this phase (no longer open-read); full commit correctly blocked pending attestation UI** | Architecturally guaranteed; not independently re-proven, no credentials available | **Fixed this phase, unit-tested; physical proof blocked (no credentials anywhere)** |
| **Fantrax** | **CSV snapshot — not a live API, never describe as one** | Session auth (added prior phase) + real `AppUser` ownership (**new this phase**) | **No** | **CSV CERTIFIED WITH DOCUMENTED LIMITATIONS** | Open-read by design; real ownership boundary now enforced at upload/read time (this phase) instead of commissioner authority (unprovable from a CSV, documented as user-attested) | **Physically proven** (Sleeper/ESPN/Fantrax, third provider) | **Fixed and physically proven** |

## Why MFL was downgraded, not upgraded, despite a real security fix

MFL's real gap (no membership check at all) is now fixed and unit-tested —
a genuine improvement. But this phase's certification rule is explicit: *"A
provider cannot be CERTIFIED if... no real provider-backed import was
physically completed."* No MFL API key has ever been available to this
program (re-checked this phase: zero rows in both the disposable branch and
read-only production for `platform:'mfl'`). Under the prior, looser
vocabulary this gap was folded into "CERTIFIED WITH DOCUMENTED
LIMITATIONS"; under this phase's stricter, more honest vocabulary it is
correctly reclassified as **SOURCE-VERIFIED ONLY** — the code is right, the
proof is missing, and the label now says exactly that. Full detail:
`MFL_COMMISSIONER_IMPORT_CERTIFICATION.md`.

## Canonical imported-league lifecycle (unchanged this phase)

The `RedraftSeason`/`RedraftRoster` materialization step
(`lib/league-import/canonicalSeasonMaterialization.ts`) needed zero changes
this phase — authorization is a prerequisite layered in front of it, not
part of it. Still physically proven for **Sleeper, ESPN, and Fantrax**; MFL
and Yahoo get the identical guarantee architecturally. Full detail:
`CANONICAL_IMPORT_LIFECYCLE.md`.

## Known cross-provider gap: `League.status` mapping — unchanged, still closed for all 5 providers

No change this phase. Sleeper, ESPN, Fantrax physically proven; Yahoo, MFL
unit-tested, physical proof pending credentials.

## Fantrax: real `AppUser` ownership (this phase's fix)

`FantraxLeague.appUserId` (new nullable `AppUser` FK, `ON DELETE SET NULL`)
closes the identity-model gap disclosed but not fixed in the prior phase.
Upload stamps the real authenticated caller's `appUserId`; a second real
user cannot overwrite or read someone else's snapshot (403 on write,
same-as-not-found on read — no existence leak); legacy `appUserId: null`
rows are rejected for everyone. Physically proven against
`br-green-lab-admi6kkj` with two real, distinct `AppUser` rows. A real
migration bug (referencing the model name `"AppUser"` instead of the
`@@map`-mapped table `"app_users"`) was caught by this same physical test
before reaching a shared database. Full detail:
`FANTRAX_IMPORT_PRODUCT_DECISION.md` §0.

## MFL: real membership check (this phase's fix)

`fetchMflUserLeagues()` calls MFL's real, live-verified `TYPE=myleagues`
export and checks whether the target league appears in the caller's own
leagues — MFL is **no longer `OPEN_READ_PROVIDERS`**. MFL's real API has no
commissioner/admin flag anywhere (confirmed absent from every field this
codebase's own franchise parser handles), so full-commit correctly routes
through the new attestation requirement rather than either fabricating
`isCommissioner` or silently passing. Full detail:
`MFL_COMMISSIONER_IMPORT_CERTIFICATION.md`.

## ESPN / Yahoo: undisclosed attestation gap (this phase's finding, now closed)

Discovered while fixing MFL and re-running the full regression suite: ESPN
and Yahoo's gate functions (`checkEspn`/`checkYahoo`) prove real membership
but never set `isCommissioner` — identical shape to MFL's gap, previously
untested against `requireCommissioner: true` for either provider. Before
this phase's fix, any real member of an ESPN or Yahoo league could complete
a full-league commissioner commit with zero commissioner claim. Now closed
via the same three-outcome contract MFL uses. Full detail:
`IMPORT_AUTHORIZATION_CONTRACT.md`.

## Update — Commissioner Import Attestation UI phase (2026-07-12/13)

The "no attestation-collection UI exists" gap disclosed at the end of the
Import Security Closure phase is closed — see the authorization matrix
above and `docs/redraft/COMMISSIONER_ATTESTATION_PRODUCT_SPEC.md` for the
full component/wiring detail. Provider capability badges
(`docs/os/PROVIDER_CAPABILITY_MATRIX.md`) now display "Commissioner
Authority User-Attested" precisely, never "Commissioner Verified," for any
MFL/ESPN/Yahoo league whose real recorded `commissionerVerification.method`
is `'attestation'`.

## Data-domain coverage (unchanged from the prior phase's audit)

For the full per-domain breakdown (league metadata, rosters, draft history,
scoring, transactions, historical seasons, etc.) per provider, see
`docs/redraft/NFL_NCAAF_REDRAFT_IMPLEMENTATION_MATRIX.md`'s Commissioner
Import Program section. Nothing in that breakdown changed this phase —
this phase's work was entirely in the authorization/ownership layer sitting
in front of it, not the data mapping itself.
