import { assertCommissionerAccess, canCommissionerAct } from '@/lib/league/commissionerAccess'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAfSub } from '@/lib/redraft/ai/requireAfSub'
import { requireMemberPlayerAiOrHostGate } from '@/lib/subscription/memberPlayerAiGate'
import { assertLeagueMember } from '@/lib/league/league-access'
import { buildDevyAiCacheContextSummary, generateAnnualTransitionReport, generateImportSummary, generateLeagueConstitution, getBreakoutAlerts, getDraftStrategyAdvice, getDevyRankings, getPipelineHealthAnalysis, getSetupRecommendation, getShouldIPromoteAnalysis, handleCommissionerQuery, suggestPlayerMatches, evaluateDevyProspect } from '@/lib/devy/ai/devyChimmy'
import {
  buildAiCacheKey,
  createSmokeAiResult,
  isAiResultCacheSmokeProviderEnabled,
  readAiResultCache,
  writeAiResultCache,
} from '@/lib/ai-result-cache'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
const DEVY_CHIMMY_CACHE_TTL_MS = 30 * 60 * 1000

type Body = Record<string, unknown>

/** Actions a league MEMBER runs on their own player (DevyPlayerModal). Gated on `af_intelligence`. */
const DEVY_MEMBER_PLAYER_AI_ACTIONS: ReadonlySet<string> = new Set(['prospect_eval'])

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

