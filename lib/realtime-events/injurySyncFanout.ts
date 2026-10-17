/**
 * After external injury DB syncs, fan out `player_injury_update` only to leagues that roster
 * the player — bounded emits to avoid spam (Sleeper-like signal without notifying the world).
 */
import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeMatchName } from '@/lib/player-match/verifiedNameMatch'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { emitPlayerInjuryOrNewsFanout } from '@/lib/realtime-events/realtimeEventService'
import {
  injuryFanoutSortPriority,
  shouldIncludeInjuryInFanoutBatch,
  type InjurySyncFanoutRow,
} from '@/lib/realtime-events/injuryFanoutPolicy'

export type { InjurySyncFanoutRow }
export { injuryFanoutSortPriority, shouldIncludeInjuryInFanoutBatch }

const DEFAULT_MAX_EMITS = 28
/** Max distinct players to resolve per sync (limits DB round-trips). */
const MAX_PLAYERS_PER_SYNC = 48

function hourBucket(): number {
  return Math.floor(Date.now() / (60 * 60 * 1000))
}

/*
 * 🛑 THE NAME FINDS CANDIDATES; THE CLUB DECIDES (2026-10-12). This bound roster rows by name
 * equality, fell back to `contains`, and never looked at the team — so "DeVonta Smith Out" (WR, PHI)
 * would post to every league rostering CB DeVonta Smith (CAR) as well, and a `contains` hit could be
 * any longer name. 216 NFL names are held by 2+ Sleeper ids. Neither injury writer carries a Sleeper
 * id (ESPN athlete ids, API-Sports ids), so a roster row binds only when its normalized name equals
 * the injury's AND its team is the injury's team; an injury with no team posts nowhere.
 */
async function findLeagueIdsForRosteredPlayer(inj: InjurySyncFanoutRow, sport: string): Promise<string[]> {
  const name = inj.playerName.trim()
  const key = normalizeMatchName(name)
  const club = normalizeTeamAbbrev(inj.team)
  if (!key || !club) return []
  const sportU = sport.toUpperCase()

  const select = { playerName: true, team: true, roster: { select: { leagueId: true } } } as const
  const exact = await prisma.redraftRosterPlayer.findMany({
    where: {
      droppedAt: null,
      sport: sportU,
      playerName: { equals: name, mode: 'insensitive' },
    },
    select,
    take: 500,
  })

  const ids = new Set<string>()
  const collect = (rows: typeof exact) => {
    for (const row of rows) {
      if (normalizeMatchName(row.playerName) !== key) continue
      if (normalizeTeamAbbrev(row.team) !== club) continue
      const lid = row.roster?.leagueId
      if (lid) ids.add(lid)
    }
  }
  collect(exact)

  // Spelling variants ("Jr." vs none) only — the normalized-name check above rejects a longer name.
  if (ids.size === 0 && name.length >= 6) {
    const fuzzy = await prisma.redraftRosterPlayer.findMany({
      where: {
        droppedAt: null,
        sport: sportU,
        playerName: { contains: name, mode: 'insensitive' },
      },
      select,
      take: 200,
    })
    collect(fuzzy)
  }

  return [...ids]
}

/**
 * Emits league activity + SSE (skipNotifications) for roster-relevant injuries, capped per sync.
 */
export async function fanoutInjurySyncBatch(params: {
  sport: string
  injuries: InjurySyncFanoutRow[]
  maxEmits?: number
}): Promise<{ emitted: number; injuriesSkippedForCap: number }> {
  const maxEmits = params.maxEmits ?? DEFAULT_MAX_EMITS
  const byPlayer = new Map<string, InjurySyncFanoutRow>()
  for (const inj of params.injuries) {
    if (!shouldIncludeInjuryInFanoutBatch(inj.status)) continue
    // Name AND club: two namesakes on the report are two players, not one row to dedupe.
    const nameKey = normalizeMatchName(inj.playerName)
    if (!nameKey) continue
    const k = `${nameKey}|${normalizeTeamAbbrev(inj.team) ?? ''}`
    const prev = byPlayer.get(k)
    if (!prev || injuryFanoutSortPriority(inj.status) < injuryFanoutSortPriority(prev.status)) {
      byPlayer.set(k, inj)
    }
  }

  const list = [...byPlayer.values()]
    .sort((a, b) => injuryFanoutSortPriority(a.status) - injuryFanoutSortPriority(b.status))
    .slice(0, MAX_PLAYERS_PER_SYNC)

  let emitted = 0
  let injuriesSkippedForCap = 0
  const hb = hourBucket()
  const sport = params.sport.toUpperCase()

  outer: for (const inj of list) {
    if (emitted >= maxEmits) {
      injuriesSkippedForCap += 1
      continue
    }

    const leagueIds = await findLeagueIdsForRosteredPlayer(inj, sport)
    if (leagueIds.length === 0) continue

    const title = `Injury: ${inj.playerName} (${inj.status})`
    const msgParts = [inj.type, inj.description].filter(Boolean).join(' — ')
    const message =
      msgParts.length > 0
        ? msgParts.slice(0, 480)
        : `${inj.playerName} — ${inj.status}${inj.team ? ` (${inj.team})` : ''}`

    for (const leagueId of leagueIds) {
      if (emitted >= maxEmits) {
        break outer
      }
      try {
        await emitPlayerInjuryOrNewsFanout({
          leagueId,
          eventType: 'player_injury_update',
          title: title.slice(0, 256),
          message: message.slice(0, 500),
          category: 'injury_alerts',
          meta: {
            playerName: inj.playerName,
            team: inj.team,
            status: inj.status,
            type: inj.type ?? null,
            source: 'injury_sync',
          },
          dedupeKey: `inj-sync:${sport}:${leagueId}:${inj.playerName.toLowerCase()}:${normalizeTeamAbbrev(inj.team) ?? ''}:${hb}`,
          skipNotifications: true,
        })
        emitted += 1
      } catch {
        // non-fatal
      }
    }
  }

  return { emitted, injuriesSkippedForCap }
}
