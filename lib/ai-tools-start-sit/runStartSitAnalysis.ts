import { findRosterForTeam } from '@/lib/leagues/rosterForTeam'
import { buildNameIndex } from '@/lib/player-identity/nameIndex'
import 'server-only'

import type { LeagueSport, SportsPlayerRecord } from '@prisma/client'
import type { LeagueToolAccessErrorCode } from '@/lib/ai-tools/league-tool-context-types'
import { leagueToolAccessUserMessage } from '@/lib/ai-tools/league-tool-access-messages'
import type {
  StartSitAnalyzeError,
  StartSitAnalyzeResult,
  StartSitAnalysisMode,
  StartSitMode,
  StartSitPlayerRow,
  StartSitRec,
  StartSitSourceFlags,
  StartSitStructuredDecision,
  StartSitValidationSnapshot,
} from '@/lib/ai-tools-start-sit/types'
export type {
  StartSitAnalyzeError,
  StartSitAnalyzeResult,
  StartSitAnalysisMode,
  StartSitMode,
  StartSitPlayerRow,
  StartSitRec,
  StartSitSourceFlags,
  StartSitStructuredDecision,
  StartSitValidationSnapshot,
} from '@/lib/ai-tools-start-sit/types'
import { prisma } from '@/lib/prisma'
import { leagueWantsLongHorizon, resolveNormalizedLeagueContext } from '@/lib/league-context-engine'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { loadLeagueForTrade } from '@/lib/trade-value-console/league-loader'
import { snapshotFromLoaded } from '@/lib/trade-value-console/quick-badges'
import { normalizeToSupportedSport, SUPPORTED_SPORTS, type SupportedSport } from '@/lib/sport-scope'
import { getPlayerNews } from '@/lib/data/players'
import { attachIntelligenceToChimmyPayload, buildAiToolPayload } from '@/lib/intelligence'
import {
  attachSportsNormalizationToChimmyPayload,
  resolveNormalizedPlayerSportsProfiles,
} from '@/lib/sports-data-normalization'
import type { NormalizedPlayerSportsProfile } from '@/lib/sports-data-normalization/types'
import { collectProjectionNotes, effectiveFantasyPoints } from '@/lib/projection-engine'
import { analyzeStarterSlots, lineupBehaviorNote } from '@/lib/ai-tools-start-sit/lineupSlots'
import { fetchNativeOpponentMatchup, fetchSleeperMatchupContext } from '@/lib/ai-tools-start-sit/opponentMatchup'
import { runStartSitGlobalAnalysis } from '@/lib/ai-tools-start-sit/runStartSitGlobalAnalysis'
import { formatStartSitLockStatusLabel } from '@/lib/ai-tools-start-sit/startSitTimeLabels'
import { buildUnresolvedLineupDecisions } from '@/lib/ai-tools-start-sit/startSitUnresolved'
import type { AiTimeContextPayload } from '@/lib/time-engine/types'

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function recentFpgFromStats(stats: unknown): number | null {
  if (!stats || typeof stats !== 'object' || Array.isArray(stats)) return null
  const o = stats as Record<string, unknown>
  for (const k of ['fantasyPointsPerGame', 'fppg', 'avgPoints', 'avg_fp']) {
    const v = o[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return null
}

function volFromInjury(status: string | null | undefined): number {
  if (!status) return 0.22
  const s = status.toLowerCase()
  if (s.includes('out') || s.includes('ir')) return 0.45
  if (s.includes('doubt')) return 0.4
  if (s.includes('quest')) return 0.32
  if (s.includes('prob')) return 0.26
  return 0.24
}


async function resolveRecord(sport: string, rawId: string): Promise<SportsPlayerRecord | null> {
  const direct = await prisma.sportsPlayerRecord.findUnique({ where: { id: rawId } })
  if (direct) return direct
  const sp = await prisma.sportsPlayer.findFirst({
    where: { sport, OR: [{ externalId: rawId }, { sleeperId: rawId }, { id: rawId }] },
    select: { name: true },
  })
  if (!sp) return null
  return prisma.sportsPlayerRecord.findFirst({
    where: { sport, name: { equals: sp.name, mode: 'insensitive' } },
  })
}

function maxPeriodForSport(sport: SupportedSport): number {
  switch (sport) {
    case 'NFL':
    case 'NCAAF':
      return 18
    case 'NBA':
    case 'NCAAB':
      return 28
    case 'MLB':
      return 32
    case 'NHL':
      return 30
    case 'SOCCER':
      return 40
    default:
      return 24
  }
}

function resolveWeekParam(week: string, currentPeriod: number, sport: SupportedSport): number {
  const max = maxPeriodForSport(sport)
  if (week === 'current') return Math.min(max, Math.max(1, currentPeriod))
  if (week === 'next') return Math.min(max, currentPeriod + 1)
  const n = Number(week)
  if (Number.isFinite(n) && n >= 1) return Math.min(max, n)
  return Math.min(max, Math.max(1, currentPeriod))
}

function pickRec(p: StartSitPlayerRow, reason: string, confidence: number): StartSitRec {
  return { player: p, reason, confidence: Math.round(clamp(confidence, 0, 100)) }
}

export async function runStartSitAnalysis(input: {
  userId: string
  sportFilter: SupportedSport | 'ALL'
  leagueId: string | null
  week: string
  mode: StartSitMode
  teamExternalId: string | null
}): Promise<StartSitAnalyzeResult | StartSitAnalyzeError> {
  const dataGaps: string[] = []
  const now = new Date().toISOString()

  const trimmedLeagueId = input.leagueId?.trim() ?? ''
  if (!trimmedLeagueId) {
    if (input.sportFilter === 'ALL') {
      return {
        ok: false,
        error: 'Select a sport for global Start/Sit, or choose a league for roster-aware analysis.',
        code: 'VALIDATION',
        userMessage: 'Pick a sport (global mode) or select a league.',
      }
    }
    const sp = normalizeToSupportedSport(input.sportFilter)
    if (!SUPPORTED_SPORTS.includes(sp)) {
      return {
        ok: false,
        error: 'Unsupported sport for Start/Sit.',
        code: 'VALIDATION',
        userMessage: 'Choose a supported sport.',
      }
    }
    return runStartSitGlobalAnalysis({
      userId: input.userId,
      sport: sp,
      week: input.week,
      mode: input.mode,
    })
  }

  const engine = await resolveNormalizedLeagueContext({
    userId: input.userId,
    leagueId: trimmedLeagueId,
    preferredTeamExternalId: input.teamExternalId ?? undefined,
  })
  if (!engine.ok) {
    const code = engine.code
    const msg = leagueToolAccessUserMessage(code)
    return { ok: false, error: msg, code, userMessage: msg }
  }
  const leagueCtx = engine.context

  const tradeLeague = await loadLeagueForTrade({
    leagueId: trimmedLeagueId,
    userId: input.userId,
    membershipPreverified: true,
  })
  if (!tradeLeague) {
    const code: LeagueToolAccessErrorCode = 'LEAGUE_NOT_FOUND'
    const msg = leagueToolAccessUserMessage(code)
    return { ok: false, error: msg, code, userMessage: msg }
  }

  const sport = normalizeToSupportedSport(String(tradeLeague.sport))
  if (!SUPPORTED_SPORTS.includes(sport)) {
    dataGaps.push(`Sport ${sport} is outside the standard seven-sport scope — projections may be limited.`)
  }
  if (input.sportFilter !== 'ALL' && normalizeToSupportedSport(input.sportFilter) !== sport) {
    return {
      ok: false,
      error: 'Selected sport does not match this league.',
      code: 'SPORT_MISMATCH',
      userMessage: 'Selected sport does not match this league.',
    }
  }

  const leagueSnapshot = snapshotFromLoaded(tradeLeague)
  const currentPeriod = leagueCtx.matchupPeriod.currentPeriod
  const weekNum = resolveWeekParam(input.week, currentPeriod, sport)
  const weekLabel =
    sport === 'NFL' || sport === 'NCAAF'
      ? `Week ${weekNum}`
      : `${sport} period ${weekNum}`

  const leagueRow = await prisma.league.findFirst({
    where: { id: trimmedLeagueId },
    select: {
      id: true,
      name: true,
      platform: true,
      platformLeagueId: true,
      settings: true,
      scoring: true,
      sport: true,
    },
  })

  let roster = await prisma.roster.findFirst({
    where: { leagueId: trimmedLeagueId, platformUserId: input.userId },
    select: { playerData: true, platformUserId: true },
  })

  if (input.teamExternalId) {
    const lt = await prisma.leagueTeam.findFirst({
      where: { leagueId: trimmedLeagueId, externalId: input.teamExternalId },
      select: { platformUserId: true },
    })
    if (lt?.platformUserId) {
      /* Contract-aware: Roster.platformUserId holds the AF id for a LINKED
         manager, so keying on the team's raw Sleeper id misses exactly the
         opponents who have accounts. See lib/leagues/rosterForTeam.ts. */
      const found = await findRosterForTeam(trimmedLeagueId, lt.platformUserId)
      const r2 = found
        ? { playerData: found.playerData as any, platformUserId: lt.platformUserId }
        : null
      if (r2) roster = r2
    }
  }

  if (!roster) {
    const code: LeagueToolAccessErrorCode = 'TEAM_CONTEXT_UNAVAILABLE'
    const msg = 'No roster found for this team in AllFantasy.'
    return { ok: false, error: msg, code, userMessage: msg }
  }

  const ids = getRosterPlayerIds(roster.playerData).slice(0, 60)
  if (ids.length === 0) {
    dataGaps.push('Roster has no player IDs synced yet.')
  }

  let leagueTeamSelf = await prisma.leagueTeam.findFirst({
    where: { leagueId: trimmedLeagueId, claimedByUserId: input.userId },
    select: {
      id: true,
      teamName: true,
      wins: true,
      losses: true,
      ties: true,
      pointsFor: true,
      currentRank: true,
    },
  })
  if (input.teamExternalId) {
    const lt = await prisma.leagueTeam.findFirst({
      where: { leagueId: trimmedLeagueId, externalId: input.teamExternalId },
      select: {
        id: true,
        teamName: true,
        wins: true,
        losses: true,
        ties: true,
        pointsFor: true,
        currentRank: true,
      },
    })
    if (lt) leagueTeamSelf = lt
  }

  const pending: Array<{ rawId: string; row: SportsPlayerRecord }> = []
  for (const rawId of ids) {
    const row = await resolveRecord(sport, rawId)
    if (!row) {
      dataGaps.push(`No sports_players row for roster id ${String(rawId).slice(0, 10)}…`)
      continue
    }
    pending.push({ rawId, row })
  }

  let sportsNormBatch: Awaited<ReturnType<typeof resolveNormalizedPlayerSportsProfiles>> | null = null
  if (pending.length > 0) {
    try {
      sportsNormBatch = await resolveNormalizedPlayerSportsProfiles({
        prisma,
        sport,
        players: pending.map((p) => ({
          name: p.row.name,
          rosterPlayerId: p.rawId,
          sportsPlayerRow: {
            name: p.row.name,
            position: p.row.position,
            team: p.row.team,
            injuryStatus: p.row.injuryStatus,
            projections: p.row.projections,
            stats: p.row.stats,
            externalId: p.row.id,
          },
        })),
        leagueScoring: leagueCtx.scoring,
      })
      dataGaps.push(...sportsNormBatch.batchDataGaps)
    } catch (e) {
      console.warn('[start-sit] sports normalization batch failed', e)
      dataGaps.push('Sports data normalization layer failed for this roster (non-fatal).')
    }
  }

  const byNormName = new Map<string, NormalizedPlayerSportsProfile>(
    (sportsNormBatch?.players ?? []).map((p) => [p.player.name.toLowerCase(), p]),
  )

  const players: StartSitPlayerRow[] = []
  for (const { rawId, row } of pending) {
    const prof = byNormName.get(row.name.toLowerCase())
    const displayProj = effectiveFantasyPoints(prof) ?? null
    const wxAdj = prof?.projection.weatherAdjustedProjection ?? null
    const injAdj = prof?.projection.injuryNews?.adjustedPoints ?? null
    const scoreAdj = prof?.projection.scoringRuleAdjustedProjection ?? null
    const schedAdj = prof?.projection.scheduleAdjustedProjection ?? null
    const trendAdj = prof?.projection.recentTrendAdjustedProjection ?? null
    const floor = prof?.projection.projectedFantasyPointsRange.low ?? null
    const ceiling = prof?.projection.projectedFantasyPointsRange.high ?? null
    const vol = volFromInjury(row.injuryStatus)
    const floorFallback =
      floor ??
      (displayProj != null ? roundToTenth(displayProj * (1 - 0.35 * vol)) : null)
    const ceilingFallback =
      ceiling ??
      (displayProj != null ? roundToTenth(displayProj * (1 + 0.45 * vol)) : null)

    const notes = collectProjectionNotes(prof)
    const injSummary = prof?.injuryNewsLayer?.playerNewsSummary ?? prof?.injuryNewsLayer?.sources?.[0]?.detail ?? null

    players.push({
      playerId: rawId,
      recordId: row.id,
      name: row.name,
      position: row.position,
      team: row.team,
      projectedPoints: displayProj != null ? roundToTenth(displayProj) : null,
      floor: floor ?? floorFallback,
      ceiling: ceiling ?? ceilingFallback,
      recentFantasyAvg:
        prof?.actualPerformance?.fantasyPointsPerGame ?? recentFpgFromStats(row.stats),
      injuryStatus: row.injuryStatus,
      rollingFppg: prof?.trendUsage?.rollingFppg ?? prof?.actualPerformance?.fantasyPointsPerGame ?? null,
      headshotUrl: row.headshotUrlLg ?? row.headshotUrlSm ?? row.headshotUrl,
      weatherAdjustedPoints: wxAdj != null ? roundToTenth(wxAdj) : null,
      weatherRiskLevel: prof?.projection.weatherRiskLevel ?? null,
      weatherSummary: prof?.projection.weatherSummary ?? null,
      injuryNewsAdjustedPoints: injAdj != null ? roundToTenth(injAdj) : null,
      scoringRuleAdjustedProjection: scoreAdj != null ? roundToTenth(scoreAdj) : null,
      scheduleAdjustedProjection: schedAdj != null ? roundToTenth(schedAdj) : null,
      matchupAdjustedProjection: trendAdj != null ? roundToTenth(trendAdj) : null,
      projectionConfidence: prof?.projection.projectionConfidence ?? null,
      injuryNewsFreshnessAt: prof?.injuryNewsLayer?.primarySourceAt ?? prof?.injury?.updatedAt ?? null,
      projectionNotes: notes,
      injuryNewsSummary: injSummary,
    })
  }

  const injuryNewsNotes: string[] = []
  for (const p of players.slice(0, 8)) {
    if (!p.recordId) continue
    try {
      const news = await getPlayerNews(p.recordId, 2)
      for (const n of news) {
        const line = `${p.name}: ${n.headline}`.slice(0, 200)
        if (!injuryNewsNotes.includes(line)) injuryNewsNotes.push(line)
      }
    } catch {
      /* skip */
    }
  }

  for (const p of players) {
    if (p.injuryStatus && /out|ir|doubt|quest/i.test(p.injuryStatus)) {
      injuryNewsNotes.unshift(`${p.name}: ${p.injuryStatus}`)
    }
  }

  const withProj = players.filter((p): p is StartSitPlayerRow & { projectedPoints: number } => p.projectedPoints != null)
  const sortable = [...withProj].sort((a, b) => b.projectedPoints - a.projectedPoints)
  const byFloor = [...players].filter((p) => p.floor != null).sort((a, b) => (b.floor ?? 0) - (a.floor ?? 0))
  const byCeil = [...players].filter((p) => p.ceiling != null).sort((a, b) => (b.ceiling ?? 0) - (a.ceiling ?? 0))

  const bestStart = sortable[0]
    ? pickRec(
        sortable[0],
        [
          sortable[0].weatherRiskLevel === 'high' || sortable[0].weatherRiskLevel === 'extreme'
            ? 'Weather-elevated risk on the top projection — verify forecast before lock.'
            : null,
          sortable[0].projectionNotes[0] ?? null,
          'Highest effective projection (injury → weather → scoring-adjusted → provider) for this period.',
        ]
          .filter(Boolean)
          .join(' '),
        72 + Math.min(20, sortable.length),
      )
    : null

  const bestStartName = sortable[0]?.name
  const sitPool = sortable
    .filter((p) => p.name !== bestStartName)
    .map((p) => {
      const floorVal = p.floor
      const ceilVal = p.ceiling
      const spread = floorVal != null && ceilVal != null ? ceilVal - floorVal : null
      const downside =
        floorVal != null
          ? floorVal
          : p.projectedPoints * (1 - 0.35 * volFromInjury(p.injuryStatus))
      return { p, downside, spread }
    })
    .sort((a, b) => {
      if (a.downside !== b.downside) return a.downside - b.downside
      return (b.spread ?? 0) - (a.spread ?? 0)
    })
  const sitPick = sitPool[0] ?? null
  const bestSit = sitPick
    ? pickRec(
        sitPick.p,
        sitPick.spread != null
          ? `Lowest floor (${sitPick.downside.toFixed(1)}) with ~${sitPick.spread.toFixed(1)} pt boom/bust spread — highest downside risk to bench.`
          : `Lowest modeled downside (${sitPick.downside.toFixed(1)}) — lean sit if you have alternatives.`,
        55,
      )
    : null

  const safest = byFloor[0]
    ? pickRec(byFloor[0], 'Highest modeled floor (range + injury volatility) for this period.', 68)
    : null
  const upside = byCeil[0]
    ? pickRec(byCeil[0], 'Highest modeled ceiling — boom/bust swing profile.', 62)
    : null

  const fallback = sortable.length >= 2 ? pickRec(sortable[1], 'Next-best projected option if the primary starter is inactive or game-script shifts.', 58) : null

  let primaryStart: StartSitRec | null = bestStart
  if (input.mode === 'safe' && safest) primaryStart = safest
  if (input.mode === 'upside' && upside) primaryStart = upside

  const recommendations = {
    bestStart: primaryStart,
    bestSit,
    safest,
    upside,
    floorOption: safest,
    fallback,
  }

  const matchupNotes: string[] = []
  let opponent: StartSitAnalyzeResult['opponent'] = null

  if (leagueRow?.platform === 'sleeper' && leagueRow.platformLeagueId) {
    let owner =
      (await prisma.userProfile.findUnique({ where: { userId: input.userId }, select: { sleeperUserId: true } }))
        ?.sleeperUserId?.trim() || input.userId
    if (input.teamExternalId) {
      const lt = await prisma.leagueTeam.findFirst({
        where: { leagueId: trimmedLeagueId, externalId: input.teamExternalId },
        select: { platformUserId: true },
      })
      if (lt?.platformUserId) owner = lt.platformUserId
    }
    const o = await fetchSleeperMatchupContext({
      platformLeagueId: leagueRow.platformLeagueId,
      week: weekNum,
      ownerSleeperId: owner,
      sport: String(sport),
    })
    opponent = { name: o.opponentName, notes: o.notes }
    matchupNotes.push(...o.notes)
  } else if (leagueTeamSelf?.id) {
    const nat = await fetchNativeOpponentMatchup({
      leagueId: trimmedLeagueId,
      teamId: leagueTeamSelf.id,
      season: leagueCtx.season,
      week: weekNum,
    })
    matchupNotes.push(...nat.notes)
    if (nat.matchupDifficultyNote) matchupNotes.push(nat.matchupDifficultyNote)
    opponent = { name: nat.opponentLabel, notes: matchupNotes }
  } else {
    matchupNotes.push('Opponent row: connect Sleeper import or native league sync for matchup context.')
    dataGaps.push('Team id unavailable for native matchup lookup.')
  }

  const leagueSport = (leagueRow?.sport ?? tradeLeague.sport) as LeagueSport
  let lineupSlotAnalysis: StartSitAnalyzeResult['lineupSlotAnalysis'] = []
  if (leagueSport) {
    const cand = players.map((p) => {
      const prof = byNormName.get(p.name.toLowerCase())
      return {
        playerId: p.playerId,
        name: p.name,
        position: p.position,
        effectiveProjection: p.projectedPoints,
        gameStartTime: prof?.upcomingGame?.startTime ?? null,
      }
    })
    const slotRes = await analyzeStarterSlots({
      leagueId: trimmedLeagueId,
      leagueSport,
      sport,
      players: cand,
    })
    dataGaps.push(...slotRes.dataGaps)
    lineupSlotAnalysis = slotRes.slots.map((s) => ({
      slotName: s.slotName,
      allowedPositions: s.allowedPositions,
      topCandidates: s.candidates.slice(0, 5).map((c) => c.name),
      canLateSwap: s.canLateSwap,
      topCandidateGameStart: s.topCandidateGameStart,
    }))
  }

  const scoringRuleParts: string[] = []
  const fmt = leagueCtx.scoring.labels.receptionFormat
  if (fmt && fmt !== 'unknown') {
    scoringRuleParts.push(`Reception format: ${fmt}${leagueCtx.scoring.labels.tePremiumExtra ? ` · TE+${leagueCtx.scoring.labels.tePremiumExtra}` : ''}.`)
  }
  if (leagueCtx.scoring.labels.isSuperflex) scoringRuleParts.push('Superflex: QB eligible in SF slot.')
  if (leagueCtx.scoring.labels.isTwoQB) scoringRuleParts.push('Two-QB format elevates QB replacement value.')
  if (leagueCtx.scoring.labels.idpSlotsPresent) scoringRuleParts.push('IDP slots present — defensive projections matter.')
  const scoringRuleNote = scoringRuleParts.length ? scoringRuleParts.join(' ') : null

  const weatherBits = players
    .map((p) => p.weatherSummary)
    .filter((x): x is string => Boolean(x))
    .slice(0, 3)
  const weatherNote = weatherBits.length ? weatherBits.join(' | ') : null

  const projCoverage = withProj.length / Math.max(1, players.length)
  const confidenceScore = Math.round(
    clamp(40 + projCoverage * 45 + (players.length > 5 ? 10 : 0) - dataGaps.length * 3, 15, 95),
  )

  const recordStr =
    leagueTeamSelf != null
      ? `${leagueTeamSelf.wins}-${leagueTeamSelf.losses}${leagueTeamSelf.ties ? `-${leagueTeamSelf.ties}` : ''}`
      : null

  const reasoning = {
    league: `Scoring model: ${leagueCtx.scoring.scoringModel}. PPR: ${leagueCtx.scoring.labels.receptionFormat}. ${tradeLeague.scoring ? `Scoring column: ${tradeLeague.scoring}.` : ''}`,
    team: leagueTeamSelf
      ? `${leagueTeamSelf.teamName ?? 'Your team'} — ${recordStr ?? 'record n/a'} · PF ${leagueTeamSelf.pointsFor?.toFixed(1) ?? '—'} · Rank ${leagueTeamSelf.currentRank ?? '—'}.`
      : 'Link your team in this league for full standings context.',
  }

  const leagueSettingsSnapshot: Record<string, unknown> = {
    leagueId: tradeLeague.id,
    leagueName: tradeLeague.name,
    sport: tradeLeague.sport,
    quickModeBadges: leagueSnapshot.quickModeBadges,
    leagueSize: tradeLeague.leagueSize,
    isDynasty: tradeLeague.isDynasty,
    isSuperFlex: leagueSnapshot.isSuperFlexHint,
    tePremium: leagueSnapshot.tePremiumHint,
    scoring: tradeLeague.scoring,
    settings: tradeLeague.settings,
    week: weekNum,
    weekLabel,
    normalizedScoring: leagueCtx.scoring,
    rosterRules: leagueCtx.roster,
    waiverRules: leagueCtx.waiver,
    playoffRules: leagueCtx.playoff,
    lineupBehavior: leagueCtx.lineupBehavior,
  }

  // Gate the long-horizon coaching snapshot to league formats where it's actionable —
  // dynasty / keeper / devy / contract-to-contract. Redraft and best-ball leagues don't
  // benefit from a 3-year outlook on a weekly start/sit call, and the analysis is expensive.
  const wantsLongHorizon = leagueWantsLongHorizon(leagueCtx)

  const aiEnvelope = await buildAiToolPayload({
    userId: input.userId,
    tool: 'start_sit',
    mode: 'league',
    league: {
      leagueId: trimmedLeagueId,
      leagueName: tradeLeague.name,
      sport: String(sport),
    },
    data: {},
    enrichTimeFromLeagueId: trimmedLeagueId,
    includeHealth: false,
    includeTeamContext: true,
    preferredTeamExternalId: input.teamExternalId ?? undefined,
    includeStrategicCoaching: wantsLongHorizon,
  })

  const lockTimeNote =
    [
      aiEnvelope.time.nextLockTimeUTC ? `Next lock (UTC): ${aiEnvelope.time.nextLockTimeUTC}` : null,
      aiEnvelope.time.waiversProcessAt ? `Waivers run (UTC): ${aiEnvelope.time.waiversProcessAt}` : null,
    ]
      .filter(Boolean)
      .join(' · ') || null

  const lineupBehaviorNoteText = lineupBehaviorNote(
    leagueCtx.flags.bestBallMode,
    leagueCtx.lineupBehavior.scoringPeriod,
  )

  const structuredDecision: StartSitStructuredDecision = {
    bestStart: {
      name: recommendations.bestStart?.player.name ?? '—',
      why: recommendations.bestStart?.reason ?? 'No projection-backed start available.',
      confidence: recommendations.bestStart?.confidence ?? 0,
    },
    safest: {
      name: recommendations.safest?.player.name ?? '—',
      why: recommendations.safest?.reason ?? 'Floor data unavailable.',
      confidence: recommendations.safest?.confidence ?? 0,
    },
    highestUpside: {
      name: recommendations.upside?.player.name ?? '—',
      why: recommendations.upside?.reason ?? 'Ceiling data unavailable.',
      confidence: recommendations.upside?.confidence ?? 0,
    },
    fallback: {
      name: recommendations.fallback?.player.name ?? '—',
      why: recommendations.fallback?.reason ?? 'No secondary option with projections.',
    },
    weatherNote,
    scoringRuleNote,
    lockTimeNote,
    lineupBehaviorNote: lineupBehaviorNoteText,
  }

  const chimmyPayloadBase = attachIntelligenceToChimmyPayload(
    {
      tool: 'start_sit',
      leagueContextEngine: leagueCtx,
      sport,
      leagueId: trimmedLeagueId,
      leagueName: tradeLeague.name,
      week: weekNum,
      mode: input.mode,
      afTimeContext: aiEnvelope.time,
      leagueSettingsSnapshot,
      teamContext: {
        teamName: leagueTeamSelf?.teamName,
        record: recordStr,
        rank: leagueTeamSelf?.currentRank,
        pointsFor: leagueTeamSelf?.pointsFor,
      },
      opponent,
      structuredDecision,
      lineupSlotAnalysis,
      recommendations: {
        bestStart: recommendations.bestStart?.player.name,
        bestSit: recommendations.bestSit?.player.name,
        safest: recommendations.safest?.player.name,
        upside: recommendations.upside?.player.name,
        floorOption: recommendations.floorOption?.player.name,
        fallback: recommendations.fallback?.player.name,
      },
      analysisMode: 'league' as const,
      validation: {
        leagueContextResolved: true,
        scoringRulesPresent: true,
        rosterLoaded: ids.length > 0,
        lineupTemplateResolved: lineupSlotAnalysis.length > 0,
        timeContextPresent: true,
        projectionBatchPresent: sportsNormBatch != null,
      },
      players: players.slice(0, 36).map((p) => ({
        name: p.name,
        position: p.position,
        team: p.team,
        proj: p.projectedPoints,
        injuryNewsAdj: p.injuryNewsAdjustedPoints,
        scoringAdj: p.scoringRuleAdjustedProjection,
        scheduleAdj: p.scheduleAdjustedProjection,
        matchupAdj: p.matchupAdjustedProjection,
        projConf: p.projectionConfidence,
        floor: p.floor,
        ceiling: p.ceiling,
        injury: p.injuryStatus,
        injuryNews: p.injuryNewsSummary,
        rollingFppg: p.rollingFppg,
        weather: p.weatherSummary,
        weatherRisk: p.weatherRiskLevel,
        projectionNotes: p.projectionNotes.slice(0, 4),
      })),
      matchupNotes,
      injuryNewsNotes: injuryNewsNotes.slice(0, 12),
      dataGaps,
      dataFreshness: now,
      standardAiPayload: aiEnvelope.standard,
    },
    aiEnvelope,
  )

  const chimmyPayload =
    sportsNormBatch != null
      ? attachSportsNormalizationToChimmyPayload(chimmyPayloadBase, sportsNormBatch)
      : chimmyPayloadBase

  /*
   * Refuses on a duplicate name rather than taking the last. Byron Murphy (CB MIN / DL SEA)
   * and Justin Jefferson (WR MIN / LB CLE) each sit on one production roster together, and
   * a start-sit answer about the wrong one is materially wrong.
   */
  const playersByNameLower = buildNameIndex(players, (p) => p.name.toLowerCase())
  const unresolvedDecisions = buildUnresolvedLineupDecisions({
    lineupSlotAnalysis,
    playersByNameLower,
    gapThreshold: 2.5,
    bestBallInformational: leagueCtx.flags.bestBallMode,
  })

  const validation: StartSitValidationSnapshot = {
    leagueContextResolved: true,
    scoringRulesPresent:
      Object.keys(leagueCtx.scoring.pointsByStat).length > 0 ||
      leagueCtx.scoring.scoringModel !== 'unknown',
    rosterLoaded: ids.length > 0,
    lineupTemplateResolved: lineupSlotAnalysis.length > 0,
    timeContextPresent: true,
    projectionBatchPresent: sportsNormBatch != null,
  }

  const strategicCoachingAttached =
    (aiEnvelope.standard as { strategicCoaching?: unknown } | undefined)?.strategicCoaching != null
  const sourceFlags: StartSitSourceFlags = {
    sportsDataReady: players.length > 0 && sportsNormBatch != null,
    injuryNewsLayerReady: players.some((p) => p.injuryNewsSummary),
    weatherLayerReady: players.some((p) => p.weatherSummary),
    leagueScoringApplied: true,
    aiEnvelopeReady: true,
    // null = not requested (redraft/best-ball/etc.), true = attached, false = requested but upstream failed.
    strategicCoachingReady: wantsLongHorizon ? strategicCoachingAttached : null,
  }

  let dataQuality: StartSitAnalyzeResult['dataQuality'] = 'full'
  if (dataGaps.length > 4 || projCoverage < 0.4) dataQuality = 'degraded'
  else if (dataGaps.length > 0 || projCoverage < 0.65) dataQuality = 'partial'

  const lockStatusLabel = formatStartSitLockStatusLabel(aiEnvelope.time)

  const summary = leagueCtx.flags.bestBallMode
    ? `Best ball: scoring is weekly optimal — lineup advice is informational only. ${weekLabel} · ${tradeLeague.name ?? 'League'}.`
    : `League-scored Start/Sit for ${weekLabel} · ${tradeLeague.name ?? 'League'}.${lockStatusLabel ? ` ${lockStatusLabel}` : ''}`

  let finalConfidence = confidenceScore
  if (leagueCtx.flags.bestBallMode) finalConfidence = Math.round(clamp(confidenceScore * 0.88, 10, 92))

  return {
    ok: true,
    analysisMode: 'league',
    sport,
    leagueId: trimmedLeagueId,
    teamId: leagueCtx.team?.teamId ?? null,
    leagueName: tradeLeague.name ?? 'League',
    week: weekNum,
    weekLabel,
    generalAnalysis: false,
    mode: input.mode,
    leagueSettingsSnapshot,
    teamContext: {
      teamName: leagueTeamSelf?.teamName ?? null,
      record: recordStr,
      rank: leagueTeamSelf?.currentRank ?? null,
      pointsFor: leagueTeamSelf?.pointsFor ?? null,
    },
    opponent,
    recommendations: {
      bestStart: recommendations.bestStart,
      bestSit: recommendations.bestSit,
      safest: recommendations.safest,
      upside: recommendations.upside,
      floorOption: recommendations.floorOption,
      fallback: recommendations.fallback,
    },
    structuredDecision,
    lineupSlotAnalysis,
    matchupNotes,
    injuryNewsNotes: injuryNewsNotes.slice(0, 15),
    reasoning,
    confidenceScore: finalConfidence,
    players,
    dataGaps,
    dataFreshness: now,
    chimmyPayload,
    timeContext: aiEnvelope.time,
    validation,
    sourceFlags,
    summary,
    unresolvedDecisions,
    bestBallInformational: leagueCtx.flags.bestBallMode,
    lockStatusLabel,
    dataQuality,
  }
}

function roundToTenth(n: number): number {
  return Math.round(n * 10) / 10
}
