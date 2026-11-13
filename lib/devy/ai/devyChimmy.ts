/**
 * Devy Chimmy AI — all exported functions call `requireAfSub()` first (lib: `requireAfSubUserIdOrThrow`).
 */

import type { DevyPlayerMapping, DevyPlayerState } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { requireAfSubUserIdOrThrow } from '@/lib/redraft/ai/requireAfSub'
import { openaiChatJson, openaiChatText, parseJsonContentFromChatCompletion } from '@/lib/openai-client'
import { generateImportAudit } from '@/lib/devy/mergeExecutionEngine'
import { levenshtein } from '@/lib/devy/identityMatchingEngine'
import { getLeagueRole } from '@/lib/league/permissions'

async function requireAfSub(): Promise<void> {
  await requireAfSubUserIdOrThrow()
}

const CHIMMY_DEVY = `You are Chimmy, the calm AI assistant for AllFantasy Devy dynasty leagues.
Use only the context provided. Clearly label confirmed facts vs projections. Never invent college stats or player identities.`

// ─── Types ─────────────────────────────────────────────────────────────

type DevySetupRec = {
  startupFormat: string
  futureDraftFormat: string
  taxiSlots: number
  devySlots: number
  reasoning: string
  prosCons: string[]
  warnings: string[]
}

type DevyProspectEval = {
  ceiling: string
  timeline: string
  fit: string
  grade: 'A' | 'B' | 'C' | 'D'
  risks: string[]
  verdict: string
}

type DevyRankingEntry = {
  rank: number
  name: string
  school: string | null
  classYear: string | null
  grade: string
  note: string
}

type DevyRankingList = {
  positionFilter?: string
  classFilter?: string
  entries: DevyRankingEntry[]
}

type BreakoutAlert = {
  playerId: string
  name: string
  alertType: string
  reason: string
  action: string
}

type PipelineHealth = {
  mode: 'contender' | 'rebuild' | 'balanced' | 'aging'
  pipelineScore: number
  concerns: string[]
  recommendations: string[]
}

type PromoteDecision = {
  recommendation: 'promote' | 'hold' | 'wait'
  confidence: number
  reasoning: string
  risk: string
}

export type SuggestedMatch = {
  mappingId: string
  externalName: string
  suggestedPlayerId: string | null
  suggestedName: string | null
  confidence: number
  reason: string
}

type ImportSummaryNarrative = {
  narrative: string
  auditConfidence: string
}

type ChimmyResponse = {
  reply: string
}

type DraftStrategyResponse = {
  recommendation: string
  topOptions: string[]
  risk: string
  verdict: string
}

