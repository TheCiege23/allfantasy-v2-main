# MFL Commissioner Import Certification

Date: 2026-07-12 (Import Security Closure phase). No real MFL API key was
available anywhere this phase either — re-checked the disposable database
(`br-green-lab-admi6kkj`) and real production (`br-withered-shadow-adur64u9`,
read-only), both zero rows for `platform:'mfl'` in `league_auths`. Per this
program's own established discipline, no credential request was made.
Every claim below is tagged **physically proven**, **source-verified**,
or **blocked (no credentials)**.

## 1. Real, previously-disclosed gap — now fixed (Part 2/3)

The prior phase found MFL had **no membership or commissioner verification
at all** — any authenticated user with any valid MFL API key could import
any MFL league. Research this phase (Part 2) confirmed MFL's real API
(`TYPE=myleagues`, verified live via a safe, unauthenticated, keyless call —
`{"leagues":{}}`, a real structured envelope, not an error) *can* prove
real league **membership** (which franchise the caller's own key controls),
but confirmed **no franchise-level commissioner/admin flag exists anywhere
in MFL's real response shape** (absent from every field this codebase's own
franchise parser already handles). This is **Outcome B**: membership
provable, commissioner status not.

**Implemented**: `fetchMflUserLeagues()` (new,
`lib/league-import/mfl/MflLeagueFetchService.ts`) calls the real
`myleagues` export and checks whether the target league appears in the
caller's own leagues. `checkMfl()` (new, `commissionerGate.ts`) wires this
into the gate — MFL is **no longer open-read**. Real membership is now
required for both preview and commit. For full-league commit specifically,
since commissioner status is genuinely undetermined, the existing
attestation mechanism (previously unused infrastructure, already fully
plumbed end-to-end from an earlier phase) is now required —
`isCommissioner: undefined` + `requireCommissioner: true` returns
`requiresAttestation: true` rather than silently passing. **Physically
unit-tested** (6 new tests, real mocked MFL response shapes, all passing).

**Not fixed / disclosed**: (1) no attestation-collection UI exists yet for
*any* provider — MFL full-league commit is now correctly **blocked** for
every real user until that UI ships, which is the intended, safe outcome of
Outcome B rather than a bug; (2) the real `myleagues` HTTP call has never
been exercised against a populated, real response — the empty-key response
shape is real, but a real, populated example was not available to test
against.

## 2. Authentication and secret handling (Part 2, re-confirmed unchanged)

Manual API key entry, encrypted via `LeagueAuth.apiKey` (shared, correctly
`AppUser`-linked table), decrypted via `getDecryptedAuth`. No credential
leak found in any error path (re-confirmed for the new `fetchMflUserLeagues`
function too — the request URL, which embeds the key, is never referenced
in any thrown error string).

## 3. Status-code contract (Part 3)

| Code | Real behavior |
|---|---|
| 401 | `requireVerifiedUser()`, unchanged, shared |
| 403 | Real membership check fails, or commissioner attestation required (new) |
| 404 | `MflImportLeagueNotFoundError` → `notFound: true` (new, this phase — previously MFL had no `notFound` signal at all since it never called the provider during the gate) |
| 409 | Shared `ImportedLeagueConflictError`, unchanged |
| 422 | Shared `NORMALIZATION_FAILED` mapping, unchanged |
| 201/200 | Shared new-vs-replay mapping, unchanged |

## 4. One-to-one parity (Part 4) — source-verified only, physical proof still blocked

Unchanged from the prior phase's audit (no credentials to re-verify with
real data): league identity, managers/franchises, rosters, settings/scoring
(partial), draft, schedule, transactions, and historical seasons are all
source-verified as real, working mappings. Playoff results remain
unsupported platform-wide, not an MFL-specific gap.

## 5–7. Canonical lifecycle, downstream, and conflict/replay (Parts 5–7)

**Architecturally guaranteed, not independently physically re-proven for
MFL.** The canonical season materialization module and the shared
commit/conflict/replay logic have now been physically proven for **four**
different real providers this program (Sleeper, ESPN, Fantrax, and —
transitively, since the code path is identical — every provider that
reaches `persistImportedLeagueFromNormalization` at all). MFL reaches that
exact same shared code; there is no structural reason to expect different
behavior, but this remains an architectural inference for MFL specifically,
not a fourth physical proof, since no MFL import has ever been physically
executed.

## Verdict

**MFL Commissioner Import Status: SOURCE-VERIFIED ONLY.** The real security
gap that would have blocked a clean certification is now fixed — commissioner
authority is enforced server-side, real membership is genuinely proven, and
the design is honest about what MFL's API can and cannot prove. What
remains is purely a proof gap, not a safety gap: zero real MFL credentials
have ever been available to this program, so no real, provider-backed
import has ever been physically completed. Per this phase's own explicit
rule ("A provider cannot be CERTIFIED if... no real provider-backed import
was physically completed"), MFL is downgraded from the prior phase's
"CERTIFIED WITH DOCUMENTED LIMITATIONS" to the more precise
**SOURCE-VERIFIED ONLY** — not because the code got worse, but because this
phase's stricter evidence bar correctly refuses to call unverified code
"certified."

## Update — Commissioner Import Attestation UI phase (2026-07-12/13)

**Status unchanged: SOURCE-VERIFIED ONLY.** The real product gap this
status previously implied — commissioner authority enforced server-side but
with no UI anywhere to satisfy the resulting attestation requirement — is
now closed. `CommissionerAttestationPanel` renders for MFL full-league
imports, wired through the real, shared
`providerRequiresCommissionerAttestation()` classification. **This does not
change MFL's status**: the phase's own certification rule ("a provider
cannot be CERTIFIED if no real provider-backed import was physically
completed") still applies unchanged — still zero real MFL API keys
available anywhere (re-checked disposable DB and read-only production,
zero rows for `platform:'mfl'` in `league_auths`), so the full,
UI-through-server-through-commit path remains fixture/mock-proven only,
never physically executed against a real MFL account.

**What's newly, physically proven this phase**: the audit-evidence
persistence layer itself (`recordImportAttestation`/
`recordCommissionerVerificationMethod`, including this phase's new
`importRunId`/`textVersion` fields) against the real disposable Neon branch
— a real DB write/merge, not a provider-dependent step, so it's proof-complete
independent of MFL credential availability. **What remains
fixture/mock-only**: the actual `checkMfl()` membership call and the
resulting attestation-required gate, both covered by extensive controlled
unit tests (real mocked MFL response shapes, including the new
provider/league mismatch rejection tests) but never exercised against a
real MFL account. Disclosed honestly, per this phase's own Part 11
instruction, rather than fabricated as physically proven.
