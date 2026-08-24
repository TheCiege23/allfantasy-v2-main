/**
 * IDP Salary Cap + defensive evaluation AI — all async entry points call `requireAfSub()` first.
 * `scoreDefender` is pure (deterministic) for 10-pillar model.
 */

import type { IDPSalaryRecord } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAfSubUserIdOrThrow } from '@/lib/redraft/ai/requireAfSub'
import { isIdpLeague } from '@/lib/idp'
import { getTeamCapSummary } from '@/lib/idp/capEngine'
import { openaiChatText } from '@/lib/openai-client'
import { getIdpLeagueConfig } from '@/lib/idp/IDPLeagueConfig'
import type { IdpScoringPreset } from '@/lib/idp/types'
import { computeIdpFantasyPoints, getMergedScoringRulesForLeague } from '@/lib/idp/scoringEngine'
import { generateDeterministicWeeklyStatLine } from '@/lib/idp/statIngestionEngine'
import {
  buildIdpWaiverPool,
  parseIdpPlayers,
  type IdPlayerRow,
} from '@/lib/idp/ai/idpChimmy'

async function requireAfSub(): Promise<void> {
  await requireAfSubUserIdOrThrow()
}

const CHIMMY_CAP_RULE = `You are Chimmy, an AI assistant for a salary cap IDP fantasy football league on AllFantasy.
Use only the deterministic numbers provided. Never invent injuries, trades, or official snap counts.
Be concise and actionable.`

// ─── Types (evaluation model) ─────────────────────────────────────────────

export type DefenderArchetype =
  | 'tackle_heavy_lb'
  | 'edge_rusher'
  | 'coverage_cb'
  | 'box_safety'
  | 'interior_dl'
  | 'hybrid'

export type IDPPlayerProfile = {
  playerId: string
  name: string
  position: string
  team?: string
  age?: number
  defenderRole?: DefenderArchetype
  /** 0–1 depth chart certainty */
  depthChartPosition?: number
}

export type IDPWeeklyStats = {
  week: number
  idpPoints: number
  soloTackles: number
  assistedTackles: number
  sacks: number
  interceptions: number
  passDeflections: number
  forcedFumbles: number
  snapsPlayed?: number
}

export type IDPSalaryRecordLite = Pick<
  IDPSalaryRecord,
  | 'salary'
  | 'yearsRemaining'
  | 'contractStartYear'
  | 'contractYears'
  | 'status'
  | 'isFranchiseTagged'
  | 'cutPenaltyCurrent'
>

export type MatchupContext = {
  opponentRankVsPos: number
  /** 0–1 run-heavy game script likelihood */
  runHeavyLikelihood: number
  opposingStarInjuryFlag: boolean
}

/** Minimal scoring config for format weighting */
export type IDPScoringConfig = {
  preset: IdpScoringPreset | string
}

export type PillarBreakdown = { name: string; score: number; weight: number }

export type DefenderVerdict =
  | 'START'
  | 'SIT'
  | 'TRADE_HIGH'
  | 'BUY_LOW'
  | 'HOLD'
  | 'EXTEND'
  | 'CUT_AFTER_WEEK'
  | 'WATCHLIST'

export type DefenderEvaluation = {
  overallGrade: number
  weeklyStartGrade: number
  dynastyGrade: number
  salaryEfficiencyGrade: number
  contractValueGrade: number
  waiverPriorityScore: number
  tradeValueScore: number
  boomBustScore: number
  floorScore: number
  riskScore: number
  trendScore: number
  verdict: DefenderVerdict
  topReasons: string[]
  mainRisk: string
  confidence: 'high' | 'medium' | 'low'
  pillarBreakdown: PillarBreakdown[]
}

export type CapRecommendation = {
  action: string
  player?: string
  savingsOrCost: string
  reason: string
}

export type CapAdvice = {
  recommendations: CapRecommendation[]
  summary: string
}

export type ContractDecisionEval = {
  recommendation: string
  confidence: 'high' | 'medium' | 'low'
  reasoning: string[]
  risk: string
  verdict: string
  alternativeOptions: string
}

export type CapEfficiencyRow = {
  playerId: string
  playerName: string
  position: string
  salary: number
  ptsPerM: number
  weekPoints: number
}

export type CapEfficiencyRankings = {
  underpriced: CapEfficiencyRow[]
  overpriced: CapEfficiencyRow[]
  leagueAvgEfficiency: number
  positionAvgEfficiency: Record<string, number>
}

export type CapBurdenWarning = {
  year: number
  kind: 'high_usage' | 'dead_money'
  message: string
  detail: string
}

export type TradeTarget = {
  playerName: string
  position: string
  rosterHint: string
  salary: number
  efficiency: number
  note: string
}

export type TradeTargetList = {
  targets: TradeTarget[]
  summary: string
}

export type ContenderRebuildAnalysis = {
  mode: 'contender' | 'rebuilding' | 'middling'
  reasoning: string
  recommendedActions: string[]
}

export type DefenderRecap = {
  text: string
  week: number
}

