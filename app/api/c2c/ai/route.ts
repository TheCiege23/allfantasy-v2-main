import { NextRequest, NextResponse } from 'next/server'
import { assertLeagueMember } from '@/lib/league/league-access'
import { requireAfSub } from '@/lib/redraft/ai/requireAfSub'
import { getLeagueRole } from '@/lib/league/permissions'
import {
  buildC2CAiCacheContextSummary,
  getC2CSetupRecommendation,
  evaluateCampusPlayer,
  getCampusRankings,
  getBreakoutCampusAlerts,
  getRosterBalanceAnalysis,
  getShouldITransitionAnalysis,
  getDraftAdvice,
  handleC2CCommissionerQuery,
  generateC2CConstitution,
  generateWeeklyC2CRecap,
} from '@/lib/c2c/ai/c2cChimmy'
import { prisma } from '@/lib/prisma'
import type { C2CPlayerState } from '@prisma/client'
import {
  buildAiCacheKey,
  createSmokeAiResult,
  isAiResultCacheSmokeProviderEnabled,
  readAiResultCache,
  writeAiResultCache,
} from '@/lib/ai-result-cache'

export const dynamic = 'force-dynamic'
export const maxDuration = 30
const C2C_AI_CACHE_TTL_MS = 30 * 60 * 1000

