/**
 * C2C Chimmy AI — all exported functions call `requireAfSubUserIdOrThrow()` first (AfSub gate).
 */

import type { C2CPlayerState } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAfSubUserIdOrThrow } from '@/lib/redraft/ai/requireAfSub'
import { openaiChatJson, openaiChatText, parseJsonContentFromChatCompletion } from '@/lib/openai-client'
import { c2cScoreModeDescription } from '@/lib/c2c/c2cUiLabels'
import type { C2CConfigClient } from '@/lib/c2c/c2cUiLabels'

const CHIMMY_C2C = `You are Chimmy for AllFantasy Campus 2 Canton (C2C) dynasty leagues.
Leagues score BOTH college (campus) and pro (canton) sides. Label projections vs confirmed facts. Never invent statistics or player game lines.`

// ─── Types ─────────────────────────────────────────────────────────────

type C2CSetupRec = {
  scoringMode: string
  draftFormat: string
  reasonings: string[]
  warnings: string[]
}

export type CampusPlayerEval = {
  campusGrade: string
  cantonProjection: string
  startRec: string
  declarationRisk: string
  holdRecommendation: string
  verdict: string
}

type CampusRanking = {
  rank: number
  playerId: string
  name: string
  position: string
  note: string
}

type BreakoutAlert = {
  playerId: string
  name: string
  alertType: string
  reason: string
  urgency: 'low' | 'medium' | 'high'
}

export type RosterBalanceReport = {
  campusSideGrade: 'A' | 'B' | 'C' | 'D'
  cantonSideGrade: 'A' | 'B' | 'C' | 'D'
  balanceScore: number
  weakSide: 'campus' | 'canton' | 'balanced'
  pipelineHealth: string
  recommendations: string[]
}

type TransitionDecision = {
  recommendation: string
  timing: string
  targetCantonSlot: string
  campusValueLost: string
  cantonValueGained: string
  verdict: string
}

type C2CDraftAdvice = {
  topOptions: string[]
  recommendation: string
  tierBreakAlert: string
  reasoning: string
  sideBalance: string
}

type ChimmyResponse = { reply: string }

export async function buildC2CAiCacheContextSummary(input: {
  leagueId?: string
  managerId?: string
  playerId?: string
  week?: number | null
  draftType?: string | null
  pickNumber?: number | null
  position?: string | null
  sportPair?: string | null
  teamCount?: number | null
  experience?: string | null
}): Promise<Record<string, unknown>> {
  if (!input.leagueId) {
    return {
      scope: 'global',
      sportPair: input.sportPair ?? null,
      teamCount: input.teamCount ?? null,
      experience: input.experience ?? null,
    }
  }

  const leagueId = input.leagueId
  const [cfg, totalPlayers, campusPlayers, cantonPlayers, playerRow] = await Promise.all([
    prisma.c2CLeague.findUnique({
      where: { leagueId },
      select: {
        sportPair: true,
        scoringMode: true,
        campusScoreWeight: true,
        cantonScoreWeight: true,
        startupDraftFormat: true,
        futureDraftFormat: true,
        devyScoringEnabled: true,
      },
    }),
    prisma.c2CPlayerState.count({ where: { leagueId } }),
    prisma.c2CPlayerState.count({ where: { leagueId, playerSide: 'campus' } }),
    prisma.c2CPlayerState.count({ where: { leagueId, playerSide: 'canton' } }),
    input.playerId
      ? prisma.c2CPlayerState.findFirst({
          where: { leagueId, playerId: input.playerId },
          select: {
            playerId: true,
            playerSide: true,
            position: true,
            school: true,
            classYear: true,
            hasEnteredPro: true,
            projectedDeclarationYear: true,
            bucketState: true,
          },
        })
      : Promise.resolve(null),
  ])

  let managerSummary: Record<string, unknown> | null = null
  if (input.managerId) {
    const roster = await prisma.redraftRoster.findFirst({
      where: { leagueId, ownerId: input.managerId },
      select: { id: true },
    })
    if (roster?.id) {
      const [managerCampusCount, managerCantonCount] = await Promise.all([
        prisma.c2CPlayerState.count({
          where: { leagueId, rosterId: roster.id, playerSide: 'campus' },
        }),
        prisma.c2CPlayerState.count({
          where: { leagueId, rosterId: roster.id, playerSide: 'canton' },
        }),
      ])
      managerSummary = {
        rosterId: roster.id,
        campusCount: managerCampusCount,
        cantonCount: managerCantonCount,
      }
    } else {
      managerSummary = { rosterId: null }
    }
  }

  return {
    scope: 'league',
    leagueId,
    config: cfg ?? null,
    totalPlayers,
    campusPlayers,
    cantonPlayers,
    managerSummary,
    playerSummary: playerRow,
    actionContext: {
      week: input.week ?? null,
      draftType: input.draftType ?? null,
      pickNumber: input.pickNumber ?? null,
      position: input.position ?? null,
    },
  }
}