const BASE_WEIGHTS = [
  { key: 'opportunity', w: 0.2 },
  { key: 'role', w: 0.15 },
  { key: 'production', w: 0.2 },
  { key: 'efficiency', w: 0.1 },
  { key: 'matchup', w: 0.15 },
  { key: 'stability', w: 0.08 },
  { key: 'salaryValue', w: 0.06 },
  { key: 'contractValue', w: 0.04 },
  { key: 'risk', w: 0.08 },
  { key: 'trend', w: 0.04 },
] as const

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

function inferArchetype(pos: string): DefenderArchetype {
  const u = pos.toUpperCase()
  if (u === 'LB') return 'tackle_heavy_lb'
  if (['DE', 'OLB'].includes(u)) return 'edge_rusher'
  if (u === 'CB') return 'coverage_cb'
  if (['S', 'SS', 'FS'].includes(u)) return 'box_safety'
  if (['DT', 'DL', 'NT'].includes(u)) return 'interior_dl'
  return 'hybrid'
}

function normalizeWeights(
  formatType: string,
  archetype: DefenderArchetype,
): Record<string, number> {
  const m: Record<string, number> = {}
  for (const { key, w } of BASE_WEIGHTS) m[key] = w
  const ft = formatType.toLowerCase()
  if (ft === 'tackle_heavy' || ft === 'tackle_heavy_heavy') {
    m.opportunity = m.opportunity! * 1.15
    m.production = m.production! * 1.15
    if (archetype === 'tackle_heavy_lb' || archetype === 'box_safety') m.role = m.role! * 1.1
  } else if (ft === 'big_play' || ft === 'big_play_heavy') {
    m.production = m.production! * 1.08
    m.efficiency = m.efficiency! * 1.12
    if (archetype === 'edge_rusher' || archetype === 'coverage_cb') m.role = m.role! * 1.08
  }
  const sum = Object.values(m).reduce((a, b) => a + b, 0)
  for (const k of Object.keys(m)) m[k] = m[k]! / sum
  return m
}

/**
 * 10-pillar weighted defender evaluation (0–100 grades).
 */