export async function buildDevyAiCacheContextSummary(input: {
  leagueId?: string
  managerId?: string
  rosterId?: string
  playerId?: string
  season?: number | null
  draftType?: string | null
  currentPick?: number | null
  position?: string | null
  classFilter?: string | null
  sessionId?: string | null
  teamCount?: number | null
  leagueExperience?: string | null
  managerFamiliarity?: string | null
}): Promise<Record<string, unknown>> {
  if (!input.leagueId) {
    return {
      scope: 'global',
      teamCount: input.teamCount ?? null,
      leagueExperience: input.leagueExperience ?? null,
      managerFamiliarity: input.managerFamiliarity ?? null,
    }
  }

  const leagueId = input.leagueId
  const [cfg, stateCount, devySlotCount, taxiSlotCount, transitions, playerState, importSession] = await Promise.all([
    prisma.devyLeague.findUnique({
      where: { leagueId },
      select: {
        startupDraftFormat: true,
        futureDraftFormat: true,
        taxiSlots: true,
        devySlots: true,
        maxDevyPerTeam: true,
        taxiRookieOnly: true,
        devyGradBehavior: true,
      },
    }),
    prisma.devyPlayerState.count({ where: { leagueId } }),
    prisma.devyDevySlot.count({ where: { leagueId } }),
    prisma.devyTaxiSlot.count({ where: { leagueId } }),
    input.season != null
      ? prisma.devyRookieTransition.count({ where: { leagueId, nflEntryYear: input.season } })
      : Promise.resolve(0),
    input.playerId
      ? prisma.devyPlayerState.findFirst({
          where: { leagueId, playerId: input.playerId },
          select: { playerId: true, playerName: true, position: true, bucketState: true },
        })
      : Promise.resolve(null),
    input.sessionId
      ? prisma.devyImportSession.findFirst({
          where: { id: input.sessionId },
          select: {
            id: true,
            leagueId: true,
            status: true,
            createdAt: true,
            _count: {
              select: {
                sources: true,
                importedSeasons: true,
              },
            },
          },
        })
      : Promise.resolve(null),
  ])

  let managerSummary: Record<string, unknown> | null = null
  if (input.rosterId) {
    const [rosterStateCount, rosterPositions] = await Promise.all([
      prisma.devyPlayerState.count({ where: { leagueId, rosterId: input.rosterId } }),
      prisma.devyPlayerState.findMany({
        where: { leagueId, rosterId: input.rosterId },
        select: { playerId: true, position: true, bucketState: true },
        take: 40,
        orderBy: { playerId: 'asc' },
      }),
    ])
    managerSummary = {
      rosterId: input.rosterId,
      rosterStateCount,
      rosterPositions: rosterPositions.map((row) => `${row.playerId}:${row.position}:${row.bucketState}`),
    }
  }

  return {
    scope: 'league',
    leagueId,
    config: cfg ?? null,
    stateCount,
    devySlotCount,
    taxiSlotCount,
    transitionCountForSeason: transitions,
    managerSummary,
    playerSummary: playerState,
    importSessionSummary: importSession,
    actionContext: {
      season: input.season ?? null,
      draftType: input.draftType ?? null,
      currentPick: input.currentPick ?? null,
      position: input.position ?? null,
      classFilter: input.classFilter ?? null,
    },
  }
}

// ─── Setup advisor ───────────────────────────────────────────────────────

export async function getSetupRecommendation(
  teamCount: number,
  leagueExperience: string,
  managerFamiliarity: string,
): Promise<DevySetupRec> {
  await requireAfSub()

  const exp = leagueExperience.toLowerCase()
  const fam = managerFamiliarity.toLowerCase()
  let startupFormat = 'combined'
  let futureDraftFormat = 'combined'
  let taxiSlots = 5
  let devySlots = 10
  const warnings: string[] = []
  const prosCons: string[] = []

  if (teamCount >= 14 && (exp.includes('mixed') || fam.includes('mixed'))) {
    startupFormat = 'split_vets_first'
    futureDraftFormat = 'separate'
    prosCons.push('Pro: split drafts reduce runaway devy hoarding in large leagues.')
    prosCons.push('Con: longer calendar to complete two drafts.')
  } else if (teamCount <= 10 && exp.includes('experienced')) {
    startupFormat = 'combined'
    futureDraftFormat = 'combined'
    prosCons.push('Pro: one board is faster for experienced managers.')
  } else if (fam.includes('first') || exp.includes('first')) {
    startupFormat = 'split_vets_first'
    futureDraftFormat = 'separate'
    warnings.push('First-time devy leagues often underestimate devy draft length — consider split formats.')
  }

  if (teamCount >= 16) {
    taxiSlots = 6
    devySlots = 12
  }

  let reasoning = `Recommended for ${teamCount} teams with ${leagueExperience} experience and ${managerFamiliarity} manager familiarity.`

  const r = await openaiChatText({
    messages: [
      { role: 'system', content: CHIMMY_DEVY },
      {
        role: 'user',
        content: `In 2-3 sentences, justify startupFormat=${startupFormat} and futureDraftFormat=${futureDraftFormat} for a ${teamCount}-team devy dynasty league (${leagueExperience}, ${managerFamiliarity}). No bullet fabrications.`,
      },
    ],
    maxTokens: 400,
    temperature: 0.4,
  })
  if (r.ok && r.text?.trim()) reasoning = r.text.trim()

  return {
    startupFormat,
    futureDraftFormat,
    taxiSlots,
    devySlots,
    reasoning,
    prosCons,
    warnings,
  }
}

