import type { LeagueSport } from '@prisma/client'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { prisma } from '@/lib/prisma'
import type { LineupsActionThresholds } from '@/lib/lineup-actions/thresholds'
import type { LineupActionItem } from '@/lib/lineup-actions/types'
import { isSleeperBestBallLeague } from '@/lib/lineup-actions/sleeperLeagueMeta'
import { isSleeperPlayerLegalInSlot, sleeperStarterSlotLabels } from '@/lib/lineup-actions/sleeperSlotUtils'

const SLEEPER = 'https://api.sleeper.app/v1' // db-first-exception: Sleeper public API base

type SleeperRoster = {
  roster_id?: number
  owner_id?: string
  starters?: (string | null)[]
  players?: string[]
}

type SleeperMatchup = {
  roster_id?: number
  starters?: (string | null)[]
}

function sportToDbSport(sleeperSport: string): LeagueSport {
  const u = sleeperSport?.trim().toUpperCase() ?? 'NFL'
  const map: Record<string, LeagueSport> = {
    NFL: 'NFL',
    NBA: 'NBA',
    MLB: 'MLB',
    NHL: 'NHL',
    NCAAF: 'NCAAF',
    CFB: 'NCAAF',
    NCAAB: 'NCAAB',
    CBB: 'NCAAB',
    SOCCER: 'SOCCER',
    EPL: 'SOCCER',
    UCL: 'SOCCER',
    MLS: 'SOCCER',
  }
  return map[u] ?? normalizeToSupportedSport(u)
}

async function fetchSleeperStateWeek(sportSlug: string): Promise<number> {
  const slug = sportSlug?.trim().toLowerCase() || 'nfl'
  try {
    const st = await fetch(`${SLEEPER}/state/${encodeURIComponent(slug)}`, { next: { revalidate: 60 } })
    if (!st.ok) return 1
    const j = (await st.json()) as { week?: number; leg?: number; display_week?: number }
    const w = typeof j.display_week === 'number' ? j.display_week : typeof j.week === 'number' ? j.week : j.leg
    if (typeof w === 'number' && w > 0) return w
  } catch {
    /* default */
  }
  return 1
}

type ResolvedPlayer = {
  externalId: string
  name: string | null
  position: string | null
  status: string | null
}

async function loadSleeperPlayersForSport(
  sport: LeagueSport,
  playerIds: string[]
): Promise<Map<string, ResolvedPlayer>> {
  const ids = Array.from(new Set(playerIds.filter((x) => typeof x === 'string' && x.length > 0))).slice(0, 80)
  if (ids.length === 0) return new Map()

  const rows = await prisma.sportsPlayer.findMany({
    where: {
      sport,
      OR: [{ externalId: { in: ids } }, { sleeperId: { in: ids } }],
    },
    orderBy: { fetchedAt: 'desc' },
    select: { externalId: true, sleeperId: true, name: true, position: true, status: true },
  })

  const by = new Map<string, ResolvedPlayer>()
  for (const r of rows) {
    const entry: ResolvedPlayer = {
      externalId: r.externalId,
      name: r.name,
      position: r.position,
      status: r.status,
    }
    by.set(r.externalId, entry)
    if (r.sleeperId) by.set(r.sleeperId, entry)
  }
  return by
}

function normalizeStatus(st: string | null | undefined): string {
  return (st ?? '').trim().toUpperCase()
}

export type SleeperLineupScanArgs = {
  leagueId: string
  leagueName: string
  platformLeagueId: string
  ownerSleeperId: string
  thresholds: LineupsActionThresholds
}

export type SleeperLineupScanResult = {
  actions: LineupActionItem[]
  scanIncomplete: boolean
  skippedBestBall: boolean
  sleeperSportSlug: string
}

