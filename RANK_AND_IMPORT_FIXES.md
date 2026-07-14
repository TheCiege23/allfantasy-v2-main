# Rank + Import fixes — apply guide

These are the changes for **(a)** making native AllFantasy leagues count toward rank +
reconciling the two XP engines, and **(b)** tightening import gating.

Because edits to git-tracked files keep getting reverted through the Cowork file bridge,
**apply each tracked-file change below in your editor and commit it to git** so branch
churn can't undo it. One brand-new file is already written to disk for you.

Before trusting: run `npm run typecheck`, then the rank + import test suites
(`npx vitest run __tests__/rank __tests__/redraft` and the import tests referenced in
`vitest.invited-mvp.config.ts`). I could not run these from the cloud.

---

## (a1) NEW FILE — already written to disk

`lib/rank/deriveNativeLeagueRows.ts` — reads the canonical `franchise_seasons` table so
native AF leagues feed the same career-XP math as imported/legacy history. (Full content
was delivered separately; if churn removes it, re-create it from that file.)

---

## (a2) Hook native leagues into the rank calc

**File:** `lib/rank/calculateRank.ts`

**Add this import** next to the existing imports at the top (after the
`@/lib/rank/rank-xp-constants` import block):

```ts
import { getNativeLeagueRankRows } from '@/lib/rank/deriveNativeLeagueRows'
```

**Then add a "Source 3" block.** Find the end of the Source 2 (legacy) block — the line
just before this comment:

```ts
    // ── Compute XP from merged rows ──────────────────────────────
    const allRows = Array.from(rows.values())
```

Insert this immediately ABOVE that `// ── Compute XP` comment:

```ts
    // ── Source 3: Native AllFantasy leagues (franchise_seasons) ────────
    // Credits finalized native-league seasons the user owned a team in, using
    // the canonical per-franchise season snapshot. Keyed like the other sources
    // so it merges/dedupes into the same XP math. Imported/legacy stay authoritative.
    const nativeRows = await getNativeLeagueRankRows(userId).catch(() => [])
    for (const nr of nativeRows) {
      if (rows.has(nr.key)) continue
      rows.set(nr.key, nr)
    }

```

That's the whole change — native rows now flow into `careerWins`, `careerChampionships`,
`careerPlayoffAppearances`, `careerSeasonsPlayed`, and the size bonus, exactly like
imported rows.

---

## (a3) Reconcile the two XP engines (make rank deterministic)

**File:** `lib/ranking/computeAndSaveRank.ts`

Today this legacy engine writes `user_profiles` with a DIFFERENT XP scale than
`calculateAndSaveRank`, so a user's displayed rank depends on which ran last. Fix: keep
its own projection cache, but stop writing a divergent `user_profiles` — delegate that to
the single canonical engine.

**Add this import** at the top (after the existing `computeLegacyRank` imports):

```ts
import { calculateAndSaveRank } from '@/lib/rank/calculateRank'
```

**Delete these four now-unused aggregate lines** (they exist only to feed the block you're
about to remove):

```ts
  const totalWinsAgg = totals.wins
  const totalLossesAgg = rosterRows.reduce((sum, roster) => sum + safeNumber(roster.losses), 0)
  const tierLabel = `T${Math.min(25, Math.max(1, rankPreview.career.tier))}`
  const xpBig = BigInt(Math.max(0, Math.floor(rankPreview.career.xp)))
```

**Replace the entire `await prisma.userProfile.upsert({ ... })` block** (the final block in
the function, ~28 lines that write `rankTier: tierLabel`, `xpTotal: xpBig`, etc.) with:

```ts
  // Reconciliation: user_profiles is owned by the single canonical engine
  // (calculateAndSaveRank) — imported (all platforms) + legacy + native AF leagues,
  // one XP scale. This engine keeps its own legacyUserRankCache (yearly projections)
  // above but no longer writes a divergent user_profiles scale, which is what made
  // the displayed career rank non-deterministic.
  await calculateAndSaveRank(afUserId)
```

Leave the `legacyUserRankCache.upsert(...)` block above it untouched (that data —
`aiLow/Mid/High` yearly projections — is unique to this engine and still used).

> Trade-off to know: after this, legacy-only users' displayed XP/level follow the
> canonical formula (win 10 / playoff 30 / champ 200, no difficulty multiplier) instead of
> the old legacy scale. That's the intended determinism fix. If you'd rather keep the
> legacy multiplier scale as canonical instead, we'd reconcile the other direction — tell
> me and I'll flip it.

---

## (b) Tighten import gating

**File:** `lib/league-import/commissionerGate.ts`

### b1 — ESPN: auto-verify real commissioners

In `checkEspn`, replace:

```ts
    const commissionerTeamIds = (payload.commissionerTeamIds ?? []).filter(Boolean)
    const viewerTeam = payload.teams.find((team) => team.teamId === viewerTeamId)
    // Any league member with a linked ESPN account may import.
    return {
      ok: true,
      sourceManagerId: viewerTeam?.managerId ?? viewerTeamId,
      verification: 'api',
    }
```