export async function POST(req: NextRequest) {
  const raw = (await req.json().catch(() => null)) as Body | null
  const body: Body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const action = str(body.action)

  // The member player-AI action (DevyPlayerModal's prospect read) is AF Intelligence — Pro, Commissioner,
  // Supreme — with no commissioner requirement (owner, 2026-11-28). Every host/league tool keeps the
  // Commissioner AI gate. Either way the gate runs before any model call.
  const gate = await requireMemberPlayerAiOrHostGate(action, DEVY_MEMBER_PLAYER_AI_ACTIONS, requireAfSub)
  if (typeof gate !== 'string') return gate
  const userId = gate

  if (!action) {
    return NextResponse.json({ error: 'action required' }, { status: 400 })
  }

  const smokeProviderEnabled = isAiResultCacheSmokeProviderEnabled()

  try {
    switch (action) {
      case 'setup_recommendation': {
        const teamCount = num(body.teamCount) ?? 12
        const leagueExperience = str(body.experience) || str(body.leagueExperience) || 'mixed'
        const managerFamiliarity = str(body.managerFamiliarity) || 'mixed'
        const cacheInputs = {
          action,
          userId,
          teamCount,
          leagueExperience,
          managerFamiliarity,
          contextSummary: await buildDevyAiCacheContextSummary({
            teamCount,
            leagueExperience,
            managerFamiliarity,
          }),
        }
        const { resultKey, inputHash } = buildAiCacheKey('devy-chimmy', cacheInputs)
        const cached = await readAiResultCache(resultKey)
        if (cached?.resultJson && typeof cached.resultJson === 'object') {
          return NextResponse.json(cached.resultJson)
        }
        if (smokeProviderEnabled) {
          const smoke = createSmokeAiResult({
            feature: 'devy-chimmy',
            route: '/api/devy/ai',
            input: cacheInputs,
          })
          const smokePayload = {
            startupFormat: 'combined',
            futureDraftFormat: 'combined',
            taxiSlots: 5,
            devySlots: 10,
            reasoning: smoke.text,
            prosCons: ['Smoke provider fallback output.'],
            warnings: ['Verify live Devy Chimmy output before publishing settings guidance.'],
          }
          await writeAiResultCache({
            resultKey,
            inputHash,
            feature: 'devy-chimmy',
            scopeType: 'global',
            scopeId: null,
            provider: 'smoke-provider',
            model: 'smoke-provider',
            inputJson: cacheInputs,
            resultJson: smokePayload,
            ttlMs: DEVY_CHIMMY_CACHE_TTL_MS,
          })
          return NextResponse.json(smokePayload)
        }
        const data = await getSetupRecommendation(teamCount, leagueExperience, managerFamiliarity)
        writeAiResultCache({
          resultKey,
          inputHash,
          feature: 'devy-chimmy',
          scopeType: 'global',
          scopeId: null,
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputJson: cacheInputs,
          resultJson: data,
          ttlMs: DEVY_CHIMMY_CACHE_TTL_MS,
        }).catch(() => undefined)
        return NextResponse.json(data)
      }

      case 'pipeline_health': {
        const leagueId = str(body.leagueId)
        const managerId = str(body.managerId) || userId
        const rosterId = str(body.rosterId)
        if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
        const m = await assertLeagueMember(leagueId, userId)
        if (!m.ok) return NextResponse.json({ error: 'Forbidden' }, { status: m.status })
        if (managerId !== userId && !(await canCommissionerAct(leagueId, userId, 'league'))) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
        let rid = rosterId
        if (!rid) {
          const season = await prisma.redraftSeason.findFirst({
            where: { leagueId },
            orderBy: { season: 'desc' },
            select: { id: true },
          })
          if (!season) return NextResponse.json({ error: 'No season' }, { status: 404 })
          const rr = await prisma.redraftRoster.findFirst({
            where: { seasonId: season.id, ownerId: managerId },
            select: { id: true },
          })
          rid = rr?.id ?? ''
        }
        if (!rid) return NextResponse.json({ error: 'rosterId required' }, { status: 400 })
        const cacheInputs = {
          action,
          leagueId,
          userId,
          managerId,
          rosterId: rid,
          contextSummary: await buildDevyAiCacheContextSummary({
            leagueId,
            managerId,
            rosterId: rid,
          }),
        }
        const { resultKey, inputHash } = buildAiCacheKey('devy-chimmy', cacheInputs)
        const cached = await readAiResultCache(resultKey)
        if (cached?.resultJson && typeof cached.resultJson === 'object') {
          return NextResponse.json(cached.resultJson)
        }
        if (smokeProviderEnabled) {
          const smoke = createSmokeAiResult({
            feature: 'devy-chimmy',
            leagueId,
            route: '/api/devy/ai',
            input: cacheInputs,
          })
          const smokePayload = {
            mode: 'balanced',
            pipelineScore: 50,
            concerns: ['Smoke provider fallback output.'],
            recommendations: [smoke.text],
          }
          await writeAiResultCache({
            resultKey,
            inputHash,
            feature: 'devy-chimmy',
            scopeType: 'league',
            scopeId: leagueId,
            provider: 'smoke-provider',
            model: 'smoke-provider',
            inputJson: cacheInputs,
            resultJson: smokePayload,
            ttlMs: DEVY_CHIMMY_CACHE_TTL_MS,
          })
          return NextResponse.json(smokePayload)
        }
        const data = await getPipelineHealthAnalysis(leagueId, rid)
        writeAiResultCache({
          resultKey,
          inputHash,
          feature: 'devy-chimmy',
          scopeType: 'league',
          scopeId: leagueId,
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputJson: cacheInputs,
          resultJson: data,
          ttlMs: DEVY_CHIMMY_CACHE_TTL_MS,
        }).catch(() => undefined)
        return NextResponse.json(data)
      }

      case 'prospect_eval': {
        const leagueId = str(body.leagueId)
        const managerId = str(body.managerId) || userId
        const playerId = str(body.playerId)
        if (!leagueId || !playerId) {
          return NextResponse.json({ error: 'leagueId and playerId required' }, { status: 400 })
        }
        const m = await assertLeagueMember(leagueId, userId)
        if (!m.ok) return NextResponse.json({ error: 'Forbidden' }, { status: m.status })
        if (managerId !== userId) {
          return NextResponse.json({ error: 'Can only evaluate for your own roster' }, { status: 403 })
        }
        const season = await prisma.redraftSeason.findFirst({
          where: { leagueId },
          orderBy: { season: 'desc' },
          select: { id: true },
        })
        if (!season) return NextResponse.json({ error: 'No season' }, { status: 404 })
        const rr = await prisma.redraftRoster.findFirst({
          where: { seasonId: season.id, ownerId: managerId },
          select: { id: true },
        })
        if (!rr) return NextResponse.json({ error: 'Roster not found' }, { status: 404 })
        const managerRoster = await prisma.devyPlayerState.findMany({
          where: { leagueId, rosterId: rr.id },
        })
        const cacheInputs = {
          action,
          leagueId,
          userId,
          managerId,
          rosterId: rr.id,
          playerId,
          rosterStateSummary: managerRoster
            .map((row) => `${row.playerId}:${row.position}:${row.bucketState}`)
            .sort(),
          contextSummary: await buildDevyAiCacheContextSummary({
            leagueId,
            managerId,
            rosterId: rr.id,
            playerId,
          }),
        }
        const { resultKey, inputHash } = buildAiCacheKey('devy-chimmy', cacheInputs)
        const cached = await readAiResultCache(resultKey)
        if (cached?.resultJson && typeof cached.resultJson === 'object') {
          return NextResponse.json(cached.resultJson)
        }
        if (smokeProviderEnabled) {
          const smoke = createSmokeAiResult({
            feature: 'devy-chimmy',
            leagueId,
            route: '/api/devy/ai',
            input: cacheInputs,
          })
          const smokePayload = {
            ceiling: 'medium (smoke fallback)',
            timeline: 'Verify with live provider.',
            fit: 'Roster fit requires live Chimmy confirmation.',
            grade: 'B',
            risks: ['Smoke provider fallback output.'],
            verdict: smoke.text,
          }
          await writeAiResultCache({
            resultKey,
            inputHash,
            feature: 'devy-chimmy',
            scopeType: 'league',
            scopeId: leagueId,
            provider: 'smoke-provider',
            model: 'smoke-provider',
            inputJson: cacheInputs,
            resultJson: smokePayload,
            ttlMs: DEVY_CHIMMY_CACHE_TTL_MS,
          })
          return NextResponse.json(smokePayload)
        }
        const data = await evaluateDevyProspect(playerId, leagueId, managerRoster)
        writeAiResultCache({
          resultKey,
          inputHash,
          feature: 'devy-chimmy',
          scopeType: 'league',
          scopeId: leagueId,
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputJson: cacheInputs,
          resultJson: data,
          ttlMs: DEVY_CHIMMY_CACHE_TTL_MS,
        }).catch(() => undefined)
        return NextResponse.json(data)
      }

      case 'devy_rankings': {
        const leagueId = str(body.leagueId)
        const position = str(body.position) || undefined
        const classFilter = str(body.classFilter) || undefined
        if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
        const m = await assertLeagueMember(leagueId, userId)
        if (!m.ok) return NextResponse.json({ error: 'Forbidden' }, { status: m.status })
        const cacheInputs = {
          action,
          leagueId,
          userId,
          position: position ?? null,
          classFilter: classFilter ?? null,
          contextSummary: await buildDevyAiCacheContextSummary({
            leagueId,
            position: position ?? null,
            classFilter: classFilter ?? null,
          }),
        }
        const { resultKey, inputHash } = buildAiCacheKey('devy-chimmy', cacheInputs)
        const cached = await readAiResultCache(resultKey)
        if (cached?.resultJson && typeof cached.resultJson === 'object') {
          return NextResponse.json(cached.resultJson)
        }
        if (smokeProviderEnabled) {
          const smoke = createSmokeAiResult({
            feature: 'devy-chimmy',
            leagueId,
            route: '/api/devy/ai',
            input: cacheInputs,
          })
          const smokePayload = {
            positionFilter: position,
            classFilter,
            entries: [
              {
                rank: 1,
                name: 'Smoke Prospect',
                school: null,
                classYear: null,
                grade: 'B',
                note: smoke.text,
              },
            ],
          }
          await writeAiResultCache({
            resultKey,
            inputHash,
            feature: 'devy-chimmy',
            scopeType: 'league',
            scopeId: leagueId,
            provider: 'smoke-provider',
            model: 'smoke-provider',
            inputJson: cacheInputs,
            resultJson: smokePayload,
            ttlMs: DEVY_CHIMMY_CACHE_TTL_MS,
          })
          return NextResponse.json(smokePayload)
        }
        const data = await getDevyRankings(leagueId, position, classFilter)
        writeAiResultCache({
          resultKey,
          inputHash,
          feature: 'devy-chimmy',
          scopeType: 'league',
          scopeId: leagueId,
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputJson: cacheInputs,
          resultJson: data,
          ttlMs: DEVY_CHIMMY_CACHE_TTL_MS,
        }).catch(() => undefined)
        return NextResponse.json(data)
      }

      case 'breakout_alerts': {
        const leagueId = str(body.leagueId)
        if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
        const m = await assertLeagueMember(leagueId, userId)
        if (!m.ok) return NextResponse.json({ error: 'Forbidden' }, { status: m.status })
        const data = await getBreakoutAlerts(leagueId)
        return NextResponse.json({ data })
      }

      case 'should_promote': {
        const leagueId = str(body.leagueId)
        const managerId = str(body.managerId) || userId
        const playerId = str(body.playerId)
        if (!leagueId || !playerId) {
          return NextResponse.json({ error: 'leagueId and playerId required' }, { status: 400 })
        }
        const mem = await assertLeagueMember(leagueId, userId)
        if (!mem.ok) return NextResponse.json({ error: 'Forbidden' }, { status: mem.status })
        if (managerId !== userId) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
        const season = await prisma.redraftSeason.findFirst({
          where: { leagueId },
          orderBy: { season: 'desc' },
          select: { id: true },
        })
        if (!season) return NextResponse.json({ error: 'No season' }, { status: 404 })
        const rr = await prisma.redraftRoster.findFirst({
          where: { seasonId: season.id, ownerId: managerId },
          select: { id: true },
        })
        if (!rr) return NextResponse.json({ error: 'Roster not found' }, { status: 404 })
        const cacheInputs = {
          action,
          leagueId,
          userId,
          managerId,
          rosterId: rr.id,
          playerId,
          contextSummary: await buildDevyAiCacheContextSummary({
            leagueId,
            managerId,
            rosterId: rr.id,
            playerId,
          }),
        }
        const { resultKey, inputHash } = buildAiCacheKey('devy-chimmy', cacheInputs)
        const cached = await readAiResultCache(resultKey)
        if (cached?.resultJson && typeof cached.resultJson === 'object') {
          return NextResponse.json(cached.resultJson)
        }
        if (smokeProviderEnabled) {
          const smoke = createSmokeAiResult({
            feature: 'devy-chimmy',
            leagueId,
            route: '/api/devy/ai',
            input: cacheInputs,
          })
          const smokePayload = {
            recommendation: 'wait',
            confidence: 0.5,
            reasoning: smoke.text,
            risk: 'Smoke provider fallback output.',
          }
          await writeAiResultCache({
            resultKey,
            inputHash,
            feature: 'devy-chimmy',
            scopeType: 'league',
            scopeId: leagueId,
            provider: 'smoke-provider',
            model: 'smoke-provider',
            inputJson: cacheInputs,
            resultJson: smokePayload,
            ttlMs: DEVY_CHIMMY_CACHE_TTL_MS,
          })
          return NextResponse.json(smokePayload)
        }
        const data = await getShouldIPromoteAnalysis(leagueId, rr.id, playerId)
        writeAiResultCache({
          resultKey,
          inputHash,
          feature: 'devy-chimmy',
          scopeType: 'league',
          scopeId: leagueId,
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputJson: cacheInputs,
          resultJson: data,
          ttlMs: DEVY_CHIMMY_CACHE_TTL_MS,
        }).catch(() => undefined)
        return NextResponse.json(data)
      }

      case 'suggest_matches': {
        const sessionId = str(body.sessionId)
        if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
        const row = await prisma.devyImportSession.findFirst({ where: { id: sessionId } })
        if (!row) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
        const g = await assertLeagueMember(row.leagueId, userId)
        if (!g.ok) return NextResponse.json({ error: 'Forbidden' }, { status: g.status })
        const data = await suggestPlayerMatches(sessionId, [])
        return NextResponse.json({ suggestions: data })
      }

      case 'import_summary': {
        const sessionId = str(body.sessionId)
        if (!sessionId) return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
        const row = await prisma.devyImportSession.findFirst({ where: { id: sessionId } })
        if (!row) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
        const g = await assertLeagueMember(row.leagueId, userId)
        if (!g.ok) return NextResponse.json({ error: 'Forbidden' }, { status: g.status })
        await assertCommissionerAccess(row.leagueId, userId, 'league')
        const cacheInputs = {
          action,
          leagueId: row.leagueId,
          userId,
          sessionId,
          contextSummary: await buildDevyAiCacheContextSummary({
            leagueId: row.leagueId,
            sessionId,
          }),
        }
        const { resultKey, inputHash } = buildAiCacheKey('devy-chimmy', cacheInputs)
        const cached = await readAiResultCache(resultKey)
        if (cached?.resultJson && typeof cached.resultJson === 'object') {
          return NextResponse.json(cached.resultJson)
        }
        if (smokeProviderEnabled) {
          const smoke = createSmokeAiResult({
            feature: 'devy-chimmy',
            leagueId: row.leagueId,
            route: '/api/devy/ai',
            input: cacheInputs,
          })
          const smokePayload = {
            narrative: smoke.text,
            auditConfidence: 'smoke-provider',
          }
          await writeAiResultCache({
            resultKey,
            inputHash,
            feature: 'devy-chimmy',
            scopeType: 'league',
            scopeId: row.leagueId,
            provider: 'smoke-provider',
            model: 'smoke-provider',
            inputJson: cacheInputs,
            resultJson: smokePayload,
            ttlMs: DEVY_CHIMMY_CACHE_TTL_MS,
          })
          return NextResponse.json(smokePayload)
        }
        const data = await generateImportSummary(sessionId)
        writeAiResultCache({
          resultKey,
          inputHash,
          feature: 'devy-chimmy',
          scopeType: 'league',
          scopeId: row.leagueId,
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputJson: cacheInputs,
          resultJson: data,
          ttlMs: DEVY_CHIMMY_CACHE_TTL_MS,
        }).catch(() => undefined)
        return NextResponse.json(data)
      }

      case 'commissioner_chat': {
        const leagueId = str(body.leagueId)
        const message = str(body.message)
        if (!leagueId || !message) {
          return NextResponse.json({ error: 'leagueId and message required' }, { status: 400 })
        }
        const m = await assertLeagueMember(leagueId, userId)
        if (!m.ok) return NextResponse.json({ error: 'Forbidden' }, { status: m.status })
        if (!(await canCommissionerAct(leagueId, userId, 'league'))) {
          return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
        }
        const cacheInputs = {
          action,
          leagueId,
          userId,
          message: message.trim().toLowerCase(),
          contextSummary: await buildDevyAiCacheContextSummary({ leagueId }),
        }
        const { resultKey, inputHash } = buildAiCacheKey('devy-chimmy', cacheInputs)
        const cached = await readAiResultCache(resultKey)
        if (cached?.resultJson && typeof cached.resultJson === 'object') {
          return NextResponse.json(cached.resultJson)
        }
        if (smokeProviderEnabled) {
          const smoke = createSmokeAiResult({
            feature: 'devy-chimmy',
            leagueId,
            route: '/api/devy/ai',
            input: cacheInputs,
          })
          const smokePayload = { reply: smoke.text }
          await writeAiResultCache({
            resultKey,
            inputHash,
            feature: 'devy-chimmy',
            scopeType: 'league',
            scopeId: leagueId,
            provider: 'smoke-provider',
            model: 'smoke-provider',
            inputJson: cacheInputs,
            resultJson: smokePayload,
            ttlMs: DEVY_CHIMMY_CACHE_TTL_MS,
          })
          return NextResponse.json(smokePayload)
        }
        const data = await handleCommissionerQuery(leagueId, userId, message)
        writeAiResultCache({
          resultKey,
          inputHash,
          feature: 'devy-chimmy',
          scopeType: 'league',
          scopeId: leagueId,
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputJson: cacheInputs,
          resultJson: data,
          ttlMs: DEVY_CHIMMY_CACHE_TTL_MS,
        }).catch(() => undefined)
        return NextResponse.json(data)
      }

      case 'constitution': {
        const leagueId = str(body.leagueId)
        if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
        const m = await assertLeagueMember(leagueId, userId)
        if (!m.ok) return NextResponse.json({ error: 'Forbidden' }, { status: m.status })
        const cacheInputs = {
          action,
          leagueId,
          userId,
          contextSummary: await buildDevyAiCacheContextSummary({ leagueId }),
        }
        const { resultKey, inputHash } = buildAiCacheKey('devy-chimmy', cacheInputs)
        const cached = await readAiResultCache(resultKey)
        if (cached?.resultJson && typeof cached.resultJson === 'object') {
          return NextResponse.json(cached.resultJson)
        }
        if (smokeProviderEnabled) {
          const smoke = createSmokeAiResult({
            feature: 'devy-chimmy',
            leagueId,
            route: '/api/devy/ai',
            input: cacheInputs,
          })
          const smokePayload = { text: smoke.text }
          await writeAiResultCache({
            resultKey,
            inputHash,
            feature: 'devy-chimmy',
            scopeType: 'league',
            scopeId: leagueId,
            provider: 'smoke-provider',
            model: 'smoke-provider',
            inputJson: cacheInputs,
            resultJson: smokePayload,
            ttlMs: DEVY_CHIMMY_CACHE_TTL_MS,
          })
          return NextResponse.json(smokePayload)
        }
        const text = await generateLeagueConstitution(leagueId)
        const responsePayload = { text }
        writeAiResultCache({
          resultKey,
          inputHash,
          feature: 'devy-chimmy',
          scopeType: 'league',
          scopeId: leagueId,
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputJson: cacheInputs,
          resultJson: responsePayload,
          ttlMs: DEVY_CHIMMY_CACHE_TTL_MS,
        }).catch(() => undefined)
        return NextResponse.json(responsePayload)
      }

      case 'annual_report': {
        const leagueId = str(body.leagueId)
        const season = num(body.season)
        if (!leagueId || season == null) {
          return NextResponse.json({ error: 'leagueId and season required' }, { status: 400 })
        }
        const m = await assertLeagueMember(leagueId, userId)
        if (!m.ok) return NextResponse.json({ error: 'Forbidden' }, { status: m.status })
        const cacheInputs = {
          action,
          leagueId,
          userId,
          season,
          contextSummary: await buildDevyAiCacheContextSummary({ leagueId, season }),
        }
        const { resultKey, inputHash } = buildAiCacheKey('devy-chimmy', cacheInputs)
        const cached = await readAiResultCache(resultKey)
        if (cached?.resultJson && typeof cached.resultJson === 'object') {
          return NextResponse.json(cached.resultJson)
        }
        if (smokeProviderEnabled) {
          const smoke = createSmokeAiResult({
            feature: 'devy-chimmy',
            leagueId,
            route: '/api/devy/ai',
            input: cacheInputs,
          })
          const smokePayload = { text: smoke.text }
          await writeAiResultCache({
            resultKey,
            inputHash,
            feature: 'devy-chimmy',
            scopeType: 'league',
            scopeId: leagueId,
            provider: 'smoke-provider',
            model: 'smoke-provider',
            inputJson: cacheInputs,
            resultJson: smokePayload,
            ttlMs: DEVY_CHIMMY_CACHE_TTL_MS,
          })
          return NextResponse.json(smokePayload)
        }
        const text = await generateAnnualTransitionReport(leagueId, Math.floor(season))
        const responsePayload = { text }
        writeAiResultCache({
          resultKey,
          inputHash,
          feature: 'devy-chimmy',
          scopeType: 'league',
          scopeId: leagueId,
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputJson: cacheInputs,
          resultJson: responsePayload,
          ttlMs: DEVY_CHIMMY_CACHE_TTL_MS,
        }).catch(() => undefined)
        return NextResponse.json(responsePayload)
      }

      case 'draft_advice': {
        const leagueId = str(body.leagueId)
        const managerId = str(body.managerId) || userId
        const draftType = str(body.draftType) || 'startup'
        const pick = num(body.pick) ?? num(body.currentPick) ?? 1
        if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
        const mem = await assertLeagueMember(leagueId, userId)
        if (!mem.ok) return NextResponse.json({ error: 'Forbidden' }, { status: mem.status })
        if (managerId !== userId) {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
        }
        const season = await prisma.redraftSeason.findFirst({
          where: { leagueId },
          orderBy: { season: 'desc' },
          select: { id: true },
        })
        if (!season) return NextResponse.json({ error: 'No season' }, { status: 404 })
        const rr = await prisma.redraftRoster.findFirst({
          where: { seasonId: season.id, ownerId: managerId },
          select: { id: true },
        })
        if (!rr) return NextResponse.json({ error: 'Roster not found' }, { status: 404 })
        const rostersState = await prisma.devyPlayerState.findMany({ where: { leagueId, rosterId: rr.id } })
        const cacheInputs = {
          action,
          leagueId,
          userId,
          managerId,
          rosterId: rr.id,
          draftType,
          currentPick: pick,
          rosterStateSummary: rostersState
            .map((row) => `${row.playerId}:${row.position}:${row.bucketState}`)
            .sort(),
          contextSummary: await buildDevyAiCacheContextSummary({
            leagueId,
            managerId,
            rosterId: rr.id,
            draftType,
            currentPick: pick,
          }),
        }
        const { resultKey, inputHash } = buildAiCacheKey('devy-chimmy', cacheInputs)
        const cached = await readAiResultCache(resultKey)
        if (cached?.resultJson && typeof cached.resultJson === 'object') {
          return NextResponse.json(cached.resultJson)
        }
        if (smokeProviderEnabled) {
          const smoke = createSmokeAiResult({
            feature: 'devy-chimmy',
            leagueId,
            route: '/api/devy/ai',
            input: cacheInputs,
          })
          const smokePayload = {
            recommendation: smoke.text,
            topOptions: ['Smoke BPA', 'Smoke positional scarcity play', 'Smoke devy upside swing'],
            risk: 'Smoke provider fallback output.',
            verdict: smoke.text,
          }
          await writeAiResultCache({
            resultKey,
            inputHash,
            feature: 'devy-chimmy',
            scopeType: 'league',
            scopeId: leagueId,
            provider: 'smoke-provider',
            model: 'smoke-provider',
            inputJson: cacheInputs,
            resultJson: smokePayload,
            ttlMs: DEVY_CHIMMY_CACHE_TTL_MS,
          })
          return NextResponse.json(smokePayload)
        }
        const data = await getDraftStrategyAdvice(leagueId, managerId, draftType, pick, rostersState)
        writeAiResultCache({
          resultKey,
          inputHash,
          feature: 'devy-chimmy',
          scopeType: 'league',
          scopeId: leagueId,
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputJson: cacheInputs,
          resultJson: data,
          ttlMs: DEVY_CHIMMY_CACHE_TTL_MS,
        }).catch(() => undefined)
        return NextResponse.json(data)
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Server error'
    const code = msg.includes('Commissioner') && msg.includes('only') ? 403 : 500
    return NextResponse.json({ error: msg }, { status: code })
  }
}