export function scoreDefender(
  profile: IDPPlayerProfile,
  stats: IDPWeeklyStats[],
  salary: IDPSalaryRecordLite,
  matchup: MatchupContext,
  leagueConfig: IDPScoringConfig,
  formatType: string,
): DefenderEvaluation {
  const archetype = profile.defenderRole ?? inferArchetype(profile.position)
  const weights = normalizeWeights(formatType, archetype)

  const snaps = stats.map((s) => s.snapsPlayed ?? 50 + (s.idpPoints % 15))
  const avgSnaps = snaps.length ? snaps.reduce((a, b) => a + b, 0) / snaps.length : 55
  const snapShare = clamp01(avgSnaps / 75)
  const snapTrend =
    stats.length >= 2
      ? clamp01((snaps[snaps.length - 1]! - snaps[0]!) / Math.max(1, snaps[0]!) + 0.5)
      : 0.65
  const depth = profile.depthChartPosition ?? 0.85

  const p1 = clamp01(snapShare * snapTrend * depth)

  const roleMap: Record<DefenderArchetype, number> = {
    tackle_heavy_lb: formatType.includes('tackle') ? 0.92 : 0.72,
    edge_rusher: formatType.includes('big') ? 0.88 : 0.7,
    coverage_cb: formatType.includes('tackle') ? 0.45 : 0.62,
    box_safety: formatType.includes('tackle') ? 0.85 : 0.68,
    interior_dl: 0.7,
    hybrid: 0.65,
  }
  const p2 = roleMap[archetype] ?? 0.65

  const pts = stats.map((s) => s.idpPoints)
  const avgPts = pts.length ? pts.reduce((a, b) => a + b, 0) / pts.length : 5
  const floor = pts.length ? Math.min(...pts) : avgPts
  const ceiling = pts.length ? Math.max(...pts) : avgPts
  const spread = ceiling - floor
  const p3 = clamp01((avgPts / 18) * (1 - Math.min(0.35, spread / 25)))

  const tack = stats.reduce((a, s) => a + s.soloTackles + s.assistedTackles, 0)
  const prSnap = tack / Math.max(1, avgSnaps * Math.max(1, stats.length))
  const sacks = stats.reduce((a, s) => a + s.sacks, 0)
  const tov = stats.reduce((a, s) => a + s.interceptions + s.forcedFumbles * 0.8, 0)
  const p4 = clamp01(0.45 * prSnap * 8 + 0.35 * Math.min(1, sacks / 3) + 0.2 * Math.min(1, tov / 2))

  const oppR = Math.min(32, Math.max(1, matchup.opponentRankVsPos))
  const p5 = clamp01(((33 - oppR) / 32) * 0.65 + matchup.runHeavyLikelihood * (archetype === 'tackle_heavy_lb' ? 0.35 : 0.15))

  const snapStd =
    pts.length > 1
      ? Math.sqrt(pts.reduce((s, x) => s + (x - avgPts) ** 2, 0) / pts.length)
      : 2
  const p6 = clamp01(1 - Math.min(1, snapStd / 12))

  const sal = Math.max(0.5, salary.salary)
  const p7 = clamp01((avgPts / sal) / 2.5)

  const yrs = Math.max(0, salary.yearsRemaining)
  const perfYrs = clamp01(avgPts / 15)
  const p8 = clamp01(0.5 * perfYrs + 0.5 * Math.min(1, yrs / 4))

  const age = profile.age ?? 26
  const injRisk = 0.1
  const ageRisk = age >= 30 ? 0.25 : age >= 28 ? 0.12 : 0.05
  const roleChange = archetype === 'coverage_cb' ? 0.08 : 0.04
  const p9 = clamp01(1 - injRisk - ageRisk - roleChange)

  const seasonAvg = avgPts
  const last2 = pts.slice(-2)
  const l2avg = last2.length ? last2.reduce((a, b) => a + b, 0) / last2.length : seasonAvg
  const p10 = clamp01(0.5 + (l2avg - seasonAvg) / 20)

  const pillars: Record<string, number> = {
    opportunity: p1,
    role: p2,
    production: p3,
    efficiency: p4,
    matchup: p5,
    stability: p6,
    salaryValue: p7,
    contractValue: p8,
    risk: p9,
    trend: p10,
  }

  let overall = 0
  const pillarBreakdown: PillarBreakdown[] = []
  for (const { key, w } of BASE_WEIGHTS) {
    const ww = weights[key] ?? w
    const sc = (pillars[key] ?? 0) * 100
    overall += (pillars[key] ?? 0) * ww * 100
    pillarBreakdown.push({ name: key, score: Math.round(sc * 10) / 10, weight: ww })
  }

  const weeklyStartGrade = Math.round(
    0.35 * (pillars.opportunity! * 100) +
      0.3 * (pillars.production! * 100) +
      0.2 * (pillars.matchup! * 100) +
      0.15 * (pillars.trend! * 100),
  )
  const dynastyGrade = Math.round(
    0.35 * (pillars.production! * 100) +
      0.25 * (pillars.contractValue! * 100) +
      0.2 * (100 - pillars.risk! * 100) +
      0.2 * (pillars.trend! * 100),
  )
  const salaryEfficiencyGrade = Math.round(pillars.salaryValue! * 100)
  const contractValueGrade = Math.round(pillars.contractValue! * 100)
  const waiverPriorityScore = Math.round(
    0.5 * (pillars.salaryValue! * 100) + 0.3 * (pillars.production! * 100) + 0.2 * (pillars.trend! * 100),
  )
  const tradeValueScore = Math.round(
    0.4 * (pillars.production! * 100) + 0.3 * (100 - pillars.risk! * 100) + 0.3 * (pillars.contractValue! * 100),
  )
  const boomBustScore = Math.round(clamp01(spread / 15) * 100)
  const floorScore = Math.round(clamp01(floor / 12) * 100)
  const riskScore = Math.round((1 - pillars.risk!) * 100)
  const trendScore = Math.round(pillars.trend! * 100)

  let verdict: DefenderVerdict = 'HOLD'
  if (overall >= 72 && weeklyStartGrade >= 68) verdict = 'START'
  else if (overall < 42 || weeklyStartGrade < 38) verdict = 'SIT'
  else if (salaryEfficiencyGrade >= 78 && tradeValueScore >= 70) verdict = 'TRADE_HIGH'
  else if (salaryEfficiencyGrade <= 38 && pillars.production! * 100 >= 55) verdict = 'BUY_LOW'
  else if (contractValueGrade >= 72 && yrs <= 2) verdict = 'EXTEND'
  else if (riskScore < 40 && salaryEfficiencyGrade < 45) verdict = 'CUT_AFTER_WEEK'
  else if (overall >= 55 && overall < 68) verdict = 'WATCHLIST'

  const topReasons = [
    `Opportunity/snap path scores ${(pillars.opportunity! * 100).toFixed(0)}.`,
    `Production vs format (${formatType}) fits ${archetype.replace(/_/g, ' ')} profile.`,
    `Matchup index vs opponent rank ${oppR} (${matchup.runHeavyLikelihood > 0.55 ? 'run-heavy lean' : 'neutral'}).`,
  ]
  const mainRisk =
    age >= 30
      ? 'Age 30+ IDP — elevated decline risk in long-term formats.'
      : spread > 8
        ? 'High week-to-week volatility — boom/bust profile.'
        : 'Role or snap path could shift with defensive packages.'

  const confidence: 'high' | 'medium' | 'low' =
    stats.length >= 3 && salary.salary > 0 ? 'high' : stats.length >= 2 ? 'medium' : 'low'

  return {
    overallGrade: Math.round(overall * 10) / 10,
    weeklyStartGrade,
    dynastyGrade,
    salaryEfficiencyGrade,
    contractValueGrade,
    waiverPriorityScore,
    tradeValueScore,
    boomBustScore,
    floorScore,
    riskScore,
    trendScore,
    verdict,
    topReasons,
    mainRisk,
    confidence,
    pillarBreakdown,
  }
}

