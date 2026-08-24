import 'server-only'

import type { InjuryReportRecord, SportsPlayerRecord } from '@prisma/client'
import type { LeagueToolAccessErrorCode } from '@/lib/ai-tools/league-tool-context-types'
import { leagueToolAccessUserMessage } from '@/lib/ai-tools/league-tool-access-messages'
import { assertLeagueMemberWithCode } from '@/lib/league/league-access'
import { openaiChatText } from '@/lib/openai-client'
import { listInjuryFacts } from '@/lib/injuries/injuryReadPort'
import { prisma } from '@/lib/prisma'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { attachIntelligenceToChimmyPayload, buildAiToolPayload } from '@/lib/intelligence'
import { enrichChimmyWithPlayerSportsNorm } from '@/lib/sports-data-normalization'
import { buildWeatherAugmentFromCachedWeather } from '@/lib/weather/applyWeatherToFantasyProjection'
import { defaultGameTimeForSport } from '@/lib/weather/defaultGameTimes'
import { fetchWeatherForTeamHomeWindow } from '@/lib/weather/venueResolver'
import { resolveNormalizedLeagueContext } from '@/lib/league-context-engine'
import type { NormalizedLeagueContext } from '@/lib/league-context-engine/types'
import { normalizeToSupportedSport, SUPPORTED_SPORTS, type SupportedSport } from '@/lib/sport-scope'
import type { AiToolPayloadEnvelope } from '@/lib/intelligence/buildAiToolPayload'
import type {
  InjuryImpactDashboardInput,
  InjuryImpactDashboardOutput,
  InjuryIntegrationHints,
  InjuryPlayerIntelRow,
  InjurySeverityBucket,
  InjuryStatusFilterId,
  InjuryTimeHorizonId,
  InjuryImpactValidation,
} from './types'
import { enrichInjuryRowsWithLeagueProjections } from './injuryProjectionEnrichment'
import { computeInjuryConfidence, formatInjuryFreshnessNote } from './injuryFreshness'
import { buildReplacementHint } from './injuryReplacementHints'
import { parseReturnTimeline } from './returnTimelineParser'
import type { InjuryFeedFreshness } from './types'

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n))
}

function sinceForHorizon(h: InjuryTimeHorizonId): Date {
  const now = Date.now()
  switch (h) {
    case 'today':
      return new Date(now - 24 * 60 * 60 * 1000)
    case 'this_week':
      return new Date(now - 7 * 24 * 60 * 60 * 1000)
    case 'next_2_weeks':
      return new Date(now - 14 * 24 * 60 * 60 * 1000)
    case 'next_month':
      return new Date(now - 30 * 24 * 60 * 60 * 1000)
    case 'rest_of_season':
    case 'playoff_window':
      return new Date(now - 45 * 24 * 60 * 60 * 1000)
    case 'dynasty_long':
      return new Date(now - 90 * 24 * 60 * 60 * 1000)
    default:
      return new Date(now - 21 * 24 * 60 * 60 * 1000)
  }
}

function bucketFromStatus(status: string | null | undefined): InjurySeverityBucket {
  if (!status?.trim()) return 'other'
  const u = status.toLowerCase()
  if (u.includes('ir') || u.includes('injured reserve')) return 'ir'
  if (/\bout\b/.test(u) && !u.includes('without')) return 'out'
  if (u.includes('suspend')) return 'suspended'
  if (u.includes('doubt')) return 'doubtful'
  if (u.includes('quest')) return 'questionable'
  if (u.includes('prob')) return 'probable'
  if (u.includes('game time') || u.includes('gtd') || u === 'gtd') return 'gtd'
  if (u.includes('day-to-day') || u.includes('day to day')) return 'questionable'
  if (u.includes('week-to-week') || u.includes('week to week')) return 'doubtful'
  if (u.includes('pup') || u.includes('nfi')) return 'out'
  return 'other'
}

function baseScoreFromBucket(b: InjurySeverityBucket): number {
  switch (b) {
    case 'out':
      return 92
    case 'ir':
      return 88
    case 'suspended':
      return 85
    case 'doubtful':
      return 72
    case 'gtd':
      return 58
    case 'questionable':
      return 48
    case 'probable':
      return 28
    default:
      return 38
  }
}