async function requireAfSub(): Promise<void> {
  await requireAfSubUserIdOrThrow()
}

async function loadC2CLeague(leagueId: string) {
  const row = await prisma.c2CLeague.findUnique({ where: { leagueId } })
  if (!row) throw new Error('C2C league not found')
  return row
}

function cfgToClient(cfg: Awaited<ReturnType<typeof loadC2CLeague>>): C2CConfigClient {
  return {
    sportPair: cfg.sportPair,
    scoringMode: cfg.scoringMode,
    campusScoreWeight: cfg.campusScoreWeight,
    cantonScoreWeight: cfg.cantonScoreWeight,
    devyScoringEnabled: cfg.devyScoringEnabled,
    futureDraftFormat: cfg.futureDraftFormat,
    startupDraftFormat: cfg.startupDraftFormat,
    campusStarterSlots: cfg.campusStarterSlots,
    cantonStarterSlots: cfg.cantonStarterSlots,
    benchSlots: cfg.benchSlots,
    taxiSlots: cfg.taxiSlots,
    devySlots: cfg.devySlots,
    irSlots: cfg.irSlots,
  }
}

// ─── Setup advisor ───────────────────────────────────────────────────────

export async function getC2CSetupRecommendation(
  sportPair: string,
  teamCount: number,
  managerExperience: string,
): Promise<C2CSetupRec> {
  await requireAfSub()

  const exp = managerExperience.toLowerCase()
  let scoringMode = 'combined_total'
  let draftFormat = 'combined_total'
  const reasonings: string[] = []
  const warnings: string[] = []

  if (exp.includes('new') || exp.includes('first')) {
    draftFormat = 'combined_total'
    scoringMode = 'combined_total'
    reasonings.push('New C2C leagues: combined draft keeps one board and reduces complexity.')
  } else if (exp.includes('experienced') || exp.includes('veteran')) {
    draftFormat = 'split_display_combined'
    scoringMode = 'split_display_combined'
    reasonings.push('Experienced managers often prefer split campus/canton drafts with combined scoring display.')
  }

  if (exp.includes('competitive') || teamCount >= 14) {
    scoringMode = 'weighted_combined'
    reasonings.push('Competitive large leagues: weighted_combined can balance campus vs canton impact.')
    warnings.push('Weighted modes need commissioner buy-in on campus/canton weights.')
  }

  const r = await openaiChatText({
    messages: [
      { role: 'system', content: CHIMMY_C2C },
      {
        role: 'user',
        content: `In 2 sentences, justify scoringMode=${scoringMode} and draftFormat=${draftFormat} for ${sportPair}, ${teamCount} teams, managers: ${managerExperience}. No fake stats.`,
      },
    ],
    maxTokens: 220,
    temperature: 0.35,
  })
  if (r.ok && r.text?.trim()) reasonings.push(r.text.trim())

  return { scoringMode, draftFormat, reasonings, warnings }
}

// ─── Campus scouting ───────────────────────────────────────────────────