// ─── Scouting ──────────────────────────────────────────────────────────

export async function evaluateDevyProspect(
  playerId: string,
  leagueId: string,
  managerRoster: DevyPlayerState[],
): Promise<DevyProspectEval> {
  await requireAfSub()

  const slot =
    (await prisma.devyDevySlot.findFirst({ where: { leagueId, playerId } })) ??
    (await prisma.devyPlayerState.findFirst({ where: { leagueId, playerId, bucketState: 'devy' } }))

  const name = slot && 'playerName' in slot ? slot.playerName : 'Unknown'
  const pos = slot && 'position' in slot ? slot.position : '—'
  const school =
    slot && 'school' in slot && slot.school != null
      ? slot.school
      : slot && 'school' in slot
        ? (slot as { school?: string | null }).school ?? null
        : null
  const classYear =
    slot && 'classYear' in slot ? (slot as { classYear?: string | null }).classYear : null
  const projYear =
    slot && 'projectedDeclarationYear' in slot
      ? (slot as { projectedDeclarationYear?: number | null }).projectedDeclarationYear
      : null

  const posCounts = new Map<string, number>()
  for (const p of managerRoster) {
    if (p.bucketState === 'active_starter' || p.bucketState === 'active_bench') {
      posCounts.set(p.position, (posCounts.get(p.position) ?? 0) + 1)
    }
  }
  const needs = [...posCounts.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, 3)
    .map(([p]) => p)
    .join(', ') || 'balanced'

  const user = `Evaluate college prospect:
Name: ${name}, Position: ${pos}, School: ${school ?? 'unknown'}, Class: ${classYear ?? 'unknown'}, Projected declaration: ${projYear ?? 'undeclared'}
Manager positional counts (starters+bench): ${needs}
Return JSON: {"ceiling":"high|medium|low + short reason","timeline":"text","fit":"text","grade":"A|B|C|D","risks":["..."],"verdict":"one paragraph"}`

  const o = await openaiChatJson({
    messages: [
      { role: 'system', content: CHIMMY_DEVY + ' Respond with valid JSON only.' },
      { role: 'user', content: user },
    ],
    maxTokens: 900,
    temperature: 0.35,
  })

  if (!o.ok) {
    return {
      ceiling: 'medium (AI unavailable — heuristic)',
      timeline: projYear ? `Declaration window around ${projYear} (projected).` : 'Timeline unclear from profile.',
      fit: `Roster need signal: ${needs}.`,
      grade: 'B',
      risks: ['Incomplete data — confirm film and team context locally.'],
      verdict: 'Use league context and your risk tolerance; Chimmy output degraded (provider).',
    }
  }

  const parsedRaw = parseJsonContentFromChatCompletion(o.json)
  const parsed =
    parsedRaw && typeof parsedRaw === 'object' && !Array.isArray(parsedRaw)
      ? (parsedRaw as Record<string, unknown>)
      : {}

  const grade = ['A', 'B', 'C', 'D'].includes(String(parsed.grade)) ? (String(parsed.grade) as DevyProspectEval['grade']) : 'B'

  return {
    ceiling: String(parsed.ceiling ?? 'See scouting reports.'),
    timeline: String(parsed.timeline ?? ''),
    fit: String(parsed.fit ?? ''),
    grade,
    risks: Array.isArray(parsed.risks) ? (parsed.risks as string[]).slice(0, 6) : [],
    verdict: String(parsed.verdict ?? ''),
  }
}