/*
 * ⚠ STILL FABRICATED — weekly lines come from the hash generator, so every
 * action that reaches this context (defender_eval, player_analysis) stays 503
 * in the route's readiness gate until it reads real FantasyStatLine weeks.
 */
async function statsFromDeterministic(
  leagueId: string,
  playerId: string,
  week: number,
): Promise<IDPWeeklyStats[]> {
  const rules = await getMergedScoringRulesForLeague(leagueId)
  return [3, 2, 1, 0].map((ago) => {
    const w = Math.max(1, week - ago)
    const line = generateDeterministicWeeklyStatLine(playerId, w)
    return {
      week: w,
      idpPoints: computeIdpFantasyPoints(line, rules).total,
      soloTackles: line.idp_solo_tackle ?? 4,
      assistedTackles: line.idp_assist_tackle ?? 2,
      sacks: line.idp_sack ?? 0.5,
      interceptions: line.idp_interception ?? 0,
      passDeflections: line.idp_pass_defended ?? 1,
      forcedFumbles: line.idp_forced_fumble ?? 0,
    }
  })
}

export async function buildDefenderEvaluationContext(
  leagueId: string,
  playerId: string,
  week: number,
  row: IdPlayerRow,
): Promise<{
  profile: IDPPlayerProfile
  stats: IDPWeeklyStats[]
  salary: IDPSalaryRecordLite
  matchup: MatchupContext
  leagueConfig: IDPScoringConfig
  formatType: string
}> {
  const cfg = await getIdpLeagueConfig(leagueId)
  const preset = (cfg?.scoringPreset ?? 'balanced') as string
  const formatType =
    preset === 'tackle_heavy' ? 'tackle_heavy' : preset === 'big_play_heavy' ? 'big_play' : 'balanced'

  const stats = await statsFromDeterministic(leagueId, playerId, week)
  const rec = await prisma.iDPSalaryRecord.findFirst({
    where: { leagueId, playerId },
    select: {
      salary: true,
      yearsRemaining: true,
      contractStartYear: true,
      contractYears: true,
      status: true,
      isFranchiseTagged: true,
      cutPenaltyCurrent: true,
    },
  })
  const salary: IDPSalaryRecordLite = rec ?? {
    salary: 8 + (playerId.length % 12),
    yearsRemaining: 2,
    contractStartYear: new Date().getFullYear(),
    contractYears: 3,
    status: 'active',
    isFranchiseTagged: false,
    cutPenaltyCurrent: null,
  }

  const seed = playerId.split('').reduce((s, c) => s + c.charCodeAt(0), 0)
  const matchup: MatchupContext = {
    opponentRankVsPos: 8 + (seed % 22),
    runHeavyLikelihood: 0.35 + (seed % 50) / 100,
    opposingStarInjuryFlag: seed % 7 === 0,
  }

  const profile: IDPPlayerProfile = {
    playerId,
    name: row.name,
    position: row.position,
    team: row.team,
    age: 24 + (seed % 10),
    defenderRole: inferArchetype(row.position),
    depthChartPosition: 0.75 + (seed % 20) / 100,
  }

  return {
    profile,
    stats,
    salary,
    matchup,
    leagueConfig: { preset },
    formatType,
  }
}

export async function getDefenderEvaluationForPlayer(
  leagueId: string,
  managerId: string,
  week: number,
  playerId: string,
): Promise<{ evaluation: DefenderEvaluation; player: IdPlayerRow }> {
  await requireAfSub()
  if (!(await isIdpLeague(leagueId))) throw new Error('Not an IDP league')
  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: managerId },
    select: { playerData: true },
  })
  const defenders = parseIdpPlayers(roster?.playerData)
  const p = defenders.find((d) => d.playerId === playerId)
  if (!p) throw new Error('Player not on your IDP roster snapshot')
  const ctx = await buildDefenderEvaluationContext(leagueId, playerId, week, p)
  const evaluation = scoreDefender(
    ctx.profile,
    ctx.stats,
    ctx.salary,
    ctx.matchup,
    ctx.leagueConfig,
    ctx.formatType,
  )
  return { evaluation, player: p }
}

async function assertIdpCapLeague(leagueId: string): Promise<{ season: number; totalCap: number }> {
  const cfg = await prisma.iDPCapConfig.findUnique({ where: { leagueId } })
  if (!cfg) throw new Error('No IDP cap configuration for this league')
  return { season: cfg.season, totalCap: cfg.totalCap }
}

/** IDP salary rows use `RedraftRoster.id`, not legacy `Roster.id`. */
export async function getRedraftRosterIdForUser(leagueId: string, userId: string): Promise<string | null> {
  const r = await prisma.redraftRoster.findFirst({
    where: { leagueId, ownerId: userId },
    select: { id: true },
  })
  return r?.id ?? null
}