function statusFilterAllows(bucket: InjurySeverityBucket, filter: InjuryStatusFilterId): boolean {
  if (filter === 'all') return true
  const map: Record<InjuryStatusFilterId, InjurySeverityBucket[]> = {
    all: [],
    healthy_monitoring: ['probable', 'other'],
    questionable: ['questionable'],
    doubtful: ['doubtful'],
    out: ['out'],
    ir: ['ir'],
    suspended: ['suspended'],
    gtd: ['gtd'],
    day_to_day: ['questionable', 'gtd'],
    week_to_week: ['doubtful', 'questionable'],
    long_term: ['out', 'ir'],
    returning_soon: ['probable', 'questionable'],
  }
  const allowed = map[filter]
  if (!allowed?.length) return true
  return allowed.includes(bucket)
}

function getStarterIds(playerData: unknown): string[] {
  if (!playerData || typeof playerData !== 'object' || Array.isArray(playerData)) return []
  const s = (playerData as Record<string, unknown>).starters
  if (!Array.isArray(s)) return []
  return s.map((x) => String(x)).filter(Boolean)
}

function rowFromInjuryReport(
  r: InjuryReportRecord,
  opts: {
    onRoster: boolean
    isStarter: boolean
    headshotUrl: string | null
    dataGaps: string[]
  },
): InjuryPlayerIntelRow {
  const bucket = bucketFromStatus(r.status)
  let impact = baseScoreFromBucket(bucket)
  if (opts.isStarter) impact = clamp(impact + 12, 0, 100)
  const lineup = clamp(impact * 0.92, 0, 100)
  const urg = clamp((baseScoreFromBucket(bucket) / 100) * (opts.isStarter ? 92 : 55), 0, 100)
  const conf = 0.72
  return {
    // Port-sourced rows may carry no roster-resolvable playerId — fall back to
    // the name so distinct players never collapse onto one key.
    playerKey: `${r.sport}:${r.playerId || r.playerName.toLowerCase()}`,
    name: r.playerName,
    position: '—',
    team: r.team,
    sport: r.sport,
    statusRaw: r.status,
    severity: bucket,
    source: 'injury_report',
    sourceId: r.id,
    notes: r.notes ?? null,
    practice: r.practice ?? null,
    gameStatus: r.gameStatus ?? null,
    reportDate: r.reportDate.toISOString(),
    lastUpdated: null,
    onRoster: opts.onRoster,
    isStarter: opts.isStarter,
    headshotUrl: opts.headshotUrl,
    impactScore: Math.round(impact * 10) / 10,
    lineupDisruption: Math.round(lineup * 10) / 10,
    replacementUrgency: Math.round(urg * 10) / 10,
    confidence: Math.round(conf * 100),
    dataGaps: opts.dataGaps,
  }
}

function rowFromSportsRecord(
  r: SportsPlayerRecord,
  opts: { onRoster: boolean; isStarter: boolean; dataGaps: string[] },
): InjuryPlayerIntelRow {
  const bucket = bucketFromStatus(r.injuryStatus)
  let impact = baseScoreFromBucket(bucket)
  if (opts.isStarter) impact = clamp(impact + 10, 0, 100)
  return {
    playerKey: `${r.sport}:${r.id}`,
    name: r.name,
    position: r.position,
    team: r.team,
    sport: r.sport,
    statusRaw: r.injuryStatus ?? 'Unknown',
    severity: bucket,
    source: 'sports_player_record',
    sourceId: r.id,
    notes: r.injuryNotes ?? null,
    practice: null,
    gameStatus: null,
    reportDate: null,
    lastUpdated: r.lastUpdated.toISOString(),
    onRoster: opts.onRoster,
    isStarter: opts.isStarter,
    headshotUrl: r.headshotUrl ?? r.headshotUrlSm ?? null,
    impactScore: Math.round(impact * 10) / 10,
    lineupDisruption: Math.round(clamp(impact * 0.88, 0, 100) * 10) / 10,
    replacementUrgency: Math.round(clamp((baseScoreFromBucket(bucket) / 100) * (opts.isStarter ? 88 : 50), 0, 100) * 10) / 10,
    confidence: 52,
    dataGaps: [...opts.dataGaps, 'Practice/game designation from official report not in DB row — confirm closer to kickoff.'],
  }
}

