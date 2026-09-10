import 'server-only'

import type { League } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { listDivisionsByLeague } from '@/lib/promotion-relegation/DivisionResolver'
import { getDangerTiers } from '@/lib/guillotine/GuillotineDangerEngine'
import { getRosterTeamMap } from '@/lib/zombie/rosterTeamMap'
import type {
  LeagueDashboardView,
  LeagueSettingsRow,
  StandingsPresentation,
} from '@/app/league/[leagueId]/league-dashboard-types'
import { getLeagueScoringConfig } from '@/lib/scoring-defaults/LeagueScoringConfigResolver'
import { buildLeagueScoringDashboardSummary } from '@/lib/league/league-scoring-dashboard'
import { ACTIVE_TEAM_WHERE } from '@/lib/league-import/activeTeams'

function weekFromSettings(settings: unknown): number | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null
  const o = settings as Record<string, unknown>
  const w = o.currentWeek ?? o.current_week ?? o.week
  if (typeof w === 'number' && Number.isFinite(w)) return w
  if (typeof w === 'string') {
    const n = parseInt(w, 10)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function titleCase(s: string): string {
  return s.replace(/\w+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
}

function waiverTypeLabel(w: string | null | undefined): string {
  const s = String(w ?? 'rolling').toLowerCase()
  if (s.includes('faab') || s === 'faab') return 'FAAB (Bidding)'
  if (s.includes('rolling')) return 'Rolling waivers'
  if (s.includes('free')) return 'Free agent / continuous adds'
  return titleCase(s.replace(/_/g, ' '))
}

function formatPlayoffs(league: League): string {
  const teams = league.playoffTeams ?? 4
  const start = league.playoffStartWeek ?? 14
  return `${teams} team${teams === 1 ? '' : 's'}, starts week ${start}`
}

function formatWaiverHours(league: League): string {
  const h = league.waiverHours ?? 24
  return `${h} hour${h === 1 ? '' : 's'} — players stay on waivers for ${h} hour${h === 1 ? '' : 's'}`
}

function formatClearWaivers(league: League): string {
  const tz = league.timezone?.replace(/_/g, ' ') ?? 'League timezone'
  const t = league.waiverProcessTime ?? '02:00'
  return `${league.waiverClearAfterGames ? 'After games clear — next run' : 'Scheduled run'} (${t}, ${tz})`
}

function formatWaiverScheduleJson(raw: unknown, timezone: string | null): string {
  if (raw == null) return 'See commissioner settings'
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) {
    return raw
      .map((entry, i) => {
        if (typeof entry === 'string') return entry
        if (entry && typeof entry === 'object') {
          const o = entry as Record<string, unknown>
          const day = typeof o.day === 'string' ? o.day : typeof o.label === 'string' ? o.label : `Day ${i + 1}`
          const detail = typeof o.detail === 'string' ? o.detail : typeof o.mode === 'string' ? o.mode : ''
          return detail ? `${day}: ${detail}` : String(day)
        }
        return String(entry)
      })
      .join('\n')
  }
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    const lines: string[] = []
    for (const d of days) {
      if (d in o && o[d] != null) {
        lines.push(`${titleCase(d)}: ${String(o[d])}`)
      }
    }
    if (lines.length > 0) {
      return lines.join('\n')
    }
    try {
      return JSON.stringify(raw, null, 0)
    } catch {
      return 'Configured'
    }
  }
  return String(raw)
}

/**
 * Build label/value rows from Prisma `League` — all AF-native fields (no platform IDs in values).
 */