export async function getCapSpaceAdvice(leagueId: string, rosterId: string): Promise<CapAdvice> {
  await requireAfSub()
  if (!(await isIdpLeague(leagueId))) throw new Error('Not an IDP league')
  const { season, totalCap } = await assertIdpCapLeague(leagueId)
  const summary = await getTeamCapSummary(leagueId, rosterId, season)
  const contracts = await prisma.iDPSalaryRecord.findMany({
    where: { leagueId, rosterId, status: { in: ['active', 'franchise_tagged'] } },
    orderBy: { salary: 'desc' },
  })
  const expiring = contracts.filter((c) => c.yearsRemaining <= 1)
  const pool = await buildIdpWaiverPool(leagueId, 6)
  const waiverNote = pool.slice(0, 4).map((w) => `${w.name} (${w.position})`).join(', ')

  const res = await openaiChatText({
    messages: [
      { role: 'system', content: CHIMMY_CAP_RULE },
      {
        role: 'user',
        content: `You are Chimmy for a salary cap IDP league.
Team cap status:
  Available cap: $${summary.availableCap.toFixed(1)}M
  Dead money: $${summary.deadMoney.toFixed(1)}M
  Total cap used: $${summary.totalCapUsed.toFixed(1)}M / $${totalCap.toFixed(1)}M
  Expiring contracts: ${expiring.map((e) => `${e.playerName} ($${e.salary.toFixed(1)}M)`).join('; ') || 'none noted'}
  Unrostered defenders in this league (real waiver options): ${waiverNote || 'none found'}

Identify the best 3 cap moves this team can make.
For each: what to do, why, cap savings, and the risk.
Format each as: [Action] → [Player] → [Savings/Cost] → [Reason]
Keep each recommendation to 2 sentences max.
Also one-line summary at the top starting with SUMMARY:`,
      },
    ],
    temperature: 0.45,
    maxTokens: 700,
  })
  const text = res.ok ? res.text : 'AI unavailable.'
  const lines = text.split('\n').filter(Boolean)
  const recommendations: CapRecommendation[] = lines
    .filter((l) => l.includes('→'))
    .slice(0, 5)
    .map((l) => {
      const parts = l.split('→').map((x) => x.trim())
      return {
        action: parts[0] ?? 'Move',
        player: parts[1],
        savingsOrCost: parts[2] ?? '',
        reason: parts[3] ?? l,
      }
    })
  if (recommendations.length === 0) {
    recommendations.push(
      {
        action: 'Review expiring deals',
        player: expiring[0]?.playerName,
        savingsOrCost: `$${summary.availableCap.toFixed(1)}M room`,
        reason: 'Prioritize extensions or tags before dead money spikes.',
      },
      {
        action: 'Trim low-snap salary',
        savingsOrCost: 'Variable',
        reason: 'Swap expensive depth for waiver upside when projections lag.',
      },
      {
        action: 'Stash rollover',
        savingsOrCost: `$${summary.effectiveSpendableCap.toFixed(1)}M effective`,
        reason: 'Keep in-season holdback in mind before aggressive bids.',
      },
    )
  }
  const summaryLine = lines.find((l) => l.toUpperCase().startsWith('SUMMARY')) ?? text.slice(0, 200)
  return { recommendations: recommendations.slice(0, 3), summary: summaryLine }
}

export async function evaluateContractDecision(
  leagueId: string,
  rosterId: string,
  playerId: string,
  decisionType: 'cut' | 'extend' | 'tag' | 'hold',
): Promise<ContractDecisionEval> {
  await requireAfSub()
  if (!(await isIdpLeague(leagueId))) throw new Error('Not an IDP league')
  const { season } = await assertIdpCapLeague(leagueId)
  const cap = await getTeamCapSummary(leagueId, rosterId, season)
  const rec = await prisma.iDPSalaryRecord.findFirst({
    where: { leagueId, rosterId, playerId },
  })
  if (!rec) throw new Error('Salary record not found')

  const cfg = await prisma.iDPCapConfig.findUnique({ where: { leagueId } })
  const tagVal = cfg?.franchiseTagValue ?? 20
  const boost = rec.extensionBoostPct ?? 0.1

  let prompt = ''
  if (decisionType === 'cut') {
    const dead = rec.cutPenaltyCurrent ?? rec.salary * 1.25
    prompt = `Cut decision for ${rec.playerName}. Dead money ≈ $${dead.toFixed(1)}M. Cap room $${cap.availableCap.toFixed(1)}M. Is the cut worth it vs replacement waiver value?`
  } else if (decisionType === 'extend') {
    prompt = `Extend ${rec.playerName}: adding years at +${Math.round(boost * 100)}% per year rule-of-thumb. Salary $${rec.salary.toFixed(1)}M, ${rec.yearsRemaining} yrs left. Worth locking in?`
  } else if (decisionType === 'tag') {
    prompt = `Franchise tag at $${tagVal.toFixed(1)}M for 1 year on ${rec.playerName}. Right move vs letting them test market?`
  } else {
    prompt = `Hold ${rec.playerName} — no transaction. Assess if holding preserves flexibility.`
  }

  const res = await openaiChatText({
    messages: [
      { role: 'system', content: CHIMMY_CAP_RULE },
      {
        role: 'user',
        content: `${prompt}
Reply JSON only:
{"recommendation":"short","confidence":"high|medium|low","reasoning":["r1","r2","r3"],"risk":"one line","verdict":"label","alternativeOptions":"short"}`,
      },
    ],
    temperature: 0.4,
    maxTokens: 500,
  })
  const raw = res.ok ? res.text : '{}'
  try {
    const j = JSON.parse(raw.replace(/```json\s*/g, '').replace(/```/g, '').trim()) as Record<string, unknown>
    return {
      recommendation: String(j.recommendation ?? 'Review cap context'),
      confidence: (['high', 'medium', 'low'].includes(String(j.confidence))
        ? j.confidence
        : 'medium') as ContractDecisionEval['confidence'],
      reasoning: Array.isArray(j.reasoning) ? (j.reasoning as string[]).slice(0, 3) : [String(j.reasoning ?? '')],
      risk: String(j.risk ?? ''),
      verdict: String(j.verdict ?? decisionType),
      alternativeOptions: String(j.alternativeOptions ?? ''),
    }
  } catch {
    return {
      recommendation: 'Use league cap tools to confirm numbers before acting.',
      confidence: 'medium',
      reasoning: [prompt],
      risk: 'Model uncertainty — verify dead money and tag rules in commissioner settings.',
      verdict: decisionType,
      alternativeOptions: 'Compare to waiver replacements at similar salary.',
    }
  }
}