export async function evaluateCampusPlayer(
  leagueId: string,
  _managerId: string,
  playerId: string,
): Promise<CampusPlayerEval> {
  await requireAfSub()

  const cfg = await loadC2CLeague(leagueId)
  const row = await prisma.c2CPlayerState.findFirst({
    where: { leagueId, playerId, playerSide: 'campus' },
  })
  const name = row?.playerName ?? playerId
  const pos = row?.position ?? '—'
  const school = row?.school ?? 'unknown'
  const classYear = row?.classYear ?? 'unknown'
  const sport = cfg.sportPair.includes('NBA') ? 'CBB' : 'CFB'

  const user = `Player: ${name}, ${pos}, ${school}, class ${classYear}. Sport context: ${sport}. League scoring mode: ${cfg.scoringMode}.
Return JSON only:
{"campusGrade":"letter + short note","cantonProjection":"text","startRec":"start|bench|stash","declarationRisk":"low|medium|high + reason","holdRecommendation":"text","verdict":"one paragraph"}`

  const o = await openaiChatJson({
    messages: [
      { role: 'system', content: CHIMMY_C2C + ' Respond with valid JSON only.' },
      { role: 'user', content: user },
    ],
    maxTokens: 700,
    temperature: 0.35,
  })
  const json = o.ok ? parseJsonContentFromChatCompletion(o.json) : null
  if (json && typeof json === 'object') {
    const j = json as Record<string, string>
    return {
      campusGrade: j.campusGrade ?? 'B — context-dependent',
      cantonProjection: j.cantonProjection ?? 'Unknown — confirm with film and draft capital.',
      startRec: j.startRec ?? 'bench',
      declarationRisk: j.declarationRisk ?? 'medium',
      holdRecommendation: j.holdRecommendation ?? 'Monitor workload and draft stock.',
      verdict: j.verdict ?? 'Insufficient data for a strong verdict.',
    }
  }

  return {
    campusGrade: 'B',
    cantonProjection: 'Projection unavailable — configure OpenAI for full eval.',
    startRec: 'bench',
    declarationRisk: 'medium — unknown declaration timeline',
    holdRecommendation: 'Hold until more games confirm role.',
    verdict: 'Chimmy could not reach the model — check OPENAI_API_KEY.',
  }
}

export async function getCampusRankings(
  leagueId: string,
  position?: string,
  _sportPair?: string,
): Promise<CampusRanking[]> {
  await requireAfSub()

  const campus = await prisma.c2CPlayerState.findMany({
    where: {
      leagueId,
      playerSide: 'campus',
      ...(position ? { position: { equals: position, mode: 'insensitive' as const } } : {}),
    },
    take: 40,
    orderBy: { playerName: 'asc' },
  })

  const list: CampusRanking[] = campus.slice(0, 30).map((p, i) => ({
    rank: i + 1,
    playerId: p.playerId,
    name: p.playerName,
    position: p.position,
    note: p.school ? `${p.school}${p.classYear ? ` · ${p.classYear}` : ''}` : 'Campus asset',
  }))

  if (list.length === 0) {
    return [{ rank: 1, playerId: '—', name: 'No campus players on file', position: '—', note: 'Add players to C2C roster' }]
  }
  return list
}

export async function getBreakoutCampusAlerts(leagueId: string): Promise<BreakoutAlert[]> {
  await requireAfSub()

  const campus = await prisma.c2CPlayerState.findMany({
    where: { leagueId, playerSide: 'campus' },
    take: 40,
  })

  const alerts: BreakoutAlert[] = []
  for (const p of campus) {
    if (p.projectedDeclarationYear && p.projectedDeclarationYear <= new Date().getFullYear() + 1) {
      alerts.push({
        playerId: p.playerId,
        name: p.playerName,
        alertType: 'declaration_timeline',
        reason: `Declaration window near (${p.projectedDeclarationYear}).`,
        urgency: 'medium',
      })
    }
  }
  if (alerts.length === 0 && campus.length > 0) {
    alerts.push({
      playerId: campus[0]!.playerId,
      name: campus[0]!.playerName,
      alertType: 'monitor',
      reason: 'No strong breakout flags in DB — track depth chart and transfers manually.',
      urgency: 'low',
    })
  }
  return alerts.slice(0, 12)
}