export async function getDevyRankings(
  leagueId: string,
  position?: string,
  classFilter?: string,
): Promise<DevyRankingList> {
  await requireAfSub()

  const slots = await prisma.devyDevySlot.findMany({
    where: { leagueId },
    orderBy: { playerName: 'asc' },
    take: 40,
  })

  const filtered = slots.filter(s => {
    if (position && !s.position.toUpperCase().includes(position.toUpperCase())) return false
    if (classFilter && s.classYear && !String(s.classYear).toLowerCase().includes(classFilter.toLowerCase())) return false
    return true
  })

  const lines = filtered.slice(0, 25).map(s => ({
    id: s.playerId,
    name: s.playerName,
    pos: s.position,
    school: s.school,
    classYear: s.classYear,
  }))

  const o = await openaiChatJson({
    messages: [
      {
        role: 'system',
        content:
          CHIMMY_DEVY +
          ' Return JSON {"entries":[{"rank":1,"name":"","school":"","classYear":"","grade":"A+","note":""}]} max 15 entries.',
      },
      {
        role: 'user',
        content: `Rank devy prospects for this league. Position filter: ${position ?? 'ALL'}. Class filter: ${classFilter ?? 'ALL'}.\nData: ${JSON.stringify(lines)}`,
      },
    ],
    maxTokens: 1200,
    temperature: 0.35,
  })

  const entries: DevyRankingEntry[] = []
  if (o.ok) {
    try {
      const j = parseJsonContentFromChatCompletion(o.json) as { entries?: unknown } | null
      const arr = j && Array.isArray(j.entries) ? j.entries : []
      for (const [i, e] of arr.slice(0, 15).entries()) {
        const row = e as Record<string, unknown>
        entries.push({
          rank: Number(row.rank) || i + 1,
          name: String(row.name ?? ''),
          school: row.school != null ? String(row.school) : null,
          classYear: row.classYear != null ? String(row.classYear) : null,
          grade: String(row.grade ?? 'B'),
          note: String(row.note ?? ''),
        })
      }
    } catch {
      /* fallback below */
    }
  }

  if (entries.length === 0) {
    for (const [i, s] of filtered.slice(0, 10).entries()) {
      entries.push({
        rank: i + 1,
        name: s.playerName,
        school: s.school ?? null,
        classYear: s.classYear ?? null,
        grade: 'B',
        note: `${s.position} — devy stash (heuristic rank).`,
      })
    }
  }

  return { positionFilter: position, classFilter, entries }
}

export async function getBreakoutAlerts(leagueId: string): Promise<BreakoutAlert[]> {
  await requireAfSub()

  const recent = await prisma.devyDevySlot.findMany({
    where: { leagueId },
    orderBy: { rightsAcquiredAt: 'desc' },
    take: 30,
  })

  const alerts: BreakoutAlert[] = []
  for (const s of recent) {
    if (s.projectedDeclarationYear && s.projectedDeclarationYear <= new Date().getFullYear() + 1) {
      alerts.push({
        playerId: s.playerId,
        name: s.playerName,
        alertType: 'declaration_window',
        reason: `Projected declaration ${s.projectedDeclarationYear} — monitor NFL draft cycle.`,
        action: 'Review devy stash and taxi promotion plan.',
      })
    }
  }
  return alerts.slice(0, 8)
}

// ─── Roster construction ────────────────────────────────────────────────