export async function getCapEfficiencyRankings(leagueId: string, week: number): Promise<CapEfficiencyRankings> {
  await requireAfSub()
  if (!(await isIdpLeague(leagueId))) throw new Error('Not an IDP league')
  const rules = await getMergedScoringRulesForLeague(leagueId)
  const rows = await prisma.iDPSalaryRecord.findMany({
    where: { leagueId, isDefensive: true, status: { in: ['active', 'franchise_tagged'] } },
  })
  const scored: CapEfficiencyRow[] = []
  const byPos: Record<string, number[]> = {}
  for (const r of rows) {
    const line = generateDeterministicWeeklyStatLine(r.playerId, week)
    const weekPoints = computeIdpFantasyPoints(line, rules).total
    const sal = Math.max(0.5, r.salary)
    const ptsPerM = weekPoints / sal
    scored.push({
      playerId: r.playerId,
      playerName: r.playerName,
      position: r.position,
      salary: r.salary,
      ptsPerM,
      weekPoints,
    })
    const g = ['DE', 'DT', 'DL'].includes(r.position.toUpperCase()) ? 'DL' : r.position === 'LB' ? 'LB' : 'DB'
    byPos[g] = byPos[g] ?? []
    byPos[g].push(ptsPerM)
  }
  const posAvg: Record<string, number> = {}
  for (const [k, arr] of Object.entries(byPos)) {
    posAvg[k] = arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
  }
  const leagueAvg =
    scored.length > 0 ? scored.reduce((s, x) => s + x.ptsPerM, 0) / scored.length : 0
  scored.sort((a, b) => b.ptsPerM - a.ptsPerM)
  return {
    underpriced: scored.slice(0, 5),
    overpriced: [...scored].sort((a, b) => a.ptsPerM - b.ptsPerM).slice(0, 5),
    leagueAvgEfficiency: Math.round(leagueAvg * 1000) / 1000,
    positionAvgEfficiency: posAvg,
  }
}

export async function getCapBurdenWarnings(leagueId: string, rosterId: string): Promise<CapBurdenWarning[]> {
  await requireAfSub()
  const { season, totalCap } = await assertIdpCapLeague(leagueId)
  const projs = await prisma.iDPCapProjection.findMany({
    where: { leagueId, rosterId, projectionYear: { gte: season, lte: season + 2 } },
    orderBy: { projectionYear: 'asc' },
  })
  const deadRows = await prisma.iDPDeadMoney.findMany({
    where: { leagueId, rosterId, season },
  })
  const deadSum = deadRows.reduce((s, d) => s + d.currentYearDead, 0)

  const out: CapBurdenWarning[] = []
  for (const p of projs) {
    const pct = p.totalCapUsed / Math.max(0.001, totalCap)
    if (pct > 0.9) {
      out.push({
        year: p.projectionYear,
        kind: 'high_usage',
        message: `Projected cap usage ${(pct * 100).toFixed(1)}% in ${p.projectionYear}`,
        detail: `Committed $${p.committedSalary.toFixed(1)}M + dead $${p.deadCapHits.toFixed(1)}M.`,
      })
    }
  }
  if (deadSum > 20) {
    out.push({
      year: season,
      kind: 'dead_money',
      message: `Dead money $${deadSum.toFixed(1)}M exceeds $20M threshold`,
      detail: deadRows.map((d) => `${d.playerName}: $${d.currentYearDead.toFixed(1)}M`).join('; ') || 'Review cuts and prorations.',
    })
  }
  return out
}