export async function runInjuryImpactDashboard(input: InjuryImpactDashboardInput): Promise<InjuryImpactDashboardOutput> {
  const dataGaps: string[] = []
  const since = sinceForHorizon(input.timeHorizon)

  const sports: SupportedSport[] =
    input.sportFilter === 'ALL' ? [...SUPPORTED_SPORTS] : [normalizeToSupportedSport(input.sportFilter)]

  let leagueName: string | null = null
  let leagueSport: SupportedSport | null = null
  let analysisScope: 'league' | 'general' = 'general'
  let rosterIds: string[] = []
  const starterSet = new Set<string>()

  if (input.leagueId?.trim()) {
    const access = await assertLeagueMemberWithCode(input.leagueId.trim(), input.userId)
    if (!access.ok) {
      const code = access.code
      const userMessage = leagueToolAccessUserMessage(code)
      return {
        ok: false,
        code,
        error: userMessage,
        userMessage,
      }
    }
    const league = await prisma.league.findFirst({
      where: { id: input.leagueId.trim() },
      include: { teams: true },
    })
    if (!league) {
      const code: LeagueToolAccessErrorCode = 'LEAGUE_NOT_FOUND'
      const userMessage = leagueToolAccessUserMessage(code)
      return { ok: false, error: userMessage, code, userMessage }
    }
    leagueName = league.name
    leagueSport = normalizeToSupportedSport(String(league.sport))
    analysisScope = 'league'

    const rosters = await prisma.roster.findMany({ where: { leagueId: league.id } })
    const teams = league.teams

    const pickRosters = (): typeof rosters => {
      if (input.teamContext === 'neutral') return []
      if (input.teamContext === 'league_wide_risk' || input.teamContext === 'full_league') return rosters
      if (input.teamContext === 'my_team') {
        const lt = teams.find((t) => t.claimedByUserId === input.userId)
        if (!lt) {
          dataGaps.push('No team claimed for your account in this league — showing league-wide injury intelligence.')
          return rosters
        }
        const r = rosters.find(
          (x) => x.platformUserId === lt.platformUserId || x.platformUserId === lt.externalId,
        )
        return r ? [r] : []
      }
      const specificTeamId = input.specificTeamExternalId?.trim()
      if (input.teamContext === 'specific_team' && specificTeamId) {
        const lt = teams.find((t) => t.externalId === specificTeamId)
        if (!lt) {
          dataGaps.push('Specific team not found — falling back to full league rosters.')
          return rosters
        }
        const r = rosters.find(
          (x) => x.platformUserId === lt.platformUserId || x.platformUserId === lt.externalId,
        )
        return r ? [r] : []
      }
      const opponentTeamId = input.opponentTeamExternalId?.trim()
      if (input.teamContext === 'opponent_team' && opponentTeamId) {
        const lt = teams.find((t) => t.externalId === opponentTeamId)
        if (!lt) {
          dataGaps.push('Opponent team not resolved — falling back to full league.')
          return rosters
        }
        const r = rosters.find(
          (x) => x.platformUserId === lt.platformUserId || x.platformUserId === lt.externalId,
        )
        return r ? [r] : []
      }
      return rosters
    }

    const picked = pickRosters()

    for (const r of picked) {
      const ids = getRosterPlayerIds(r.playerData)
      rosterIds.push(...ids)
      for (const sid of getStarterIds(r.playerData)) starterSet.add(sid)
    }
    rosterIds = [...new Set(rosterIds)]

    if (input.sportFilter !== 'ALL' && input.sportFilter.toUpperCase() !== String(league.sport).toUpperCase()) {
      dataGaps.push('Sport filter does not match league sport — injury rows are still filtered by the sport filter for cross-checks.')
    }
  } else {
    dataGaps.push('No league selected — analysis is general (sport feed + player records), not tied to your roster.')
  }

  const sportWhere = { in: sports as unknown as string[] }

  // Canonical injury read port (sport-scoped, so one call per sport):
  // TTL-respected, ONE row per player, freshest source wins. The horizon
  // window is preserved via maxAgeHours; facts are re-shaped to the
  // InjuryReportRecord contract below, once the roster identity maps exist.
  const horizonMaxAgeHours = Math.max(1, Math.ceil((Date.now() - since.getTime()) / 3_600_000))
  const [factListsBySport, playerInjuries] = await Promise.all([
    Promise.all(
      sports.map(async (s) => ({
        sport: s,
        facts: await listInjuryFacts({ sport: s, maxAgeHours: horizonMaxAgeHours, limit: 120 })
          .then((l) => l.facts)
          .catch(() => []),
      })),
    ),
    prisma.sportsPlayerRecord.findMany({
      where: {
        sport: sportWhere,
        injuryStatus: { not: null },
        NOT: { injuryStatus: '' },
      },
      orderBy: { lastUpdated: 'desc' },
      take: 80,
    }),
  ])

  const rosterSet = new Set(rosterIds)
  const sportsPlayers = await prisma.sportsPlayer.findMany({
    where: {
      sport: sportWhere,
      OR: [{ sleeperId: { in: rosterIds } }, { externalId: { in: rosterIds } }],
    },
    select: { sleeperId: true, externalId: true, name: true, sport: true },
  })
  const nameByRosterId = new Map<string, string>()
  for (const sp of sportsPlayers) {
    if (sp.sleeperId) nameByRosterId.set(sp.sleeperId, sp.name)
    if (sp.externalId) nameByRosterId.set(sp.externalId, sp.name)
  }

  const rosterIdByName = new Map<string, string>()
  for (const sp of sportsPlayers) {
    const rid = sp.sleeperId ?? sp.externalId
    if (rid && !rosterIdByName.has(sp.name.toLowerCase())) rosterIdByName.set(sp.name.toLowerCase(), rid)
  }

  // Port facts re-shaped to the InjuryReportRecord contract the row builders
  // consume. `playerId` is recovered from the roster identity map by name where
  // possible so league-scoped roster/starter matching keeps working (the raw
  // injury_reports provider playerId never matched roster ids either — see
  // ADR_F2_3_INJURY_STATUS.md). Null-status facts ("no designation stated")
  // are dropped rather than coerced into a fake status.
  const injuryReports: InjuryReportRecord[] = factListsBySport.flatMap(({ sport: factSport, facts }) =>
    facts
      .filter((f) => typeof f.status === 'string' && f.status.trim())
      .map((f) => ({
        id: f.id,
        sport: factSport,
        playerId: rosterIdByName.get(f.playerName.trim().toLowerCase()) ?? '',
        playerName: f.playerName,
        team: f.team ?? '',
        status: typeof f.status === 'string' ? f.status : '',
        bodyPart: f.type,
        notes: f.description,
        practice: null,
        gameStatus: null,
        reportDate: f.fetchedAt,
        week: f.week,
        createdAt: f.fetchedAt,
      })),
  )

  const isOnRoster = (playerId: string, playerName: string): boolean => {
    if (rosterSet.size === 0) return false
    if (rosterSet.has(playerId)) return true
    const n = nameByRosterId.get(playerId)
    if (n && playerName && n.toLowerCase() === playerName.toLowerCase()) return true
    return false
  }

  const isStarter = (playerId: string): boolean => starterSet.has(playerId)

  const seen = new Set<string>()
  const rows: InjuryPlayerIntelRow[] = []

  const recordBySportName = new Map<string, SportsPlayerRecord>()
  for (const rec of playerInjuries) {
    recordBySportName.set(`${rec.sport}:${rec.name.toLowerCase()}`, rec)
  }

  const injByPlayer = new Map<string, InjuryReportRecord>()
  for (const r of injuryReports) {
    // Port rows may carry no roster-resolvable playerId — key by name then,
    // so distinct players never collapse onto the '' id.
    const k = `${r.sport}:${r.playerId || r.playerName.toLowerCase()}`
    if (!injByPlayer.has(k)) injByPlayer.set(k, r)
  }

  for (const r of injByPlayer.values()) {
    if (!sports.includes(r.sport as SupportedSport)) continue
    const b = bucketFromStatus(r.status)
    if (!statusFilterAllows(b, input.statusFilter)) continue
    const on = analysisScope === 'league' ? isOnRoster(r.playerId, r.playerName) : true
    if (
      analysisScope === 'league' &&
      input.teamContext !== 'league_wide_risk' &&
      input.teamContext !== 'full_league' &&
      input.teamContext !== 'neutral' &&
      !on
    ) {
      continue
    }
    if (analysisScope === 'league' && (input.teamContext === 'my_team' || input.teamContext === 'specific_team' || input.teamContext === 'opponent_team') && !on) {
      continue
    }

    const spRec = recordBySportName.get(`${r.sport}:${r.playerName.toLowerCase()}`) ?? null

    const row = rowFromInjuryReport(r, {
      onRoster: on,
      isStarter: isStarter(r.playerId),
      headshotUrl: spRec?.headshotUrl ?? spRec?.headshotUrlSm ?? null,
      dataGaps: [],
    })
    if (spRec?.position) {
      row.position = spRec.position
    }
    const key = row.playerKey
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(row)
  }

  for (const rec of playerInjuries) {
    if (!sports.includes(rec.sport as SupportedSport)) continue
    const b = bucketFromStatus(rec.injuryStatus)
    if (!statusFilterAllows(b, input.statusFilter)) continue
    const key = `${rec.sport}:${rec.id}`
    if (seen.has(key)) continue

    const on = analysisScope === 'league' ? rosterSet.has(rec.id) || isOnRoster(rec.id, rec.name) : true
    if (
      analysisScope === 'league' &&
      input.teamContext !== 'league_wide_risk' &&
      input.teamContext !== 'full_league' &&
      input.teamContext !== 'neutral' &&
      !on
    ) {
      continue
    }
    if (analysisScope === 'league' && (input.teamContext === 'my_team' || input.teamContext === 'specific_team' || input.teamContext === 'opponent_team') && !on) {
      continue
    }

    seen.add(key)
    rows.push(
      rowFromSportsRecord(rec, {
        onRoster: on,
        isStarter: isStarter(rec.id),
        dataGaps: [],
      }),
    )
  }

  rows.sort((a, b) => b.impactScore - a.impactScore)

  if (process.env.OPENWEATHERMAP_API_KEY?.trim()) {
    const nfl = rows.filter((r) => r.sport === 'NFL' && r.team?.trim())
    const teams = [...new Set(nfl.map((r) => r.team.trim().toUpperCase()))].slice(0, 14)
    const gt = defaultGameTimeForSport('NFL')
    const wxByTeam = new Map<string, import('@/lib/weather/weatherService').NormalizedWeather | null>()
    for (const t of teams) {
      try {
        wxByTeam.set(t, await fetchWeatherForTeamHomeWindow({ sport: 'NFL', teamAbbrev: t, gameTime: gt }))
      } catch {
        wxByTeam.set(t, null)
      }
    }
    for (const r of rows) {
      if (r.sport !== 'NFL' || !r.team?.trim()) continue
      const t = r.team.trim().toUpperCase()
      const w = wxByTeam.get(t) ?? null
      const aug = buildWeatherAugmentFromCachedWeather({
        sport: 'NFL',
        position: r.position,
        teamAbbrev: t,
        baselinePoints: 14,
        weather: w,
      })
      if (
        aug?.weatherRiskLevel &&
        (aug.weatherRiskLevel === 'moderate' ||
          aug.weatherRiskLevel === 'high' ||
          aug.weatherRiskLevel === 'extreme')
      ) {
        const line = aug.weatherSummary ?? aug.weatherImpactReason
        if (line) {
          r.notes = r.notes ? `${r.notes} · Game weather: ${line}` : `Game weather: ${line}`
        }
      }
    }
  }

  if (!input.toggles.includePractice) {
    dataGaps.push('Practice tags omitted from narrative weighting (toggle off).')
  }
  if (!input.toggles.includeNews) {
    dataGaps.push('News aggregation not merged in this response — use Injury brief + connected feeds.')
  }

  const summaryCounts = {
    outIr: rows.filter((x) => x.severity === 'out' || x.severity === 'ir').length,
    doubtful: rows.filter((x) => x.severity === 'doubtful').length,
    questionable: rows.filter((x) => x.severity === 'questionable' || x.severity === 'gtd').length,
    limited: rows.filter((x) => x.practice?.toLowerCase().includes('limited')).length,
    fullPractice: rows.filter((x) => x.practice?.toLowerCase().includes('full')).length,
  }

  const overallRisk =
    rows.length === 0 ? 12 : clamp(rows.reduce((s, x) => s + x.impactScore, 0) / rows.length, 8, 98)

  let injuryLeagueContext: NormalizedLeagueContext | null = null
  if (input.leagueId?.trim()) {
    const ir = await resolveNormalizedLeagueContext({
      userId: input.userId,
      leagueId: input.leagueId.trim(),
    })
    if (ir.ok) injuryLeagueContext = ir.context
  }

  const projectionByPlayer = await enrichInjuryRowsWithLeagueProjections({
    prisma,
    leagueScoring: injuryLeagueContext?.scoring,
    rows,
  })

  for (const row of rows) {
    const k = `${row.sport}:${row.name.toLowerCase()}`
    const sl = projectionByPlayer.get(k)
    if (sl) {
      row.effectiveProjection = sl.effectiveProjection
      row.projectionNotes = sl.projectionNotes
      row.injuryNewsSummary = sl.injuryNewsSummary
    }
    row.freshnessNote = formatInjuryFreshnessNote(row)
    row.confidence = computeInjuryConfidence(row)
    if (input.toggles.includeHandcuffs) {
      row.replacementHint = buildReplacementHint({
        sport: row.sport,
        position: row.position,
        severity: row.severity,
        isStarter: row.isStarter,
      })
    } else {
      row.replacementHint = null
    }
    if (input.toggles.includeReturnTimelines !== false) {
      row.returnTimeline = parseReturnTimeline(row.notes ?? row.gameStatus ?? row.statusRaw, row.severity)
    }
    if (row.onRoster && sl?.effectiveProjection != null && Number.isFinite(sl.effectiveProjection) && sl.effectiveProjection >= 10) {
      row.impactScore = clamp(row.impactScore + Math.min(10, Math.round(sl.effectiveProjection / 6)), 0, 100)
      row.lineupDisruption = clamp(row.lineupDisruption + 5, 0, 100)
    }
    if (
      input.toggles.includePlayoffImpact &&
      row.onRoster &&
      (input.timeHorizon === 'rest_of_season' || input.timeHorizon === 'playoff_window') &&
      (row.severity === 'out' || row.severity === 'ir' || row.severity === 'doubtful')
    ) {
      row.impactScore = clamp(row.impactScore + 6, 0, 100)
      row.replacementUrgency = clamp(row.replacementUrgency + 10, 0, 100)
    }
  }
  rows.sort((a, b) => b.impactScore - a.impactScore)

  if (input.toggles.includeWaiverReplacements && analysisScope === 'league' && input.leagueId?.trim()) {
    try {
      const { runWaiverIntelligenceAnalysis } = await import('@/lib/ai-tools-waiver/waiver-intelligence')
      const waiverRes = await runWaiverIntelligenceAnalysis({
        userId: input.userId,
        sportFilter: (leagueSport ? String(leagueSport).toUpperCase() : 'ALL') as SupportedSport | 'ALL',
        leagueId: input.leagueId.trim(),
        position: 'ALL',
        rookiesOnly: false,
        strategy: 'injury_replacement',
        teamContext: 'my_team',
        timeHorizon: 'this_week',
      })
      if (waiverRes.ok && waiverRes.analysisMode === 'league') {
        const picksByPosition = new Map<string, typeof waiverRes.picks>()
        for (const pk of waiverRes.picks) {
          const key = pk.position.toUpperCase()
          const bucket = picksByPosition.get(key) ?? []
          bucket.push(pk)
          picksByPosition.set(key, bucket)
        }
        for (const row of rows) {
          if (!row.onRoster) continue
          const severe =
            row.severity === 'out' ||
            row.severity === 'ir' ||
            row.severity === 'suspended' ||
            row.severity === 'doubtful'
          if (!severe) continue
          const bucket = picksByPosition.get(row.position.toUpperCase()) ?? []
          row.suggestedWaiverAdds = bucket.slice(0, 2).map((pk) => ({
            name: pk.name,
            position: pk.position,
            team: pk.team,
            faabPct: pk.faabPct,
            tier: pk.tier,
            why: pk.why.slice(0, 180),
            playerId: pk.recordId ?? pk.playerId,
          }))
        }
      }
    } catch (e) {
      dataGaps.push('Waiver replacement enrichment failed (non-fatal).')
    }
  }

  const waiverTradeImplications: string[] = []
  for (const p of rows.slice(0, 12)) {
    const k = `${p.sport}:${p.name.toLowerCase()}`
    const proj = projectionByPlayer.get(k)
    if (!p.onRoster) continue
    if (p.severity === 'out' || p.severity === 'ir') {
      waiverTradeImplications.push(
        `${p.name} (${p.position}): high-impact absence — check ${proj?.effectiveProjection != null ? `league-scored proj was ~${proj.effectiveProjection.toFixed(1)} when healthy; ` : ''}waiver wire for same-slot fill; trade only if buying wins this week.`,
      )
    } else if (p.severity === 'doubtful' || p.severity === 'questionable') {
      waiverTradeImplications.push(
        `${p.name}: monitor designation — ${proj?.injuryNewsSummary ?? 'confirm closer to lock; stash contingency if flex-eligible.'}`,
      )
    }
  }

  const hasAnyProjection = [...projectionByPlayer.values()].some(
    (v) => v.effectiveProjection != null && Number.isFinite(v.effectiveProjection as number),
  )
  const injuryNewsLayerReady = rows.some((r) => Boolean(r.injuryNewsSummary?.trim()))

  const analysisMode: 'league' | 'global' = analysisScope === 'league' ? 'league' : 'global'

  const summaryLine = [
    `${analysisMode === 'league' && leagueName ? `${leagueName}: ` : ''}Injury scan — ${rows.length} player${rows.length === 1 ? '' : 's'}; composite risk ${Math.round(overallRisk * 10) / 10}/100.`,
    hasAnyProjection
      ? 'League-scored projections merged where roster rows matched.'
      : 'No merged weekly projections — check league selection and scoring sync.',
    rosterIds.length > 0 ? `Roster-linked IDs: ${rosterIds.length}.` : 'No roster IDs — pick a league for roster-aware flags.',
  ].join(' ')

  const dataQuality: 'full' | 'partial' | 'degraded' =
    rows.length === 0
      ? 'degraded'
      : dataGaps.length > 5
        ? 'degraded'
        : dataGaps.length > 0 || (analysisScope === 'league' && !injuryLeagueContext) || !hasAnyProjection
          ? 'partial'
          : 'full'

  const severePositionsOnRoster = rows
    .filter((r) => r.onRoster && (r.severity === 'out' || r.severity === 'ir' || r.severity === 'doubtful' || r.severity === 'suspended'))
    .reduce<Record<string, number>>((acc, r) => {
      const k = r.position.toUpperCase()
      acc[k] = (acc[k] ?? 0) + 1
      return acc
    }, {})
  const severePositionEntries = Object.entries(severePositionsOnRoster)
  const positionBreakdown = severePositionEntries
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([pos, n]) => `${n}× ${pos}`)
    .join(', ')
  const waiverHint =
    severePositionEntries.length > 0
      ? `${severePositionEntries.reduce((n, [, c]) => n + c, 0)} injured starter${severePositionEntries.length === 1 && severePositionEntries[0][1] === 1 ? '' : 's'} need fills (${positionBreakdown}) — open Waiver Wire filtered to these positions.`
      : 'No severe on-roster injuries right now — monitor designations before lock.'

  const integrationHints: InjuryIntegrationHints = {
    startSit:
      'Use Start/Sit with the same league so projected starts align with these injury flags and scoring.',
    waiverWire: waiverHint,
    matchupPrep: 'Matchup Prep uses the same league for weekly opponent context and lineup pressure.',
    warRoom: 'AF War Room bundles injury intel with Start/Sit, waiver, and trade modules for one league.',
  }

  const FEED_STALE_HOURS = 48
  const latestFeedMs = injuryReports.reduce<number | null>((acc, r) => {
    const t = r.reportDate ? new Date(r.reportDate).getTime() : null
    if (t == null || !Number.isFinite(t)) return acc
    return acc == null || t > acc ? t : acc
  }, null)
  const staleHours = latestFeedMs != null ? Math.round((Date.now() - latestFeedMs) / 3_600_000) : null
  const feedFreshness: InjuryFeedFreshness = {
    latestReportDateIso: latestFeedMs != null ? new Date(latestFeedMs).toISOString() : null,
    staleHours,
    stale: staleHours != null && staleHours > FEED_STALE_HOURS,
    rowsSeen: injuryReports.length,
  }
  if (feedFreshness.stale) {
    dataGaps.push(
      `Injury feed is ${staleHours}h stale (latest report ${feedFreshness.latestReportDateIso ?? 'n/a'}). Recency-sensitive calls should verify with provider.`,
    )
  } else if (feedFreshness.latestReportDateIso == null) {
    dataGaps.push('No injury rows returned by the injury read port for this scope — relying on sports_players injuryStatus only.')
  }

  let aiEnvelope: AiToolPayloadEnvelope | null = null
  if (input.userId) {
    try {
      aiEnvelope = await buildAiToolPayload({
        userId: input.userId,
        tool: 'injury_impact',
        mode: analysisScope === 'league' && input.leagueId?.trim() ? 'league' : 'global',
        league:
          input.leagueId?.trim() && leagueName && leagueSport
            ? {
                leagueId: input.leagueId.trim(),
                leagueName,
                sport: String(leagueSport),
              }
            : null,
        data: {
          summaryCounts,
          overallRisk,
          summaryLine,
          dataQuality,
          integrationHints,
          scoringSummary: injuryLeagueContext
            ? {
                model: injuryLeagueContext.scoring.scoringModel,
                receptionFormat: injuryLeagueContext.scoring.labels.receptionFormat,
                superflex: injuryLeagueContext.scoring.labels.isSuperflex,
              }
            : null,
          matchupPeriod: injuryLeagueContext?.matchupPeriod ?? null,
          playoffContext: injuryLeagueContext?.playoff ?? null,
          waiverTradeImplications: waiverTradeImplications.slice(0, 10),
          projectionSlices: [...projectionByPlayer.entries()].slice(0, 24).map(([key, v]) => ({
            key,
            effectiveProjection: v.effectiveProjection,
            notes: v.projectionNotes.slice(0, 3),
            injuryNewsSummary: v.injuryNewsSummary,
          })),
          toggles: input.toggles,
        },
        enrichTimeFromLeagueId: input.leagueId?.trim() ?? null,
        includeTeamContext: true,
      })
    } catch {
      aiEnvelope = null
    }
  }

  const validation: InjuryImpactValidation = {
    leagueContextResolved: injuryLeagueContext != null,
    rosterContextAvailable: rosterIds.length > 0,
    projectionLayerReady: hasAnyProjection,
    injuryNewsLayerReady,
    timeContextPresent: Boolean(aiEnvelope?.time),
  }

  const chimmyCore: Record<string, unknown> = {
    tool: 'injury_impact',
    leagueContextEngine: injuryLeagueContext,
    analysisScope,
    analysisMode,
    leagueName,
    leagueSport,
    sportFilter: input.sportFilter,
    teamContext: input.teamContext,
    statusFilter: input.statusFilter,
    timeHorizon: input.timeHorizon,
    toggles: input.toggles,
    summaryCounts,
    overallRisk,
    projectionByPlayer: Object.fromEntries([...projectionByPlayer.entries()].slice(0, 32)),
    waiverTradeImplications: waiverTradeImplications.slice(0, 10),
    validation,
    summaryLine,
    dataQuality,
    integrationHints,
    timeContext: aiEnvelope?.time ?? null,
    players: rows.slice(0, 40).map((p) => {
      const k = `${p.sport}:${p.name.toLowerCase()}`
      const sl = projectionByPlayer.get(k)
      return {
        name: p.name,
        sport: p.sport,
        status: p.statusRaw,
        severity: p.severity,
        onRoster: p.onRoster,
        starter: p.isStarter,
        impactScore: p.impactScore,
        lineupDisruption: p.lineupDisruption,
        replacementUrgency: p.replacementUrgency,
        source: p.source,
        reportDate: p.reportDate,
        freshnessNote: p.freshnessNote ?? null,
        replacementHint: p.replacementHint ?? null,
        suggestedWaiverAdds: p.suggestedWaiverAdds ?? null,
        effectiveProjection: sl?.effectiveProjection ?? null,
        projectionNotes: sl?.projectionNotes ?? null,
        injuryNewsSummary: sl?.injuryNewsSummary ?? null,
      }
    }),
    dataGaps,
  }

  let chimmyPayload: Record<string, unknown> = chimmyCore
  if (aiEnvelope) {
    chimmyPayload = attachIntelligenceToChimmyPayload(chimmyPayload, aiEnvelope)
  }

  try {
    const bySport = new Map<SupportedSport, string[]>()
    for (const p of rows.slice(0, 32)) {
      const sp = normalizeToSupportedSport(String(p.sport ?? leagueSport ?? 'NFL'))
      const arr = bySport.get(sp) ?? []
      if (!arr.includes(p.name)) arr.push(p.name)
      bySport.set(sp, arr)
    }
    const groups = [...bySport.entries()].map(([sport, names]) => ({ sport, names: names.slice(0, 24) }))
    if (groups.length > 0) {
      chimmyPayload = await enrichChimmyWithPlayerSportsNorm({
        chimmyPayload,
        prisma,
        groups,
        leagueScoring: injuryLeagueContext?.scoring ?? null,
      })
    }
  } catch {
    /* non-fatal */
  }

  let aiNarrative: string | null = null
  if (!input.skipAi) {
    try {
      const res = await openaiChatText({
        messages: [
          {
            role: 'system',
            content:
              'You are Chimmy (AllFantasy). Summarize injury impact in 5–8 sentences. Use ONLY the JSON facts. Never invent players, injuries, or timelines. If data is thin, say so. No markdown.',
          },
          { role: 'user', content: JSON.stringify(chimmyPayload).slice(0, 12000) },
        ],
        temperature: 0.2,
        maxTokens: 520,
        skipCache: true,
      })
      if (res.ok) aiNarrative = res.text.trim() || null
    } catch {
      aiNarrative = null
    }
  }

  return {
    ok: true,
    analysisMode,
    analysisScope,
    leagueName,
    sportLabel: input.sportFilter === 'ALL' ? 'All sports' : input.sportFilter,
    leagueSport,
    overallRisk: Math.round(overallRisk * 10) / 10,
    summaryCounts,
    players: rows,
    aiNarrative,
    chimmyPayload,
    dataGaps,
    degraded: dataGaps.length > 0 || rows.length === 0,
    computedAt: new Date().toISOString(),
    timeContext: aiEnvelope?.time ?? null,
    validation,
    feedFreshness,
    summaryLine,
    dataQuality,
    integrationHints,
  }
}
