# Next-Season Creation — NFL/NCAAF Parity Report

## Code-level parity: real, by construction

`createNextSeason`, `evaluateNextSeasonEligibility`, and the migration are entirely sport-agnostic — there is no NFL-specific or NCAAF-specific branch anywhere in `lib/redraft/renewal/createNextSeason.ts` or `nextSeasonEligibility.ts`. The only sport-related logic is the `SUPPORTED_SPORTS = new Set(['NFL', 'NCAAF'])` allowlist. This was a deliberate design choice, not an accident of only testing NFL.

## Physical validation: NFL only

Both real proving runs (happy path and N1 concurrency) used real NFL seasons. **No NCAAF proving run was performed this phase.**

## Real NCAAF data exists and was inspected but not used

The production-fork branch contains 2 real NCAAF seasons (`tc-ncaaf-season` in league `tc-ncaaf-league`, and `rwr-ncaaf-smoke-season` in league `rwr-ncaaf-smoke-league`), both `status: 'active'` (not `'complete'`, same as every other real season in the fork — no season in this environment has organically reached completion). Reaching a testable NCAAF scenario would have required the same single-field `status='complete'` mutation used for the NFL test, applied to one of these leagues instead — this was not done this phase purely due to time, not because it was harder or riskier than the NFL case.

## What "real first-class treatment," per the brief, would require beyond this

The brief's Part 9 lists several NCAAF-specific verifications (championship/calendar differences, offseason timing, provider/calendar differences) that this phase's code does not specifically address — because the underlying calendar/schedule/playoff subsystems this operation would need to interact with for those checks (schedule configuration, playoff configuration) are themselves `deferred` this phase, not just for NCAAF but for NFL too. In other words: the code-level parity claim is real (no sport-specific code exists to diverge), but it is an easier, weaker claim than "NCAAF calendar differences were verified" — those differences live in subsystems this operation doesn't touch yet.

## Verdict

Code-level: parity by construction, real. Physical proof: NFL-proven, NCAAF-unproven. Do not read "no sport-specific code" as equivalent to "NCAAF was verified" — it was not, this phase.