export async function getCantonRankings(leagueId: string, position?: string): Promise<CampusRanking[]> {
  await requireAfSub()

  const canton = await prisma.c2CPlayerState.findMany({
    where: {
      leagueId,
      playerSide: 'canton',
      ...(position ? { position: { equals: position, mode: 'insensitive' as const } } : {}),
    },
    take: 40,
    orderBy: { playerName: 'asc' },
  })

  const list: CampusRanking[] = canton.slice(0, 30).map((p, i) => ({
    rank: i + 1,
    playerId: p.playerId,
    name: p.playerName,
    position: p.position,
    note: p.nflNbaTeam ? `${p.nflNbaTeam}` : 'Pro roster',
  }))

  if (list.length === 0) {
    return [{ rank: 1, playerId: '—', name: 'No canton players on file', position: '—', note: 'Add NFL/NBA assets' }]
  }
  return list
}

export async function getTransitionWatchForManager(leagueId: string, userId: string): Promise<string> {
  await requireAfSub()

  const roster = await prisma.redraftRoster.findFirst({
    where: { leagueId, ownerId: userId },
    select: { id: true },
  })
  if (!roster) return 'No roster found for your account.'

  const campus = await prisma.c2CPlayerState.findMany({
    where: { leagueId, rosterId: roster.id, playerSide: 'campus', hasEnteredPro: false },
    take: 40,
  })

  const lines = campus
    .filter((p) => p.projectedDeclarationYear != null)
    .map(
      (p) =>
        `• ${p.playerName} (${p.position}) — declaration ~${p.projectedDeclarationYear}${p.school ? ` · ${p.school}` : ''}`,
    )

  if (lines.length === 0) return 'No declaration-year campus players flagged on your roster.'
  return `🔒 Transition watch (private)\n${lines.join('\n')}`
}

// ─── Roster balance ────────────────────────────────────────────────────

export async function getRosterBalanceAnalysis(leagueId: string, managerId: string): Promise<RosterBalanceReport> {
  await requireAfSub()

  const roster = await prisma.redraftRoster.findFirst({
    where: { leagueId, ownerId: managerId },
    select: { id: true },
  })
  if (!roster?.id) throw new Error('Roster not found for manager')

  const rows = await prisma.c2CPlayerState.findMany({ where: { leagueId, rosterId: roster.id } })
  const campusStarters = rows.filter((r) => r.bucketState === 'campus_starter').length
  const cantonStarters = rows.filter((r) => r.bucketState === 'canton_starter').length
  const campusCount = rows.filter((r) => r.playerSide === 'campus').length
  const cantonCount = rows.filter((r) => r.playerSide === 'canton').length

  let weakSide: 'campus' | 'canton' | 'balanced' = 'balanced'
  if (campusCount + 2 < cantonCount) weakSide = 'campus'
  else if (cantonCount + 2 < campusCount) weakSide = 'canton'

  const campusSideGrade: 'A' | 'B' | 'C' | 'D' =
    campusStarters >= 6 ? 'A' : campusStarters >= 4 ? 'B' : campusStarters >= 2 ? 'C' : 'D'
  const cantonSideGrade: 'A' | 'B' | 'C' | 'D' =
    cantonStarters >= 6 ? 'A' : cantonStarters >= 4 ? 'B' : cantonStarters >= 2 ? 'C' : 'D'

  const balanceScore = Math.min(
    100,
    Math.round(50 + (campusStarters - cantonStarters) * 3 + (campusCount - cantonCount)),
  )

  const recommendations: string[] = []
  if (weakSide === 'campus') {
    recommendations.push('Your canton side may be carrying — consider upgrading campus starters via trade or draft.')
  } else if (weakSide === 'canton') {
    recommendations.push('Campus-heavy roster — add pro floor pieces for canton starters.')
  } else {
    recommendations.push('Sides look reasonably balanced — maintain pipeline from taxi/devy to starters.')
  }

  return {
    campusSideGrade,
    cantonSideGrade,
    balanceScore,
    weakSide,
    pipelineHealth:
      rows.filter((r) => r.bucketState === 'taxi' || r.bucketState === 'devy').length > 2
        ? 'Healthy stash/taxi pipeline'
        : 'Thin pipeline — consider devy/taxi adds',
    recommendations,
  }
}