export async function identifyTradeTargets(leagueId: string, managerId: string): Promise<TradeTargetList> {
  await requireAfSub()
  if (!(await isIdpLeague(leagueId))) throw new Error('Not an IDP league')
  const mineId = await getRedraftRosterIdForUser(leagueId, managerId)
  if (!mineId) throw new Error('Roster not found')

  const rules = await getMergedScoringRulesForLeague(leagueId)
  const week = 1
  const others = await prisma.iDPSalaryRecord.findMany({
    where: {
      leagueId,
      isDefensive: true,
      status: { in: ['active', 'franchise_tagged'] },
      NOT: { rosterId: mineId },
    },
    take: 40,
  })
  const targets: TradeTarget[] = []
  for (const r of others) {
    const line = generateDeterministicWeeklyStatLine(r.playerId, week)
    const pts = computeIdpFantasyPoints(line, rules).total
    const eff = pts / Math.max(0.5, r.salary)
    if (eff > 1.2 && r.yearsRemaining <= 2) {
      targets.push({
        playerName: r.playerName,
        position: r.position,
        rosterHint: `Roster ${r.rosterId.slice(0, 6)}…`,
        salary: r.salary,
        efficiency: Math.round(eff * 100) / 100,
        note: 'High pts/$ vs league snapshot — seller may need cap relief.',
      })
    }
  }
  targets.sort((a, b) => b.efficiency - a.efficiency)
  const res = await openaiChatText({
    messages: [
      { role: 'system', content: CHIMMY_CAP_RULE },
      {
        role: 'user',
        content: `Trade target ideas (public contract data only, no private chats):\n${targets
          .slice(0, 8)
          .map((t) => `- ${t.playerName} ${t.position} $${t.salary}M eff ${t.efficiency}`)
          .join('\n')}\nSummarize 2-3 negotiation angles in plain language.`,
      },
    ],
    temperature: 0.45,
    maxTokens: 400,
  })
  return { targets: targets.slice(0, 8), summary: res.ok ? res.text : 'Targets ranked by efficiency vs salary.' }
}

export async function getContenderVsRebuildAdvice(
  leagueId: string,
  managerId: string,
): Promise<ContenderRebuildAnalysis> {
  await requireAfSub()
  if (!(await isIdpLeague(leagueId))) throw new Error('Not an IDP league')
  const redraft = await prisma.redraftRoster.findFirst({
    where: { leagueId, ownerId: managerId },
    select: { id: true, wins: true, losses: true, ties: true },
  })
  const legacy = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: managerId },
    select: { playerData: true },
  })
  if (!redraft) throw new Error('Roster not found')
  const { season } = await assertIdpCapLeague(leagueId)
  const summary = await getTeamCapSummary(leagueId, redraft.id, season)
  const idps = parseIdpPlayers(legacy?.playerData)
  let winPct = 0.5
  const w = redraft.wins ?? 0
  const l = redraft.losses ?? 0
  const t = redraft.ties ?? 0
  if (w + l + t > 0) winPct = w / (w + l + t)

  const res = await openaiChatText({
    messages: [
      { role: 'system', content: CHIMMY_CAP_RULE },
      {
        role: 'user',
        content: `Contender vs rebuild lens. Win% ~${(winPct * 100).toFixed(0)}. IDP count ${idps.length}. Available cap $${summary.availableCap.toFixed(1)}M.
Reply JSON: {"mode":"contender|rebuilding|middling","reasoning":"...","recommendedActions":["a","b","c"]}`,
      },
    ],
    temperature: 0.45,
    maxTokens: 500,
  })
  try {
    const j = JSON.parse((res.ok ? res.text : '{}').replace(/```json\s*|```/g, '').trim()) as Record<string, unknown>
    const mode = j.mode === 'rebuilding' || j.mode === 'middling' ? j.mode : 'contender'
    return {
      mode,
      reasoning: String(j.reasoning ?? ''),
      recommendedActions: Array.isArray(j.recommendedActions) ? (j.recommendedActions as string[]).slice(0, 6) : [],
    }
  } catch {
    return {
      mode: winPct >= 0.55 ? 'contender' : winPct <= 0.4 ? 'rebuilding' : 'middling',
      reasoning: 'Heuristic from win rate and cap flexibility.',
      recommendedActions:
        winPct >= 0.55
          ? ['Prioritize short-term IDP starters', 'Avoid long dead-money deals']
          : ['Move expensive veterans', 'Target young snap-share risers'],
    }
  }
}