export async function scanSleeperLeagueLineup(args: SleeperLineupScanArgs): Promise<SleeperLineupScanResult> {
  const { leagueId, leagueName, platformLeagueId, ownerSleeperId, thresholds } = args

  const actions: LineupActionItem[] = []
  let scanIncomplete = false

  try {
    const leagueInfoRes = await fetch(`${SLEEPER}/league/${encodeURIComponent(platformLeagueId)}`, {
      next: { revalidate: 120 },
    })
    if (!leagueInfoRes.ok) {
      return { actions: [], scanIncomplete: true, skippedBestBall: false, sleeperSportSlug: 'nfl' }
    }
    const leagueJson = (await leagueInfoRes.json()) as Record<string, unknown>
    const rawSport = typeof leagueJson.sport === 'string' ? leagueJson.sport : 'nfl'
    const sleeperSportSlug = rawSport.trim().toLowerCase()

    if (thresholds.bestBallSkipManual && isSleeperBestBallLeague(leagueJson)) {
      return { actions: [], scanIncomplete: false, skippedBestBall: true, sleeperSportSlug }
    }

    const dbSport = sportToDbSport(sleeperSportSlug)
    const week = await fetchSleeperStateWeek(sleeperSportSlug)

    const [rostersRes, matchRes] = await Promise.all([
      fetch(`${SLEEPER}/league/${encodeURIComponent(platformLeagueId)}/rosters`, { next: { revalidate: 30 } }),
      fetch(`${SLEEPER}/league/${encodeURIComponent(platformLeagueId)}/matchups/${week}`, { next: { revalidate: 30 } }),
    ])

    const rosters = rostersRes.ok ? ((await rostersRes.json()) as SleeperRoster[]) : []
    const matchups = matchRes.ok ? ((await matchRes.json()) as SleeperMatchup[]) : []
    if (!rostersRes.ok || !matchRes.ok) scanIncomplete = true

    const rosterPositions = Array.isArray(leagueJson.roster_positions)
      ? (leagueJson.roster_positions as string[])
      : []
    const starterSlots = sleeperStarterSlotLabels(rosterPositions)

    const roster = Array.isArray(rosters)
      ? rosters.find((r) => String(r.owner_id) === String(ownerSleeperId))
      : undefined
    const rosterId = roster?.roster_id
    const matchup = Array.isArray(matchups) ? matchups.find((m) => m.roster_id === rosterId) : undefined

    const startersRaw = matchup?.starters ?? roster?.starters ?? []
    const starters = Array.isArray(startersRaw) ? startersRaw : []

    /*
     * ⚠ SLEEPER MARKS AN UNFILLED STARTING SLOT WITH THE STRING "0", AND THAT
     * SENTINEL USED TO SURVIVE THIS LOOP. `"0".length > 0` is true, so an
     * empty slot was pushed through as a real player id — and every check
     * downstream then treated the slot as filled:
     *
     *   - the empty-slot detector below does `if (pid) continue`, so it never
     *     fired for a genuinely empty slot. That detector is the engine's most
     *     important one, and it was dead.
     *   - "0" resolves to no player, so position comes back null, and the
     *     legality check treats an unknown position as legal — no illegal_slot
     *     either.
     *   - no status, so no injured/doubtful/questionable row.
     *
     * The net effect was an engine that returned almost nothing while paying
     * its full cost, most visibly in preseason when lineups are unset. Every
     * consumer of `starterIds` below reads '' as empty, so normalising here is
     * the whole fix.
     */
    const EMPTY_SLOT = '0'
    const starterIds: string[] = []
    for (let i = 0; i < starterSlots.length; i++) {
      const slot = starters[i]
      const id = typeof slot === 'string' ? slot : ''
      starterIds.push(id.length > 0 && id !== EMPTY_SLOT ? id : '')
    }

    // Empty starter slots (aligned to expected starter count)
    for (let i = 0; i < starterSlots.length; i++) {
      const pid = starterIds[i]
      if (pid) continue
      const slotLabel = starterSlots[i] ?? 'START'
      actions.push({
        leagueId,
        leagueName,
        sport: dbSport,
        platform: 'sleeper',
        teamId: rosterId != null ? String(rosterId) : null,
        slotIndex: i,
        slotId: `sleeper:${i}`,
        slotLabel,
        playerId: null,
        playerName: null,
        reasonType: 'empty_starter',
        urgency: 'urgent',
        lockTime: null,
        recommendedAction: 'Fill this starting slot before lock.',
        suggestedReplacementPlayerId: null,
        confidence: null,
        expectedGain: null,
        sourceModule: 'lineup_scan',
        message: `Empty ${slotLabel} slot`,
        severity: 'critical',
      })
    }

    const filledIds = starterIds.filter((x) => x.length > 0)
    const byPlayer = await loadSleeperPlayersForSport(dbSport, filledIds)

    for (let i = 0; i < starterSlots.length; i++) {
      const pid = starterIds[i]
      if (!pid) continue
      const slotLabel = starterSlots[i] ?? 'START'
      const p = byPlayer.get(pid)
      const name = p?.name ?? null
      const pos = p?.position ?? null
      const stRaw = normalizeStatus(p?.status)

      if (!isSleeperPlayerLegalInSlot(slotLabel, pos)) {
        actions.push({
          leagueId,
          leagueName,
          sport: dbSport,
          platform: 'sleeper',
          teamId: rosterId != null ? String(rosterId) : null,
          slotIndex: i,
          slotId: `sleeper:${i}`,
          slotLabel,
          playerId: pid,
          playerName: name,
          reasonType: 'illegal_slot',
          urgency: 'urgent',
          lockTime: null,
          recommendedAction: 'Move this player to a legal slot or swap in an eligible starter.',
          suggestedReplacementPlayerId: null,
          confidence: null,
          expectedGain: null,
          sourceModule: 'lineup_scan',
          message: `${name ?? 'Player'} is not eligible for ${slotLabel}`,
          severity: 'critical',
        })
        continue
      }

      if (stRaw === 'OUT' || stRaw === 'IR' || stRaw === 'INJURED RESERVE' || stRaw === 'OFS' || stRaw === 'SUSPENDED') {
        actions.push({
          leagueId,
          leagueName,
          sport: dbSport,
          platform: 'sleeper',
          teamId: rosterId != null ? String(rosterId) : null,
          slotIndex: i,
          slotId: `sleeper:${i}`,
          slotLabel,
          playerId: pid,
          playerName: name,
          reasonType: 'injured_starter',
          urgency: 'urgent',
          lockTime: null,
          recommendedAction: 'Replace injured or inactive starter.',
          suggestedReplacementPlayerId: null,
          confidence: null,
          expectedGain: null,
          sourceModule: 'lineup_scan',
          message: `${name ?? 'Starter'} is ${p?.status ?? stRaw}`,
          severity: 'critical',
        })
        continue
      }

      if (stRaw === 'DOUBTFUL' && thresholds.countDoubtfulAsAction) {
        actions.push({
          leagueId,
          leagueName,
          sport: dbSport,
          platform: 'sleeper',
          teamId: rosterId != null ? String(rosterId) : null,
          slotIndex: i,
          slotId: `sleeper:${i}`,
          slotLabel,
          playerId: pid,
          playerName: name,
          reasonType: 'doubtful_starter',
          urgency: 'soon',
          lockTime: null,
          recommendedAction: 'Strongly consider benching or pivoting before lock.',
          suggestedReplacementPlayerId: null,
          confidence: null,
          expectedGain: null,
          sourceModule: 'lineup_scan',
          message: `${name ?? 'Player'} is Doubtful`,
          severity: 'warning',
        })
        continue
      }

      if (stRaw === 'QUESTIONABLE' && thresholds.countQuestionableAsAction) {
        actions.push({
          leagueId,
          leagueName,
          sport: dbSport,
          platform: 'sleeper',
          teamId: rosterId != null ? String(rosterId) : null,
          slotIndex: i,
          slotId: `sleeper:${i}`,
          slotLabel,
          playerId: pid,
          playerName: name,
          reasonType: 'questionable_starter',
          urgency: 'soon',
          lockTime: null,
          recommendedAction: 'Monitor injury report; consider a safer starter.',
          suggestedReplacementPlayerId: null,
          confidence: null,
          expectedGain: null,
          sourceModule: 'lineup_scan',
          message: `${name ?? 'Player'} is Questionable`,
          severity: 'warning',
        })
      }
    }

    return { actions, scanIncomplete, skippedBestBall: false, sleeperSportSlug }
  } catch {
    return { actions: [], scanIncomplete: true, skippedBestBall: false, sleeperSportSlug: 'nfl' }
  }
}