export async function getShouldITransitionAnalysis(
  leagueId: string,
  _managerId: string,
  playerId: string,
): Promise<TransitionDecision> {
  await requireAfSub()

  const row = await prisma.c2CPlayerState.findFirst({ where: { leagueId, playerId } })
  const name = row?.playerName ?? playerId

  const user = `Campus player ${name} may approach pro draft. JSON only:
{"recommendation":"hold|promote|sell","timing":"text","targetCantonSlot":"text","campusValueLost":"text","cantonValueGained":"text","verdict":"paragraph"}`

  const o = await openaiChatJson({
    messages: [
      { role: 'system', content: CHIMMY_C2C + ' JSON only.' },
      { role: 'user', content: user },
    ],
    maxTokens: 600,
    temperature: 0.35,
  })
  const json = o.ok ? parseJsonContentFromChatCompletion(o.json) : null
  if (json && typeof json === 'object') {
    const j = json as Record<string, string>
    return {
      recommendation: j.recommendation ?? 'hold',
      timing: j.timing ?? 'Re-evaluate after declaration',
      targetCantonSlot: j.targetCantonSlot ?? 'Flex / bench until role clarifies',
      campusValueLost: j.campusValueLost ?? 'Lose weekly campus scoring if promoted early',
      cantonValueGained: j.cantonValueGained ?? 'Pro upside when role locks',
      verdict: j.verdict ?? 'Monitor news cycle.',
    }
  }

  return {
    recommendation: 'hold',
    timing: 'After declaration and landing spot clarity',
    targetCantonSlot: 'Bench/taxi initially',
    campusValueLost: 'Campus lineup hole',
    cantonValueGained: 'Dynasty canton upside',
    verdict: 'Model unavailable — default to conservative hold.',
  }
}

// ─── Draft AI ──────────────────────────────────────────────────────────

export async function getDraftAdvice(
  leagueId: string,
  _managerId: string,
  draftType: string,
  pickNumber: number,
  currentRosterState: C2CPlayerState[],
): Promise<C2CDraftAdvice> {
  await requireAfSub()
  const cfg = await loadC2CLeague(leagueId)

  const summary = `League ${leagueId} draftType=${draftType} pick=${pickNumber} scoring=${cfg.scoringMode}. Roster snapshot: ${currentRosterState.length} C2C rows.`

  const o = await openaiChatJson({
    messages: [
      { role: 'system', content: CHIMMY_C2C + ' JSON: {topOptions:[3 strings],recommendation,tierBreakAlert,reasoning,sideBalance}' },
      { role: 'user', content: summary },
    ],
    maxTokens: 500,
    temperature: 0.4,
  })
  const json = o.ok ? parseJsonContentFromChatCompletion(o.json) : null
  if (json && typeof json === 'object') {
    const j = json as Record<string, unknown>
    const top = j.topOptions
    return {
      topOptions: Array.isArray(top) ? top.slice(0, 3).map(String) : ['Campus ceiling piece', 'Canton floor vet', 'Transition upside stash'],
      recommendation: String(j.recommendation ?? 'Balance campus and canton'),
      tierBreakAlert: String(j.tierBreakAlert ?? 'Watch for run on campus QBs in CFB leagues.'),
      reasoning: String(j.reasoning ?? ''),
      sideBalance: String(j.sideBalance ?? 'Target weaker side of your roster construction.'),
    }
  }

  return {
    topOptions: ['Best player available (campus or canton)', 'Fill weaker side', 'Future transition value'],
    recommendation: 'At this pick, lean toward the side that improves your combined_total weakest starters.',
    tierBreakAlert: 'Tier breaks vary by draft board wiring.',
    reasoning: 'OpenAI unavailable — using heuristic.',
    sideBalance: `Campus weight ${cfg.campusScoreWeight} / canton ${cfg.cantonScoreWeight}`,
  }
}

// ─── Commissioner copilot ──────────────────────────────────────────────

