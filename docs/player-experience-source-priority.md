# Player experience source priority

## Principles

- **Rolling Insights** imported JSON on `sports_players` (and related cache) is the **first** place to look for explicit experience / draft / debut fields when they exist in storage.
- **TheSportsDB** and **ClearSports** are used **only as fallbacks** when the merged `stats` / `projections` / `news` JSON actually contains parseable fields (rookie flag, `years_exp` / `experience`, `draftYear`, `debutYear`, `serviceTime`, etc.). **Do not assume** a vendor always sends these fields; run the audit script on Neon to see what is really stored.
- **ClearSports NFL API (documented screenshots)** exposes player-stats, team-stats, injury-stats, teams, games — **not** a documented player-profile/rookie endpoint; stats-only payloads **must not** imply rookie/veteran (see `docs/provider-enrichment-capability-matrix.md`, `hasClearSportsExperienceSignal`).
- **NFL:** **Sleeper `years_exp`** (and the compact cache path via `nflRookieSourcePolicy`) remains the **reliable pro fallback** when imported JSON does not determine experience. **Unknown is better than inventing** rookie or veteran.
- **NCAA (NCAAF / NCAAB):** use **college class** (`lib/draft-room/collegeClass.ts`), not pro years or Sleeper.

Cross-cutting fallback tiers (when experience keys are absent): **`docs/provider-fallback-system.md`**.

## Code map

| Piece | Path |
|--------|------|
| Defensive field extraction (no age/college inference) | `lib/player-data/providerExperienceFields.ts` |
| `resolvePlayerExperience` + sport rules | `lib/player-data/playerExperience.ts` |
| Unified product view (exposes `unified.experience`) | `lib/player-data/unifiedPlayerProductView.ts` |
| NFL-only policy (Sleeper / cache) | `lib/providers/nflRookieSourcePolicy.ts` |

## Read-only audit (Neon, no provider HTTP)

```bash
npm run data:audit-player-experience -- --sport NFL --limit 20
npm run data:audit-player-experience -- --sport NBA --provider thesportsdb --limit 20
npm run data:audit-player-experience -- --sport MLB --provider clearsports --missing experience --limit 20
```

Use `--json` for machine-readable output. The script scans `sports_players` rows for the given `--sport` and summarizes which merged JSON keys appear and how `resolvePlayerExperience` classifies rows.

## Answer: “Can TheSportsDB or ClearSports provide rookie/veteran?”

**Only if your imported rows contain usable keys.** This repo does not guarantee those vendors populate experience fields for every sport; the audit script measures **what landed in Postgres**, not what their public API might return.
