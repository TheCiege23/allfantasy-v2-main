# OS Consumer Matrix (Phase 5H Audit)

Which shared canonical facts each OS consumes, and whether it maintains a private competing truth. `C` = canonical/shared, `L` = legacy table, `–` = n/a.

| OS | players | teams | schedules | statistics | history | valuations | projections | injuries | images | freshness | provenance | private truth? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Lineup OS** | C (identity) + L | L | C (games) | L | L | – | – | – | L (headshot) | C (5E) | C (5E) | no |
| **Waiver OS** | C + L (pool) | L | C | L | L | C (FantasyCalc) | – | L (pool) | L | C | C | no |
| **Trade OS** | C (identity) | – | – | L | L | C (FantasyCalc) | – | – | – | C | C | no |
| **Draft OS** | L (pool) | L | – | – | – | C | – | – | L | C | C | no |
| **Matchup OS** | L | L | C (games) | L | L | – | – | – | – | C | C | no |
| **Scoring OS** | L | L | C (games/finality) | L (`PlayerWeeklyScore`) | L | – | – | – | – | C | C | no |
| **Intelligence OS** | C (identity) | C (health) | C | C (evidence avail.) | – | – | – | – | – | C | C | no |
| **Coach / Chimmy** | grounding only | grounding | grounding | grounding | – | – | – | – | – | C | C | no |
| **Observability** | – | – | C (freshness) | C (coverage) | – | – | – | – | – | C | C | no |

## Findings
- **No OS maintains a hidden competing PROVIDER truth** — all provider access is centralized; every OS reads either legacy canonical tables or the certified plane. ✅
- **But most OS still read legacy Prisma tables (`L`) for authoritative facts**, with certified plane (`C`) added as grounding/identity/freshness. This is the documented temporary legacy dependency; converging every `L` to a single canonical port is **REQ-WIRING** (and history/values need **REQ-MIGRATION**).
- **Images and detailed statistics** are the most fragmented consumer inputs (multiple legacy tables/modules).
- **Positions** are also fragmented: a governed source exists (`canonical/canonicalPosition.ts`, 5H-b) and is now sport-isolated + enforcement-locked (5H-b2), but OS/product consumers still normalize positions via the legacy shared collapser `lib/team-abbrev.ts` (imported by ~40 files for roster-slot legality) and via valuation-specific maps (`idp-kicker-values`, `dynasty-tiers`). 5H-b2 re-audit: 24+ competing maps, 0 safely migratable this increment (each documented in `SPORTS_DATA_IMAGE_AND_POSITION_POLICY.md`). Adoption is a reviewed per-caller migration.
- **Images** (Phase 5H-c): governed `canonical/canonicalImage.ts` exists (precedence/validation/entity+sport isolation, enforcement-locked) but every OS render path still uses one of ~9 legacy inline resolvers (NFL orchestrator, `buildPlayerMap`, `player-media`, `getPlayerDataForSurface`, `player-asset-resolver`, `teamLogos`, …). NOT rewired — the phase forbids visual changes; adoption is a visual-safe per-caller migration.
- **Factual domains** (Phase 5H-f): canonical injury/availability/depth-chart/projection/correction/history contracts + ports exist (`persistence/factualDomains`), tables proven in non-prod. **Not yet wired into any OS consumer** (gates default-off); consumers must receive labeled facts (injury=fact, availability=observed|derived-labeled, depth=provider|derived-labeled, projection=evidence-not-authority) via ports, never repositories. Wiring = REQ-WIRING (deferred). Legacy injury/status/depth consumers unchanged.
- **Values** (Phase 5H-c): governed `canonical/canonicalValue.ts` exists (distinct value/ranking/adp/projection/stat boundaries, format + position governed) but OS value inputs still flow through `canonicalPlayerValuations` (deprecated FantasyCalc alias, 56 importers) + 4 other value systems, several of which MERGE stats/projections/adp/values ambiguously (`SportsPlayerRecord`, `FantasyValueSnapshotService`, `sports-db-valuation`). No OS imports a FantasyCalc value client directly (test-locked). Adoption is REQ-WIRING; each OS must consume values as governed evidence with format/freshness/coverage/provenance.

## Rule going forward
Every OS must depend on the shared canonical port layer. New OS work must not introduce a new private player/team/statistics/image truth. The boundary test (`unified-plane-provider-boundary.test.ts`) enforces no direct-provider imports; a follow-on test should assert canonical-entity-id usage once the canonical port layer is the single source.