with:

```ts
    const commissionerTeamIds = (payload.commissionerTeamIds ?? []).filter(Boolean)
    const viewerTeam = payload.teams.find((team) => team.teamId === viewerTeamId)
    // Use ESPN's own commissioner list: viewer in it → API-verified commissioner
    // (skips the attestation checkbox). Otherwise leave undefined so the caller
    // still requires the attestation — never hard-blocks a possibly-mis-detected
    // commissioner. (Change `: undefined` to `: false` if you want to hard-block
    // verified NON-commissioners instead.)
    const isCommissioner = commissionerTeamIds.includes(viewerTeamId) ? true : undefined
    return {
      ok: true,
      sourceManagerId: viewerTeam?.managerId ?? viewerTeamId,
      verification: 'api',
      isCommissioner,
    }
```

### b2 — Yahoo: same treatment

In `checkYahoo`, replace:

```ts
    const commissionerTeamKeys = (payload.commissionerTeamKeys ?? []).filter(Boolean)
    const viewerTeam = payload.teams.find((team) => team.teamKey === viewerTeamKey)
    // Any league member with a linked Yahoo account may import.
    return {
      ok: true,
      sourceManagerId: viewerTeam?.managerGuid ?? viewerTeam?.managerId ?? viewerTeamKey,
      verification: 'api',
    }
```

with:

```ts
    const commissionerTeamKeys = (payload.commissionerTeamKeys ?? []).filter(Boolean)
    const viewerTeam = payload.teams.find((team) => team.teamKey === viewerTeamKey)
    // Use Yahoo's own commissioner list (see checkEspn for semantics).
    const isCommissioner = commissionerTeamKeys.includes(viewerTeamKey) ? true : undefined
    return {
      ok: true,
      sourceManagerId: viewerTeam?.managerGuid ?? viewerTeam?.managerId ?? viewerTeamKey,
      verification: 'api',
      isCommissioner,
    }
```

### b3 — Require attestation for Fantrax / Fleaflicker

These are `OPEN_READ_PROVIDERS` and currently get **no** gate at all (any signed-in user can
import any league ID and become owner). Add a combined list right AFTER the existing
`OPEN_READ_PROVIDERS` definition:

```ts
/**
 * Providers a full-league (playable) commit must have a commissioner ATTESTATION for
 * when commissioner status can't be API-verified. Union of:
 *  - MEMBERSHIP_VERIFIED_UNDETERMINED_COMMISSIONER (mfl, espn, yahoo): real membership
 *    proven, commissioner unknowable → attest.
 *  - OPEN_READ_PROVIDERS (fantrax, fleaflicker): public read, NO membership proof at all
 *    → attest. Closes the "any authenticated user can import" hole.
 */
export const ATTESTATION_REQUIRED_PROVIDERS: readonly ImportProvider[] = [
  ...MEMBERSHIP_VERIFIED_UNDETERMINED_COMMISSIONER,
  ...OPEN_READ_PROVIDERS,
]
```

### b4 — Broaden the attestation branch + generalize the message

In `assertImportCommissioner`, change the hard-block message from Sleeper-specific:

```ts
      reason: 'Only the Sleeper commissioner can import this league into AllFantasy.',
```

to:

```ts
      reason: 'Only the league commissioner can import this league into AllFantasy.',
```

And in the same function, change the attestation-branch condition from:

```ts
    MEMBERSHIP_VERIFIED_UNDETERMINED_COMMISSIONER.includes(args.provider)
```

to:

```ts
    ATTESTATION_REQUIRED_PROVIDERS.includes(args.provider)
```

**Resulting behavior:** Sleeper = API commissioner-only (unchanged). ESPN/Yahoo = verified
commissioners import straight through; everyone else attests. MFL = attests (unchanged).
Fantrax/Fleaflicker = now require the attestation (was: nothing). So a full/playable import
now requires commissioner status everywhere — verified where the provider allows, attested
otherwise.

> Optional client polish: the "I am the commissioner" checkbox is driven server-side by the
> `requiresAttestation` response, so it already appears for Fantrax/Fleaflicker on the first
> commit attempt. If you want it shown pre-emptively, we'd surface Fantrax/Fleaflicker to the
> client via `attestationProviders.ts` too.

---

## Verify after applying

1. `npm run typecheck` — expect zero NEW errors from these files.
2. Rank: `npx vitest run __tests__/rank` (+ any `computeLegacyRank`/`calculateRank` specs).
3. Import: run the import commit tests from `vitest.invited-mvp.config.ts`
   (`leagues-import-commit-validation-wiring`, `imported-league-commit-service-tier0`).
4. **Data check for native rank:** confirm your season-finalize pipeline actually writes
   `franchise_seasons` rows (with `userId`) for native AF leagues. If it doesn't yet, native
   leagues will read as 0 until it does — that population step is the companion to (a1/a2).
