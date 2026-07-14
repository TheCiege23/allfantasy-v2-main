# AllFantasy — Phase 0 handoff (run ON YOUR COMPUTER)

This task is running on the user's computer, so **write changes AND commit them to git** —
that's the whole point of running here (the cloud session couldn't persist tracked-file edits).
Work on a focused branch. After each change set: `npm run typecheck`, run the relevant tests,
then `git add -A && git commit`.

Full roadmap: **AF_BUILD_PLAN.md**. Exact rank + import diffs: **RANK_AND_IMPORT_FIXES.md**
(both in the repo root next to this file).

---

## Phase 0 = land the already-written patches + foundation

### 1. Native-league rank source — DONE (file already on disk)
`lib/rank/deriveNativeLeagueRows.ts` already exists (reads `franchise_seasons` so native AF
leagues count toward rank). Just verify it's present and imported by change #3.

### 2. Team Settings wiring — `app/league/[leagueId]/components/CommissionerSettingsModal.tsx`
This is the one that kept reverting in the cloud. Two edits:

Add near the other panel imports (after the `PlaceholderPanel` import):
```ts
import { TeamSettingsPanel } from './settings/TeamSettingsPanel'
```
Then in the tab switch, replace:
```tsx
) : activeTab === 'team' ? (
  <PlaceholderPanel title="Team Settings" subtitle="Names, logos, and owner assignment." />
```
with:
```tsx
) : activeTab === 'team' ? (
  <TeamSettingsPanel leagueId={leagueId} canEdit={canEdit} />
```
(`TeamSettingsPanel.tsx` and the `.../commissioner/leagues/[leagueId]/teams/route.ts` API route
already exist on disk — this line is the only missing wiring.)

### 3. Native leagues into the rank calc — `lib/rank/calculateRank.ts`
Add the import + the "Source 3" merge block. Exact diff in **RANK_AND_IMPORT_FIXES.md → (a2)**.

### 4. Reconcile the two XP engines — `lib/ranking/computeAndSaveRank.ts`
Make it delegate `user_profiles` to `calculateAndSaveRank` (removes non-deterministic rank).
Exact diff in **RANK_AND_IMPORT_FIXES.md → (a3)**.

### 5. Tighten import gating — `lib/league-import/commissionerGate.ts`
ESPN/Yahoo auto-verify commissioners; Fantrax/Fleaflicker require attestation. Four hunks in
**RANK_AND_IMPORT_FIXES.md → (b1–b4)**.

### 6. Foundation (rest of Phase 0)
- **Shared design tokens**: extract the mockup skin (dark/light CSS vars via `data-theme`, AF
  palette, AF shield) into `app/globals.css` + `tailwind.config.js`, reusing the existing
  white-label hooks (`resolveTenantBrand`, `tenantThemeStyle`). Every new surface consumes these.
  Mockups to match: the `af-landing` / `af-full-flow` / universal-dashboard artifacts.
- **Native-rank data check**: confirm the season-finalize pipeline writes `franchise_seasons`
  rows (with `userId`) for native AF leagues. If not, add that write — otherwise native leagues
  score 0 in rank.

---

## Verify + commit
```
npm run typecheck
npx vitest run __tests__/rank
# import tests referenced in vitest.invited-mvp.config.ts
git add -A && git commit -m "Phase 0: land Team Settings + rank + import-gating patches; design tokens"
```

Then continue with **AF_BUILD_PLAN.md** Phase 1 (landing + no-login guest Legacy).