export async function generateDefenderWeeklyRecap(
  leagueId: string,
  managerId: string,
  week: number,
): Promise<DefenderRecap> {
  await requireAfSub()
  if (!(await isIdpLeague(leagueId))) throw new Error('Not an IDP league')
  const roster = await prisma.roster.findFirst({
    where: { leagueId, platformUserId: managerId },
    select: { playerData: true },
  })
  const defs = parseIdpPlayers(roster?.playerData)
  const rules = await getMergedScoringRulesForLeague(leagueId)
  const lines: string[] = []
  let total = 0
  for (const d of defs) {
    const line = generateDeterministicWeeklyStatLine(d.playerId, week)
    const pts = computeIdpFantasyPoints(line, rules).total
    total += pts
    lines.push(`${d.name}: ${pts.toFixed(1)} pts (solo ${line.idp_solo_tackle ?? 0}, sack ${line.idp_sack ?? 0})`)
  }
  const leagueAvg = 42
  const res = await openaiChatText({
    messages: [
      { role: 'system', content: CHIMMY_CAP_RULE },
      {
        role: 'user',
        content: `Weekly defensive recap. Starters/defenders scored:\n${lines.join('\n')}\nTotal defensive score ${total.toFixed(1)} vs league avg ~${leagueAvg}.
Highlight best, disappointment, cap efficiency note. 2-3 sentences total.`,
      },
    ],
    temperature: 0.45,
    maxTokens: 350,
  })
  return { text: res.ok ? res.text : 'Recap unavailable.', week }
}

// ─── League chat: no AfSub (public contract / cap facts) ─────────────────

export async function formatChatCapSummary(leagueId: string, userId: string): Promise<string> {
  const rosterId = await getRedraftRosterIdForUser(leagueId, userId)
  if (!rosterId) return 'Could not resolve your roster for cap summary.'
  const cfg = await prisma.iDPCapConfig.findUnique({ where: { leagueId } })
  if (!cfg) return 'No IDP cap configuration for this league.'
  const s = await getTeamCapSummary(leagueId, rosterId, cfg.season)
  return `💰 **Cap (public)**\nAvailable: $${s.availableCap.toFixed(1)}M · Dead: $${s.deadMoney.toFixed(1)}M · Used $${s.totalCapUsed.toFixed(1)}M / $${cfg.totalCap.toFixed(1)}M`
}

export async function formatChatContractsList(leagueId: string, userId: string): Promise<string> {
  const rosterId = await getRedraftRosterIdForUser(leagueId, userId)
  if (!rosterId) return 'Could not resolve your roster.'
  const rows = await prisma.iDPSalaryRecord.findMany({
    where: { leagueId, rosterId },
    orderBy: { salary: 'desc' },
  })
  if (rows.length === 0) return '📋 No salary records on file for your roster.'
  const lines = rows.map(
    (r) =>
      `• ${r.playerName} (${r.position}) $${r.salary.toFixed(1)}M · ${r.yearsRemaining} yr · ${r.status}`,
  )
  return `📋 **Your contracts**\n${lines.join('\n')}`
}

export async function formatChatCutPreview(leagueId: string, userId: string, nameQuery: string): Promise<string> {
  const rosterId = await getRedraftRosterIdForUser(leagueId, userId)
  if (!rosterId) return 'Could not resolve your roster.'
  const q = nameQuery.trim().toLowerCase()
  const rec = await prisma.iDPSalaryRecord.findFirst({
    where: {
      leagueId,
      rosterId,
      playerName: { contains: q, mode: 'insensitive' },
    },
  })
  if (!rec) return `No contract match for "${nameQuery}". Try a shorter name.`
  const dead = rec.cutPenaltyCurrent ?? rec.salary * 1.25
  return `✂️ **Cut preview (no transaction executed)**\n${rec.playerName}: est. dead money **$${dead.toFixed(1)}M** (verify in app before cutting).`
}

export async function formatChatExtendPreview(leagueId: string, userId: string, nameQuery: string): Promise<string> {
  const rosterId = await getRedraftRosterIdForUser(leagueId, userId)
  if (!rosterId) return 'Could not resolve your roster.'
  const q = nameQuery.trim().toLowerCase()
  const rec = await prisma.iDPSalaryRecord.findFirst({
    where: {
      leagueId,
      rosterId,
      playerName: { contains: q, mode: 'insensitive' },
    },
  })
  if (!rec) return `No contract match for "${nameQuery}".`
  const boost = rec.extensionBoostPct ?? 0.1
  const newSal = rec.salary * (1 + boost)
  return `📋 **Extend preview (no transaction)**\n${rec.playerName}: ~$${newSal.toFixed(2)}M/yr after +${Math.round(boost * 100)}% rule-of-thumb boost (confirm in extension modal).`
}

export async function formatChatDefenseCapSimulate(leagueId: string, userId: string): Promise<string> {
  const rosterId = await getRedraftRosterIdForUser(leagueId, userId)
  if (!rosterId) return 'Could not resolve your roster.'
  const cfg = await prisma.iDPCapConfig.findUnique({ where: { leagueId } })
  if (!cfg) return 'Cap not configured.'
  const s = await getTeamCapSummary(leagueId, rosterId, cfg.season)
  const defSal = await prisma.iDPSalaryRecord.aggregate({
    where: { leagueId, rosterId, isDefensive: true, status: { in: ['active', 'franchise_tagged'] } },
    _sum: { salary: true },
  })
  const d = defSal._sum.salary ?? 0
  return `🧮 **Defense cap snapshot**\nIDP salary on books ~$${d.toFixed(1)}M · Team available cap $${s.availableCap.toFixed(1)}M (illustrative sim).`
}