export async function getPipelineHealthAnalysis(leagueId: string, rosterId: string): Promise<PipelineHealth> {
  await requireAfSub()

  const [states, taxi, devy, cfg] = await Promise.all([
    prisma.devyPlayerState.findMany({ where: { leagueId, rosterId } }),
    prisma.devyTaxiSlot.count({ where: { leagueId, rosterId } }),
    prisma.devyDevySlot.count({ where: { leagueId, rosterId } }),
    prisma.devyLeague.findUnique({ where: { leagueId } }),
  ])

  const starters = states.filter(s => s.bucketState === 'active_starter').length
  const bench = states.filter(s => s.bucketState === 'active_bench').length
  const ratio = cfg ? (taxi + devy) / Math.max(1, cfg.taxiSlots + cfg.devySlots) : 0.5

  let mode: PipelineHealth['mode'] = 'balanced'
  if (starters > 7 && bench < 4) mode = 'contender'
  if (devy >= (cfg?.devySlots ?? 10) * 0.8) mode = 'rebuild'
  if (ratio < 0.25) mode = 'aging'

  const pipelineScore = Math.round(Math.min(100, 40 + ratio * 80 + devy * 2))

  const concerns: string[] = []
  if (taxi === 0) concerns.push('No taxi stash — limited developmental flexibility.')
  if (devy === 0) concerns.push('Empty devy pipeline — future rookie/devy capital thin.')

  const o = await openaiChatText({
    messages: [
      { role: 'system', content: CHIMMY_DEVY },
      {
        role: 'user',
        content: `Pipeline snapshot: starters=${starters}, bench=${bench}, taxi=${taxi}, devy=${devy}. Mode=${mode}, score=${pipelineScore}. Give 3 short recommendations as a bullet list only.`,
      },
    ],
    maxTokens: 400,
    temperature: 0.4,
  })

  const recommendations =
    o.ok && o.text
      ? o.text
          .split('\n')
          .map(l => l.replace(/^[-*]\s*/, '').trim())
          .filter(Boolean)
          .slice(0, 5)
      : ['Balance taxi/devy with NFL-ready depth based on your contention window.']

  return { mode, pipelineScore, concerns, recommendations }
}

export async function getShouldIPromoteAnalysis(
  leagueId: string,
  rosterId: string,
  playerId: string,
): Promise<PromoteDecision> {
  await requireAfSub()

  const [state, cfg, taxiCount] = await Promise.all([
    prisma.devyPlayerState.findUnique({
      where: { leagueId_rosterId_playerId: { leagueId, rosterId, playerId } },
    }),
    prisma.devyLeague.findUnique({ where: { leagueId } }),
    prisma.devyTaxiSlot.count({ where: { leagueId, rosterId } }),
  ])

  if (!state || !cfg) {
    return {
      recommendation: 'wait',
      confidence: 0.2,
      reasoning: 'Player state not found or league misconfigured.',
      risk: 'Unknown roster context.',
    }
  }

  const atTaxiCap = cfg.taxiSlots > 0 && taxiCount >= cfg.taxiSlots
  let recommendation: PromoteDecision['recommendation'] = 'hold'
  if (state.bucketState === 'taxi' && !atTaxiCap) recommendation = 'promote'
  if (state.bucketState === 'devy') recommendation = 'wait'

  const o = await openaiChatText({
    messages: [
      { role: 'system', content: CHIMMY_DEVY },
      {
        role: 'user',
        content: `Should promote player ${state.playerName} (${state.position}) from ${state.bucketState}? Taxi ${taxiCount}/${cfg.taxiSlots}. Answer in 3 sentences; end with RECOMMENDATION: promote|hold|wait`,
      },
    ],
    maxTokens: 350,
    temperature: 0.35,
  })

  const text = o.ok ? o.text ?? '' : ''
  if (text.toLowerCase().includes('recommendation: promote')) recommendation = 'promote'
  if (text.toLowerCase().includes('recommendation: wait')) recommendation = 'wait'

  return {
    recommendation,
    confidence: 0.72,
    reasoning: text || 'Heuristic: check active roster space and positional need before promoting.',
    risk: atTaxiCap ? 'Taxi full — promotion may require a corresponding drop or move.' : 'Monitor NFL landing spot and league taxi rules.',
  }
}

// ─── Import assistant ───────────────────────────────────────────────────

