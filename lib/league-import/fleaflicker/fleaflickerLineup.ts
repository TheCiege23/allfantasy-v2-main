import type { FleaflickerRosterResponse } from './types'

/**
 * One team's lineup from `FetchRoster`: who starts, who is on IR, who is on the taxi squad.
 *
 * 🛑 UNTIL THIS EXISTED, EVERY FLEAFLICKER ROSTER WAS IMPORTED WITH `starter_ids: []`.
 * `FetchLeagueRosters` — the only roster read — carries composition, not lineup (its per-player
 * `displayGroup` is a POSITION group, RUSHER / RECEIVER / DEFENDER, not a slot). So every
 * starter-reading surface saw a Fleaflicker team with nobody in its lineup.
 *
 * Shape from the committed capture (contracts/fleaflicker/fixtures/roster.NFL.2021.week1.team1371776.json):
 *   - START / INJURED / TAXI groups carry `group`; the BENCH group has NO `group` key. Absent means
 *     bench — it is the one group we do not need, and it must not be mistaken for "unknown".
 *   - An empty slot has no `leaguePlayer`, and is skipped rather than written as an empty id.
 *
 * Returns `null` when there is no response or no `groups` array — "we could not read the lineup",
 * which the adapter keeps distinct from "a lineup with nobody in it".
 */
export function readFleaflickerLineup(
  res: FleaflickerRosterResponse | null | undefined,
): { starters: string[]; reserve: string[]; taxi: string[] } | null {
  if (!res || !Array.isArray(res.groups)) return null
  const out = { starters: [] as string[], reserve: [] as string[], taxi: [] as string[] }
  for (const g of res.groups) {
    const bucket = g.group === 'START' ? out.starters : g.group === 'INJURED' ? out.reserve : g.group === 'TAXI' ? out.taxi : null
    if (!bucket) continue
    for (const slot of g.slots ?? []) {
      const id = slot.leaguePlayer?.proPlayer?.id
      // `proPlayer.id` is an INTEGER; stringify without reformatting, like every other Fleaflicker id.
      if (typeof id === 'number' && Number.isFinite(id)) bucket.push(String(id))
    }
  }
  return out
}