export function buildLeagueSettingsRows(league: League): LeagueSettingsRow[] {
  const rows: LeagueSettingsRow[] = []

  let teamCount = typeof league.leagueSize === 'number' ? league.leagueSize : null
  if (teamCount == null && league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)) {
    const s = league.settings as Record<string, unknown>
    const n = s.total_rosters ?? s.num_teams
    if (typeof n === 'number' && Number.isFinite(n)) teamCount = n
  }
  rows.push({
    label: 'Number of Teams',
    value: teamCount != null ? String(teamCount) : '—',
  })

  const scoring = league.scoring?.trim() || 'Standard'
  const rosterN = league.rosterSize
  rows.push({
    label: 'Roster',
    value:
      rosterN != null
        ? `${rosterN} roster slots · ${scoring}`
        : scoring,
  })

  rows.push({ label: 'Playoffs', value: formatPlayoffs(league) })
  rows.push({ label: 'Waiver Type', value: waiverTypeLabel(league.waiverType) })
  rows.push({ label: 'Clear Waivers', value: formatClearWaivers(league) })
  rows.push({ label: 'Waiver Time', value: formatWaiverHours(league) })

  if (league.customDailyWaivers) {
    rows.push({
      label: 'Custom Daily Waivers',
      value: formatWaiverScheduleJson(league.waiverSchedule, league.timezone),
      multiline: true,
    })
  }

  const td = league.tradeDeadlineWeek
  rows.push({
    label: 'Trade Deadline',
    value:
      td != null && td > 0
        ? `Week ${td} — trades are not allowed after week ${td}`
        : 'No deadline set',
  })

  rows.push({
    label: 'Injured Reserve Slots',
    value: String(league.irSlots ?? 0),
  })

  rows.push({
    label: 'Draft Pick Trading Allowed',
    value: league.draftPickTrading ? 'Yes' : 'No',
  })

  if (league.medianGame) {
    rows.push({ label: 'Median Game', value: 'Enabled' })
  }

  return rows
}

type SurvivorTribeWithMembers = {
  id: string
  slotIndex: number
  name: string | null
  members: Array<{ rosterId: string }>
}

async function loadStandingsPresentation(league: League): Promise<StandingsPresentation> {
  const leagueId = league.id

  if (league.leagueVariant === 'survivor') {
    let tribes: SurvivorTribeWithMembers[] = await prisma.survivorTribe.findMany({
      where: { leagueId, isMerged: false },
      include: { members: true },
      orderBy: { slotIndex: 'asc' },
    }).catch(() => [] as SurvivorTribeWithMembers[])
    if (tribes.length === 0) {
      tribes = await prisma.survivorTribe.findMany({
        where: { leagueId },
        include: { members: true },
        orderBy: { slotIndex: 'asc' },
      }).catch(() => [] as SurvivorTribeWithMembers[])
    }
    if (tribes.length > 0) {
      const map = await getRosterTeamMap(leagueId)
      const presentationTribes = tribes.map((t: SurvivorTribeWithMembers) => ({
        tribeId: t.id,
        name: t.name || `Tribe ${t.slotIndex + 1}`,
        teamIds: t.members
          .map((m: { rosterId: string }) => map.rosterIdToTeamId.get(m.rosterId))
          .filter((id: string | null): id is string => Boolean(id)),
      }))
      return { mode: 'survivor', tribes: presentationTribes }
    }
  }

  if (league.guillotineMode) {
    const w = weekFromSettings(league.settings) ?? 1
    const dangerRows = await getDangerTiers({ leagueId, weekOrPeriod: Math.max(1, w) }).catch(() => [])
    if (dangerRows.length > 0) {
      const map = await getRosterTeamMap(leagueId)
      const dangerByTeamId: Record<string, 'chop_zone' | 'danger' | 'safe'> = {}
      for (const row of dangerRows) {
        const teamId = map.rosterIdToTeamId.get(row.rosterId)
        if (teamId) dangerByTeamId[teamId] = row.tier
      }
      if (Object.keys(dangerByTeamId).length > 0) {
        return { mode: 'guillotine', dangerByTeamId }
      }
    }
    return { mode: 'guillotine', dangerByTeamId: {} }
  }

  const divisions = await listDivisionsByLeague(leagueId, { sport: String(league.sport) }).catch(() => [])
  /* A count decides the dashboard's display mode; an archived team must not tip it. */
  const teamsWithDivision = await prisma.leagueTeam.count({
    where: { ...ACTIVE_TEAM_WHERE, leagueId, divisionId: { not: null } },
  }).catch(() => 0)
  if (divisions.length > 0 && teamsWithDivision > 0) {
    return {
      mode: 'divisions',
      divisions: divisions.map((d) => ({
        divisionId: d.divisionId,
        name: d.name?.trim() || `Division ${d.tierLevel}`,
        tierLevel: d.tierLevel,
      })),
    }
  }

  return { mode: 'standard' }
}

export async function buildLeagueDashboardView(league: League): Promise<LeagueDashboardView> {
  const [settingsRows, standings, scoringConfig] = await Promise.all([
    Promise.resolve(buildLeagueSettingsRows(league)),
    loadStandingsPresentation(league),
    getLeagueScoringConfig(league.id).catch(() => null),
  ])
  const scoring = scoringConfig ? buildLeagueScoringDashboardSummary(scoringConfig) : null
  return { settingsRows, standings, scoring }
}
