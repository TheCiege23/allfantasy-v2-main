# Competitive Edge privacy continuation

> 🛑 **PROVENANCE: THIS PASS WAS ADOPTED, NOT AUTHORED HERE, AND ITS AUTHOR IS UNKNOWN.**
> The work sat uncommitted in the shared checkout with no owner. Three attribution methods
> were exhausted and all came back empty — `git log` found 0 commits and 0 of 803 branch tips
> carrying it (with a positive control confirming the search was not blind), a transcript
> search returned no hits and then timed out, and the session list has a gap over the window
> it was written in. It is adopted so it can be reviewed and land rather than being swept out
> of a tree that has already lost uncommitted work.
>
> ⚠ **THE "Verification" SECTION BELOW IS THE ORIGINAL AUTHOR'S CLAIM AND IS NOT REPRODUCED.**
> "284 tests passed across 30 suites" and "focused type checking passed for 112 files" were
> not re-run by the adopter, and they do not describe this commit in any case: two files were
> merged onto a newer `main` rather than copied, and one user-facing line was rewritten. Read
> those numbers as inherited history, not as an attestation for this artifact. What WAS
> measured on this commit is recorded in the commit message, and nowhere else.

Overall Decision OS progress remains **34%**. This pass completes the changes below; it does **not** certify milestone 32 across every behavioral subsystem, cached response and replay. Milestone 33's decision-specific evidence UI and milestone 34's calibrated negotiation model remain pending.

## Completed changes

- Retired public profile listing (including comparison and rollup query variants), detail, evidence, explanation, individual generation and bulk generation. These routes return a constant `410 PROFILE_SURFACE_RETIRED` with `no-store`; no entitlement or self-profile exception permits a raw profile. They do not run the profile engine or query private records.
- Retired the legacy opponent-tendencies GET/POST and their canonical AI aliases, plus the rankings manager-psychology generator. In total, the route tests cover eleven HTTP entry points across nine paths.
- Replaced the profile settings panel, dedicated pages, manager psychology component and personality badge with a Competitive Edge entry or a removed badge. The entry explicitly says that decision-specific negotiation evidence is still being connected. Existing settings links named `Behavior Profiles` resolve to the new entry.
- Scout preserves league competition and coverage, but serializes no full profiles for owners or premium users. Its view no longer renders personality meters or trajectories.
- Relationship responses omit direct and nested profiles and behavior heat. Rivalry explanations no longer receive raw profiles. Stored rebuild-drama narratives are projected without their old embedded labels, and new events no longer write those labels into public prose.
- General Chimmy profile grounding returns no dossiers. The Decision OS prompt serializer excludes manager profiles and cross-league consistency; the admin proof response also omits those private slices. The underlying internal feeds and classifier remain available.
- Legacy league-manager trade responses and trade narrative context emit no profile labels. The league-history fingerprint reader returns no behavioral fingerprints.

## Manager DNA continuation

- Retired the legacy and canonical Manager DNA GET/POST, mock-draft Manager DNA POST, v1 DNA directory, v1 individual-manager and league-manager behavioral listings, and the inferred user trade-profile summary. Constant responses include no-store and do not load profiles. API-key, premium and self-view parameters do not restore these surfaces.
- The authenticated dashboard manager-intelligence GET now resolves league activity alone, preserving membership checks and factual trend counts. It does not read cached three-brain manager prose or compute a whole profile. The associated POST is retired before generation or token spending.
- Replaced the shared Manager DNA dashboard/league/commissioner/team card with an honest Competitive Edge status. Removed the mock-draft DNA fetch, button, dialog and unused trait-meter helpers. Other mock-draft actions remain in place.
- Whole-manager and opponent-profile prompt formatters now return no profile text. Proposal generation no longer inserts its separate DNA archetype prompt and returns no opponent dossier. Its existing internal acceptance calculations remain in place; their calibration and all nested decision explanations are not certified by this pass.
- Legacy chat, trade evaluation and waiver AI context no longer includes stored archetypes, persona titles, inferred style preferences or strengths/weaknesses. Ordinary career records and ratings remain. A real chat-route regression verifies that a seeded old profile reaches the reader but cannot enter the provider prompt or response.
- Trade email rendering with a pre-privacy cached psychology object is byte-identical to rendering without it: manager names, assets and grades remain, while inferred labels and confidence descriptions are withheld. This does not remove already-sent emails or certify other report/export formats.

