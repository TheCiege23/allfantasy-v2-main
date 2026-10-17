import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import { injuryClaimAsOf } from '@/lib/injuries/matchInjuryRows'

type InjuryKeyed = { playerId?: string | null; playerName?: string | null; sport?: string | null }

/*
 * 🛑 THE ID KEY CARRIES THE NAME TOO. `SportsInjury.playerId` is whatever id the writing provider
 * uses, and a Sleeper roster id collides with Rolling Insights' ids for different people (Sleeper
 * 8394 is Percy Butler, RI 8394 is Rome Odunze). Keyed on the id alone, `/api/redraft/roster`
 * attached a stranger's designation to the roster — measured 2026-10-11, 5,515 of 5,515 live RI id
 * matches on Sleeper redraft rosters were the wrong person ("Brock Purdy" <- Jaylon Carlies, Out).
 * With the name in the key a row applies only when id AND name agree, which drops the impostors and
 * nothing else: a same-person row whose provider shares the roster's id space still matches.
 */
export function playerInjuryKey(player: InjuryKeyed): string {
  const sport = String(player.sport ?? '').toUpperCase()
  const playerId = String(player.playerId ?? '').trim()
  const name = normalizePlayerName(player.playerName)
  if (playerId) return `${sport}:id:${playerId}:${name}`
  return `${sport}:name:${name}`
}

/**
 * Stamp each roster player with the newest matching designation. Rows carrying `fetchedAt` are taken
 * newest CLAIM first (`injuryClaimAsOf`); the rest in the order given. A player with an id is matched
 * by id + name; one without, by name. Pure.
 *
 * ⚠ NOT NEWEST FETCH. The route reads rows by `fetchedAt`, and Rolling Insights re-pulls Friday's
 * "Questionable" every 30 minutes, so after ESPN cleared a starter on Sunday his status still
 * flipped with each cron run — and with it the `starter_ineligible_injury` lineup error.
 */
export function applyInjuryStatuses<T extends InjuryKeyed>(
  players: T[],
  rows: Array<InjuryKeyed & { status: string | null; date?: Date | null; fetchedAt?: Date | null }>,
): Array<T | (T & { injuryStatus: string })> {
  const ordered = rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      if (a.row.fetchedAt && b.row.fetchedAt) {
        const byClaim = injuryClaimAsOf(b.row).getTime() - injuryClaimAsOf(a.row).getTime()
        if (byClaim !== 0) return byClaim
      }
      return a.i - b.i
    })
    .map((x) => x.row)
  const statusByKey = new Map<string, string | null>()
  for (const row of ordered) {
    const idKey = playerInjuryKey(row)
    if (!statusByKey.has(idKey)) statusByKey.set(idKey, row.status ?? null)
    const nameKey = playerInjuryKey({ sport: row.sport, playerName: row.playerName })
    if (!statusByKey.has(nameKey)) statusByKey.set(nameKey, row.status ?? null)
  }
  return players.map((player) => {
    const status = statusByKey.get(playerInjuryKey(player))
    return status ? { ...player, injuryStatus: status } : player
  })
}