export async function handleC2CCommissionerQuery(leagueId: string, message: string): Promise<ChimmyResponse> {
  await requireAfSub()
  const cfg = await loadC2CLeague(leagueId)
  const client = cfgToClient(cfg)

  const r = await openaiChatText({
    messages: [
      {
        role: 'system',
        content: `${CHIMMY_C2C} League config: sportPair=${cfg.sportPair}, scoringMode=${client.scoringMode}, taxi=${cfg.taxiSlots}, devy=${cfg.devySlots}, devyScoring=${cfg.devyScoringEnabled}, startup=${cfg.startupDraftFormat}, future=${cfg.futureDraftFormat}. Never reveal private chats.`,
      },
      { role: 'user', content: `Commissioner asked: ${message}` },
    ],
    maxTokens: 900,
    temperature: 0.35,
  })

  return { reply: r.ok && r.text?.trim() ? r.text.trim() : 'Chimmy could not generate a reply. Check AI configuration.' }
}

export async function generateC2CConstitution(leagueId: string): Promise<string> {
  await requireAfSub()
  const cfg = await loadC2CLeague(leagueId)
  const client = cfgToClient(cfg)

  const r = await openaiChatText({
    messages: [
      {
        role: 'system',
        content: CHIMMY_C2C + ' Produce a concise league constitution markdown: roster rules per side, scoring explanation, devy/taxi, drafts, transitions.',
      },
      {
        role: 'user',
        content: `Generate constitution for C2C league. Config: ${JSON.stringify(client)}`,
      },
    ],
    maxTokens: 1200,
    temperature: 0.3,
  })

  return r.ok && r.text?.trim()
    ? r.text.trim()
    : `# C2C Constitution (draft)\n- Scoring: ${c2cScoreModeDescription(client)}\n- Startup: ${cfg.startupDraftFormat}\n- Future: ${cfg.futureDraftFormat}`
}

export async function generateWeeklyC2CRecap(leagueId: string, week: number): Promise<string> {
  await requireAfSub()
  if (!Number.isInteger(week) || week < 1) return 'Choose a valid week to view the recap.'
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { season: true } })
  if (league?.season == null) return 'The league season is not available yet.'
  const season = await prisma.redraftSeason.findUnique({ where: { leagueId_season: { leagueId, season: league.season } }, select: { id: true } })
  if (!season) return 'The league season is not available yet.'
  const games = await prisma.redraftMatchup.findMany({
    where: { seasonId: season.id, week, isMedianMatchup: false },
    select: { status: true, homeScore: true, awayScore: true, homeRoster: { select: { teamName: true, ownerName: true } }, awayRoster: { select: { teamName: true, ownerName: true } } },
  })
  if (!games.length || games.some((game) => game.status !== 'final')) return `Week ${week} results are not final yet. The recap will be available once scoring is complete.`
  const name = (roster: { teamName: string | null; ownerName: string }) => roster.teamName?.trim() || roster.ownerName.trim() || 'Open team'
  const results = games.filter((game) => game.awayRoster).map((game) => `${name(game.homeRoster)} ${game.homeScore.toFixed(2)} – ${game.awayScore.toFixed(2)} ${name(game.awayRoster!)}`)
  if (!results.length) return `No head-to-head results are available for week ${week}.`
  return [`Week ${week} results (${league.season})`, ...results, 'Player and campus/canton breakdowns are not included in this recap.'].join('\n')
}

export function getC2CChimmyHelpText(): string {
  return [
    '🤖 **C2C @chimmy commands**',
    '• `@chimmy c2c rules` — C2C rules overview',
    '• `@chimmy scoring mode` — campus vs canton scoring',
    '• `@chimmy taxi rules` — taxi eligibility',
    '• `@chimmy devy rules` — devy stash behavior',
    '• `@chimmy draft format` — startup/future drafts',
    '• `@chimmy evaluate prospect <name>` — AfSub',
    '• `@chimmy campus rankings [pos?]` — AfSub',
    '• `@chimmy pro rankings [pos?]` — AfSub (canton)',
    '• `@chimmy transition watch` — AfSub (private)',
    '• `@chimmy help` — this list',
  ].join('\n')
}