## Remaining before milestone 32 can be credited

1. Finish the remaining Manager DNA compositions: User OS reads (including server-rendered props), manager command-center summaries, commissioner/presentation adapters and any nested behavioral maps. The dedicated DNA endpoints and shared card are closed; those closures do not certify these other compositions.
2. Audit stored legacy career reports (fresh and cached report responses, profile views and share text) and remaining AI context producers, especially `archetype`, narrative descriptions, trait scores and manager-profile maps. Preserve explicit user preferences and ordinary league/player statistics while removing inferred dossiers.
3. Verify old cached analysis, replay, exported/report and stored narrative payloads cannot bypass the current read projections. Rebuilt drama summaries, the manager-intelligence dashboard cache path and trade-email psychology cards are covered; that does not certify every historical payload.
4. Characterize dynamic route dispatch and every relevant alias against the final public contract. The profile routes' current methods and canonical opponent-tendencies alias are covered in this pass.

## Deliberately EXCLUDED, with the reasoning (added 2026-09-11, after review)

🛑 **`managersAtRetentionRisk` exposes a NAMED THIRD PARTY to a commissioner, and it is excluded on purpose.** A reviewer surfaced it as matching neither the completed list nor the remainder, which was fair: it was in neither. `Mission Control` → `CommissionerContextAssembler` / `MissionControlCard` take the array WHOLE, not its `.length`, and each element is `{ managerId, retentionRisk, retentionRiskReasons, isInactive }` — a named person, a classification, and prose.

It is excluded because it is **not the subsystem this milestone is about**, and that was measured rather than assumed:

- It comes from `lib/decision-os/behavioral/manager-intelligence.ts`, which emits **zero** occurrences of the dossier vocabulary — no `primaryIdentity`, `decisionStyle`, `transactionStyle`, `riskTendency`, `engagementReliability` or `archetype`. It is a different engine from the phase-6 DNA / psychological profiles this pass closes.
- `retentionRiskReasons` are **observable facts, not inferred labels**. The complete emitted set is two strings: `Manager has been inactive for N days` and `Manager has not set their lineup this season`. That is the same standard applied to the recommendation producer in this pass — state the observable fact, never the classification — and this surface already met it.
- The risk tier ships **alongside** its reasons, so a commissioner sees the basis rather than a verdict.

⚠ **This is an exclusion, not a clearance, and the distinction matters.** It IS a third-party disclosure: a commissioner learns that a named manager has not set a lineup. The judgement here is that operational league health with a disclosed observable basis is not a "raw behavioral profile", not that the disclosure is nothing. If that judgement is wrong, the fix is at `leagueHealthAlignment.ts:124` and the two consumers, and it is a product decision about what a commissioner may see — not a privacy defect to be quietly patched.

⚠ **AND "ALREADY IN PRODUCTION" WAS BEING READ AS "PROVEN SAFE".** `lib/decision-os/userOs.ts` described this exposure as "already-proven-safe" and extended it on that basis. It was already SHIPPED; nobody had shown it was safe. The wording is corrected there. Shipped is not proven, and a comment that conflates them turns one unexamined decision into the licence for the next.

## Next functional work

Build the authenticated decision-specific Competitive Edge evidence contract from actual trade, draft and waiver facts. It must bind evidence to the selected move and manager, enforce coverage and freshness, and return bounded factual explanations. Acceptance probabilities and counters require calibration; the new entry does not invent them.

No database migration, app deployment or V2 authority flag change is part of this pass. Release and authenticated browser certification remain separate gates.

## Verification

284 tests passed across 30 suites, covering retired routes and canonical aliases, owner/commissioner access, retained dashboard trends, cached profile prompt/email exclusion, replacement cards, relationship projections, Scout coverage, internal behavioral provider preservation, V2 valuation/strategy regressions and Chimmy. Focused type checking passed for 112 source/test files. Existing repository-wide type and authenticated browser release gates were not rerun or credited. Superseded tests that previously required visible profiles now assert the new privacy contract.