export async function suggestPlayerMatches(
  sessionId: string,
  unmatchedPlayers: DevyPlayerMapping[],
): Promise<SuggestedMatch[]> {
  await requireAfSub()

  const rows =
    unmatchedPlayers.length > 0
      ? unmatchedPlayers
      : await prisma.devyPlayerMapping.findMany({
          where: { sessionId, internalPlayerId: null },
        })

  const out: SuggestedMatch[] = []
  const pool = await prisma.player.findMany({
    where: {
      OR: [{ devyEligible: true }, { league: { in: ['NCAA', 'NCAAF', 'NCAAB', 'NCAA'] } }],
    },
    take: 500,
    select: { id: true, name: true, position: true, team: true },
  })

  for (const m of rows) {
    let best: { id: string; name: string; score: number } | null = null
    for (const p of pool) {
      const dist = levenshtein(
        m.externalName.toLowerCase(),
        (p.name ?? '').toLowerCase(),
      )
      const score = Math.max(0, 100 - dist * 5)
      if (!best || score > best.score) best = { id: p.id, name: p.name ?? p.id, score }
    }
    const confidence = best ? Math.min(95, best.score) : 0
    out.push({
      mappingId: m.id,
      externalName: m.externalName,
      suggestedPlayerId: confidence >= 60 ? best?.id ?? null : null,
      suggestedName: confidence >= 60 ? best?.name ?? null : null,
      confidence,
      reason:
        confidence >= 60
          ? `Name similarity vs player pool (deterministic).`
          : 'No confident pool match — manual review required.',
    })
  }

  return out
}

export async function generateImportSummary(sessionId: string): Promise<ImportSummaryNarrative> {
  await requireAfSub()

  const audit = await generateImportAudit(sessionId)
  const o = await openaiChatText({
    messages: [
      { role: 'system', content: CHIMMY_DEVY + ' Plain English, commissioner-facing.' },
      {
        role: 'user',
        content: `Write 4-6 sentences summarizing this import audit for a commissioner:\n${JSON.stringify(audit)}`,
      },
    ],
    maxTokens: 500,
    temperature: 0.45,
  })

  return {
    narrative:
      o.ok && o.text?.trim()
        ? o.text.trim()
        : `Import summary: ${audit.playersImported} players matched; ${audit.unmatchedPlayers.length} unmatched; ${audit.conflictsPending} conflicts pending; ${audit.historySeasonsImported} history seasons; confidence ${audit.dataConfidenceScore}.`,
    auditConfidence: audit.dataConfidenceScore,
  }
}

// ─── Commissioner copilot ───────────────────────────────────────────────

export async function handleCommissionerQuery(
  leagueId: string,
  _commissionerId: string,
  message: string,
): Promise<ChimmyResponse> {
  await requireAfSub()

  const cfg = await prisma.devyLeague.findUnique({ where: { leagueId } })
  if (!cfg) throw new Error('Devy league not configured')

  const summary = {
    startupDraftFormat: cfg.startupDraftFormat,
    futureDraftFormat: cfg.futureDraftFormat,
    taxiSlots: cfg.taxiSlots,
    devySlots: cfg.devySlots,
    taxiRookieOnly: cfg.taxiRookieOnly,
    devyGradBehavior: cfg.devyGradBehavior,
  }

  const o = await openaiChatText({
    messages: [
      {
        role: 'system',
        content: `${CHIMMY_DEVY} You are Chimmy, commissioner co-pilot. Never reveal private trade talks. Label projections clearly.`,
      },
      {
        role: 'user',
        content: `League settings JSON: ${JSON.stringify(summary)}\n\nCommissioner question: ${message}`,
      },
    ],
    maxTokens: 900,
    temperature: 0.45,
  })

  return { reply: o.ok && o.text?.trim() ? o.text.trim() : 'Chimmy could not reach the AI provider — try again shortly.' }
}

