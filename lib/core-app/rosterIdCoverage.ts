/**
 * Does a league's roster data speak Sleeper ids at all?
 *
 * Every Player Finder read keys on `SportsPlayer.sleeperId`, and the ESPN
 * importer's own header records that ESPN rosters arrive as bare ESPN ids.
 * Scanning such a roster for a Sleeper id finds nothing — which is
 * indistinguishable from "he is unrostered here", and that is a claim, not a
 * gap. So before saying "free agent" or "someone else has him", ask whether
 * the ids on these rosters resolve to our player table at all.
 *
 * ⚠ CLIENT-SAFE AND PURE. The caller samples the ids and asks the database
 * which ones are known; this only decides what the answer means. Tested in
 * __tests__/player-finder-league-view.test.ts.
 *
 * The threshold is deliberately low. A Sleeper league's rosters resolve at
 * close to 100%; an ESPN league's resolve at 0%. Anything in between is a
 * partial identity map, and the honest reading of "half the ids are ours" is
 * still "we can search this roster" — a miss then is a real miss on a player
 * we do know, not a vocabulary mismatch.
 */

export type RosterIdCoverage = {
  sampled: number
  matched: number
  /** matched / sampled, 0 when nothing was sampled. */
  fraction: number
  /** True when a Sleeper-id scan of these rosters can be trusted. */
  usable: boolean
}

export const USABLE_FRACTION = 0.5

/** Up to `limit` distinct ids drawn evenly from the rosters' arrays. */
export function sampleRosterIds(playerDatas: readonly unknown[], limit = 120): string[] {
  const seen = new Set<string>()
  for (const raw of playerDatas) {
    const pd = (raw ?? {}) as Record<string, unknown>
    for (const key of ['players', 'starters', 'reserve', 'taxi']) {
      const arr = pd[key]
      if (!Array.isArray(arr)) continue
      for (const x of arr) {
        if (x == null) continue
        const id = String(x)
        if (!id) continue
        seen.add(id)
        if (seen.size >= limit) return [...seen]
      }
    }
  }
  return [...seen]
}

export function rosterIdCoverage(sampled: readonly string[], known: ReadonlySet<string>): RosterIdCoverage {
  let matched = 0
  for (const id of sampled) if (known.has(id)) matched += 1
  const fraction = sampled.length === 0 ? 0 : matched / sampled.length
  return { sampled: sampled.length, matched, fraction, usable: sampled.length > 0 && fraction >= USABLE_FRACTION }
}

/** The sentence the screen shows for a league whose rosters we cannot read this way. */
export function coverageReason(platform: string | null | undefined): string {
  const p = (platform ?? '').trim().toLowerCase()
  const label = p === 'espn' ? 'ESPN' : p === 'yahoo' ? 'Yahoo' : p ? p : 'this platform'
  return `this league's rosters use ${label} player ids we have not matched to our player table yet, so we cannot tell who has him`
}