export async function POST(req: NextRequest) {
  const gate = await requireAfSub()
  if (gate instanceof NextResponse) return gate
  const userId = gate

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const action = typeof body.action === 'string' ? body.action : ''
  const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : ''

  if (action !== 'setup_rec' && leagueId) {
    const g = await assertLeagueMember(leagueId, userId)
    if (!g.ok) return NextResponse.json({ error: 'Forbidden' }, { status: g.status })
  }

  const smokeProviderEnabled = isAiResultCacheSmokeProviderEnabled()

  try {
    switch (action) {
      case 'setup_rec': {
        const sportPair = typeof body.sportPair === 'string' ? body.sportPair : 'NFL_CFB'
        const teamCount = typeof body.teamCount === 'number' ? body.teamCount : 12
        const experience = typeof body.experience === 'string' ? body.experience : 'mixed'
        const cacheInputs = {
          action,
          userId,
          sportPair,
          teamCount,
          experience,
          contextSummary: await buildC2CAiCacheContextSummary({
            sportPair,
            teamCount,
            experience,
          }),
        }
        const { resultKey, inputHash } = buildAiCacheKey('c2c-chimmy', cacheInputs)
        const cached = await readAiResultCache(resultKey)
        if (cached?.resultJson && typeof cached.resultJson === 'object') {
          return NextResponse.json(cached.resultJson)
        }

        if (smokeProviderEnabled) {
          const smoke = createSmokeAiResult({
            feature: 'c2c-chimmy',
            route: '/api/c2c/ai',
            input: cacheInputs,
          })
          const smokePayload = {
            rec: {
              scoringMode: 'combined_total',
              draftFormat: 'combined_total',
              reasonings: [smoke.text],
              warnings: ['Smoke provider response: verify against live AI before publishing.'],
            },
          }
          await writeAiResultCache({
            resultKey,
            inputHash,
            feature: 'c2c-chimmy',
            scopeType: 'global',
            scopeId: null,
            provider: 'smoke-provider',
            model: 'smoke-provider',
            inputJson: cacheInputs,
            resultJson: smokePayload,
            ttlMs: C2C_AI_CACHE_TTL_MS,
          })
          return NextResponse.json(smokePayload)
        }

        const rec = await getC2CSetupRecommendation(sportPair, teamCount, experience)
        const responsePayload = { rec }
        writeAiResultCache({
          resultKey,
          inputHash,
          feature: 'c2c-chimmy',
          scopeType: 'global',
          scopeId: null,
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputJson: cacheInputs,
          resultJson: responsePayload,
          ttlMs: C2C_AI_CACHE_TTL_MS,
        }).catch(() => undefined)
        return NextResponse.json(responsePayload)
      }
      case 'campus_eval': {
        const managerId = typeof body.managerId === 'string' ? body.managerId : userId
        const playerId = typeof body.playerId === 'string' ? body.playerId : ''
        if (!leagueId || !playerId) return NextResponse.json({ error: 'leagueId and playerId required' }, { status: 400 })
        const cacheInputs = {
          action,
          leagueId,
          userId,
          managerId,
          playerId,
          contextSummary: await buildC2CAiCacheContextSummary({
            leagueId,
            managerId,
            playerId,
          }),
        }
        const { resultKey, inputHash } = buildAiCacheKey('c2c-chimmy', cacheInputs)
        const cached = await readAiResultCache(resultKey)
        if (cached?.resultJson && typeof cached.resultJson === 'object') {
          return NextResponse.json(cached.resultJson)
        }

        if (smokeProviderEnabled) {
          const smoke = createSmokeAiResult({
            feature: 'c2c-chimmy',
            leagueId,
            route: '/api/c2c/ai',
            input: cacheInputs,
          })
          const smokePayload = {
            eval: {
              campusGrade: 'B - Smoke estimate',
              cantonProjection: 'Developmental projection; verify with live model.',
              startRec: 'bench',
              declarationRisk: 'medium - smoke provider fallback',
              holdRecommendation: 'Hold until live AI is available.',
              verdict: smoke.text,
            },
          }
          await writeAiResultCache({
            resultKey,
            inputHash,
            feature: 'c2c-chimmy',
            scopeType: 'league',
            scopeId: leagueId,
            provider: 'smoke-provider',
            model: 'smoke-provider',
            inputJson: cacheInputs,
            resultJson: smokePayload,
            ttlMs: C2C_AI_CACHE_TTL_MS,
          })
          return NextResponse.json(smokePayload)
        }

        const ev = await evaluateCampusPlayer(leagueId, managerId, playerId)
        const responsePayload = { eval: ev }
        writeAiResultCache({
          resultKey,
          inputHash,
          feature: 'c2c-chimmy',
          scopeType: 'league',
          scopeId: leagueId,
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputJson: cacheInputs,
          resultJson: responsePayload,
          ttlMs: C2C_AI_CACHE_TTL_MS,
        }).catch(() => undefined)
        return NextResponse.json(responsePayload)
      }
      case 'campus_rankings': {
        const position = typeof body.position === 'string' ? body.position : undefined
        const sportPair = typeof body.sportPair === 'string' ? body.sportPair : undefined
        if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
        const list = await getCampusRankings(leagueId, position, sportPair)
        return NextResponse.json({ rankings: list })
      }
      case 'breakout_alerts': {
        if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
        const alerts = await getBreakoutCampusAlerts(leagueId)
        return NextResponse.json({ alerts })
      }
      case 'roster_balance': {
        const managerId = typeof body.managerId === 'string' ? body.managerId : userId
        if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
        const report = await getRosterBalanceAnalysis(leagueId, managerId)
        return NextResponse.json({ report })
      }
      case 'transition_advice': {
        const managerId = typeof body.managerId === 'string' ? body.managerId : userId
        const playerId = typeof body.playerId === 'string' ? body.playerId : ''
        if (!leagueId || !playerId) return NextResponse.json({ error: 'leagueId and playerId required' }, { status: 400 })
        const cacheInputs = {
          action,
          leagueId,
          userId,
          managerId,
          playerId,
          contextSummary: await buildC2CAiCacheContextSummary({
            leagueId,
            managerId,
            playerId,
          }),
        }
        const { resultKey, inputHash } = buildAiCacheKey('c2c-chimmy', cacheInputs)
        const cached = await readAiResultCache(resultKey)
        if (cached?.resultJson && typeof cached.resultJson === 'object') {
          return NextResponse.json(cached.resultJson)
        }

        if (smokeProviderEnabled) {
          const smoke = createSmokeAiResult({
            feature: 'c2c-chimmy',
            leagueId,
            route: '/api/c2c/ai',
            input: cacheInputs,
          })
          const smokePayload = {
            transition: {
              recommendation: 'hold',
              timing: 'Smoke fallback: wait for declaration clarity.',
              targetCantonSlot: 'Bench/taxi',
              campusValueLost: 'Campus-side immediate points',
              cantonValueGained: 'Long-term upside',
              verdict: smoke.text,
            },
          }
          await writeAiResultCache({
            resultKey,
            inputHash,
            feature: 'c2c-chimmy',
            scopeType: 'league',
            scopeId: leagueId,
            provider: 'smoke-provider',
            model: 'smoke-provider',
            inputJson: cacheInputs,
            resultJson: smokePayload,
            ttlMs: C2C_AI_CACHE_TTL_MS,
          })
          return NextResponse.json(smokePayload)
        }

        const t = await getShouldITransitionAnalysis(leagueId, managerId, playerId)
        const responsePayload = { transition: t }
        writeAiResultCache({
          resultKey,
          inputHash,
          feature: 'c2c-chimmy',
          scopeType: 'league',
          scopeId: leagueId,
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputJson: cacheInputs,
          resultJson: responsePayload,
          ttlMs: C2C_AI_CACHE_TTL_MS,
        }).catch(() => undefined)
        return NextResponse.json(responsePayload)
      }
      case 'draft_advice': {
        const managerId = typeof body.managerId === 'string' ? body.managerId : userId
        const draftType = typeof body.draftType === 'string' ? body.draftType : 'combined'
        const pickNumber = typeof body.pickNumber === 'number' ? body.pickNumber : 1
        if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
        const rosterId =
          typeof body.rosterId === 'string'
            ? body.rosterId
            : (
                await prisma.redraftRoster.findFirst({
                  where: { leagueId, ownerId: managerId },
                  select: { id: true },
                })
              )?.id
        const states: C2CPlayerState[] = rosterId
          ? await prisma.c2CPlayerState.findMany({ where: { leagueId, rosterId } })
          : []
        const cacheInputs = {
          action,
          leagueId,
          userId,
          managerId,
          draftType,
          pickNumber,
          rosterId: rosterId ?? null,
          rosterStateSummary: states
            .map((row) => `${row.playerId}:${row.playerSide}:${row.bucketState}:${row.position}`)
            .sort(),
          contextSummary: await buildC2CAiCacheContextSummary({
            leagueId,
            managerId,
            draftType,
            pickNumber,
          }),
        }
        const { resultKey, inputHash } = buildAiCacheKey('c2c-chimmy', cacheInputs)
        const cached = await readAiResultCache(resultKey)
        if (cached?.resultJson && typeof cached.resultJson === 'object') {
          return NextResponse.json(cached.resultJson)
        }

        if (smokeProviderEnabled) {
          const smoke = createSmokeAiResult({
            feature: 'c2c-chimmy',
            leagueId,
            route: '/api/c2c/ai',
            input: cacheInputs,
          })
          const smokePayload = {
            advice: {
              topOptions: ['Smoke campus upside play', 'Smoke canton floor play', 'Smoke balanced selection'],
              recommendation: smoke.text,
              tierBreakAlert: 'Smoke fallback: validate tier breaks against live board.',
              reasoning: 'Smoke provider fallback response.',
              sideBalance: 'Target your weaker side this round.',
            },
          }
          await writeAiResultCache({
            resultKey,
            inputHash,
            feature: 'c2c-chimmy',
            scopeType: 'league',
            scopeId: leagueId,
            provider: 'smoke-provider',
            model: 'smoke-provider',
            inputJson: cacheInputs,
            resultJson: smokePayload,
            ttlMs: C2C_AI_CACHE_TTL_MS,
          })
          return NextResponse.json(smokePayload)
        }

        const advice = await getDraftAdvice(leagueId, managerId, draftType, pickNumber, states)
        const responsePayload = { advice }
        writeAiResultCache({
          resultKey,
          inputHash,
          feature: 'c2c-chimmy',
          scopeType: 'league',
          scopeId: leagueId,
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputJson: cacheInputs,
          resultJson: responsePayload,
          ttlMs: C2C_AI_CACHE_TTL_MS,
        }).catch(() => undefined)
        return NextResponse.json(responsePayload)
      }
      case 'commissioner_chat': {
        const msg = typeof body.message === 'string' ? body.message : ''
        if (!leagueId || !msg.trim()) return NextResponse.json({ error: 'leagueId and message required' }, { status: 400 })
        const role = await getLeagueRole(leagueId, userId)
        if (role !== 'commissioner' && role !== 'co_commissioner') {
          return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
        }
        const cacheInputs = {
          action,
          leagueId,
          userId,
          message: msg.trim().toLowerCase(),
          role,
          contextSummary: await buildC2CAiCacheContextSummary({ leagueId }),
        }
        const { resultKey, inputHash } = buildAiCacheKey('c2c-chimmy', cacheInputs)
        const cached = await readAiResultCache(resultKey)
        if (cached?.resultJson && typeof cached.resultJson === 'object') {
          return NextResponse.json(cached.resultJson)
        }

        if (smokeProviderEnabled) {
          const smoke = createSmokeAiResult({
            feature: 'c2c-chimmy',
            leagueId,
            route: '/api/c2c/ai',
            input: cacheInputs,
          })
          const smokePayload = { reply: smoke.text }
          await writeAiResultCache({
            resultKey,
            inputHash,
            feature: 'c2c-chimmy',
            scopeType: 'league',
            scopeId: leagueId,
            provider: 'smoke-provider',
            model: 'smoke-provider',
            inputJson: cacheInputs,
            resultJson: smokePayload,
            ttlMs: C2C_AI_CACHE_TTL_MS,
          })
          return NextResponse.json(smokePayload)
        }

        const r = await handleC2CCommissionerQuery(leagueId, msg)
        writeAiResultCache({
          resultKey,
          inputHash,
          feature: 'c2c-chimmy',
          scopeType: 'league',
          scopeId: leagueId,
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputJson: cacheInputs,
          resultJson: r,
          ttlMs: C2C_AI_CACHE_TTL_MS,
        }).catch(() => undefined)
        return NextResponse.json(r)
      }
      case 'constitution': {
        if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
        const cacheInputs = {
          action,
          leagueId,
          userId,
          contextSummary: await buildC2CAiCacheContextSummary({ leagueId }),
        }
        const { resultKey, inputHash } = buildAiCacheKey('c2c-chimmy', cacheInputs)
        const cached = await readAiResultCache(resultKey)
        if (cached?.resultJson && typeof cached.resultJson === 'object') {
          return NextResponse.json(cached.resultJson)
        }

        if (smokeProviderEnabled) {
          const smoke = createSmokeAiResult({
            feature: 'c2c-chimmy',
            leagueId,
            route: '/api/c2c/ai',
            input: cacheInputs,
          })
          const smokePayload = { constitution: smoke.text }
          await writeAiResultCache({
            resultKey,
            inputHash,
            feature: 'c2c-chimmy',
            scopeType: 'league',
            scopeId: leagueId,
            provider: 'smoke-provider',
            model: 'smoke-provider',
            inputJson: cacheInputs,
            resultJson: smokePayload,
            ttlMs: C2C_AI_CACHE_TTL_MS,
          })
          return NextResponse.json(smokePayload)
        }

        const text = await generateC2CConstitution(leagueId)
        const responsePayload = { constitution: text }
        writeAiResultCache({
          resultKey,
          inputHash,
          feature: 'c2c-chimmy',
          scopeType: 'league',
          scopeId: leagueId,
          provider: 'openai',
          model: 'gpt-4o-mini',
          inputJson: cacheInputs,
          resultJson: responsePayload,
          ttlMs: C2C_AI_CACHE_TTL_MS,
        }).catch(() => undefined)
        return NextResponse.json(responsePayload)
      }
      case 'weekly_recap': {
        const week = typeof body.week === 'number' ? body.week : 1
        if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
        // Read finalized matchup evidence on every request so a correction cannot leave a stale recap.
        if (!smokeProviderEnabled) return NextResponse.json({ recap: await generateWeeklyC2CRecap(leagueId, week) })
        const cacheInputs = {
          action,
          leagueId,
          userId,
          week,
          contextSummary: await buildC2CAiCacheContextSummary({ leagueId, week }),
        }
        const { resultKey, inputHash } = buildAiCacheKey('c2c-chimmy', cacheInputs)
        const cached = await readAiResultCache(resultKey)
        if (cached?.resultJson && typeof cached.resultJson === 'object') {
          return NextResponse.json(cached.resultJson)
        }

        if (smokeProviderEnabled) {
          const smoke = createSmokeAiResult({
            feature: 'c2c-chimmy',
            leagueId,
            route: '/api/c2c/ai',
            input: cacheInputs,
          })
          const smokePayload = { recap: smoke.text }
          await writeAiResultCache({
            resultKey,
            inputHash,
            feature: 'c2c-chimmy',
            scopeType: 'league',
            scopeId: leagueId,
            provider: 'smoke-provider',
            model: 'smoke-provider',
            inputJson: cacheInputs,
            resultJson: smokePayload,
            ttlMs: C2C_AI_CACHE_TTL_MS,
          })
          return NextResponse.json(smokePayload)
        }

        throw new Error('Recap smoke provider unavailable')
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