export async function generateLeagueConstitution(leagueId: string): Promise<string> {
  await requireAfSub()

  const cfg = await prisma.devyLeague.findUnique({ where: { leagueId } })
  if (!cfg) throw new Error('Devy league not configured')

  const o = await openaiChatText({
    messages: [
      {
        role: 'system',
        content: CHIMMY_DEVY + ' Produce a structured league constitution markdown with sections: Roster, Taxi, Devy, Drafts, Trades/Waivers (placeholder), Playoffs (placeholder).',
      },
      {
        role: 'user',
        content: `Generate constitution from settings: ${JSON.stringify(cfg)}`,
      },
    ],
    maxTokens: 2000,
    temperature: 0.35,
  })

  if (o.ok && o.text?.trim()) return o.text.trim()

  return `# ${leagueId} — Devy League Constitution (draft)\n\n## Roster\n- Active: ${cfg.activeRosterSize}, Bench: ${cfg.benchSlots}, IR: ${cfg.irSlots}\n\n## Taxi\n- Slots: ${cfg.taxiSlots}\n\n## Devy\n- Slots: ${cfg.devySlots}, Max per team: ${cfg.maxDevyPerTeam}\n`
}

export async function generateAnnualTransitionReport(leagueId: string, season: number): Promise<string> {
  await requireAfSub()

  const transitions = await prisma.devyRookieTransition.findMany({
    where: { leagueId, nflEntryYear: season },
    take: 50,
  })

  const o = await openaiChatText({
    messages: [
      { role: 'system', content: CHIMMY_DEVY },
      {
        role: 'user',
        content: `Write an end-of-season transition report for season ${season}. Transition rows: ${JSON.stringify(
          transitions.map(t => ({ player: t.playerName, dest: t.destinationState, method: t.nflEntryMethod })),
        )}`,
      },
    ],
    maxTokens: 1500,
    temperature: 0.4,
  })

  return o.ok && o.text?.trim()
    ? o.text.trim()
    : `Annual transition report (${season}): ${transitions.length} transition records on file.`
}

// ─── Draft AI ───────────────────────────────────────────────────────────

export async function getDraftStrategyAdvice(
  leagueId: string,
  _managerId: string,
  draftType: string,
  currentPick: number,
  rostersState: DevyPlayerState[],
): Promise<DraftStrategyResponse> {
  await requireAfSub()

  const needs = [...new Set(rostersState.map(r => r.position))].join(', ')
  const o = await openaiChatText({
    messages: [
      { role: 'system', content: CHIMMY_DEVY },
      {
        role: 'user',
        content: `Draft type: ${draftType}. Current overall pick: ${currentPick}. Positions on roster sample: ${needs}.\nGive: (1) one-line recommendation (2) three top option archetypes (3) risk (4) verdict.`,
      },
    ],
    maxTokens: 600,
    temperature: 0.45,
  })

  const text = o.ok ? o.text ?? '' : 'Draft advice unavailable (AI provider).'
  return {
    recommendation: text.split('\n')[0] ?? text,
    topOptions: ['Best player available', 'Positional scarcity play', 'Devy upside swing'],
    risk: 'League-specific trade market unknown.',
    verdict: text,
  }
}

export function getDevyChimmyHelpText(): string {
  return [
    '🤖 Chimmy — Devy commands',
    '• `@chimmy devy rules` — devy rules (free)',
    '• `@chimmy taxi rules` — taxi rules (free)',
    '• `@chimmy draft format` — startup/future draft format (free)',
    '• `@chimmy rookie transition` — pending devy→NFL transitions for you (free)',
    '• `@chimmy evaluate prospect <name>` — AfSub',
    '• `@chimmy devy rankings [position?]` — AfSub',
    '• `@chimmy import summary` — commissioner, AfSub',
    '• `@chimmy help` — this list',
  ].join('\n')
}

/** Resolve commissioner for import summary command */
export async function assertCommissioner(leagueId: string, userId: string): Promise<void> {
  const role = await getLeagueRole(leagueId, userId)
  if (role !== 'commissioner' && role !== 'co_commissioner') {
    throw new Error('Commissioner or co-commissioner only.')
  }
}
