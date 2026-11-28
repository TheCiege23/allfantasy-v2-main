import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { assertLeagueAccess, requireSleeper } from '@/lib/ai/league-settings-ai/access'
import { callClaudeJson } from '@/lib/ai/league-settings-ai/claude'
import { aiCostGate } from '@/lib/ai-protection/costGate'
import { fetchSleeperLeagueBundle, readSleeperStateWeek } from '@/lib/ai/league-settings-ai/sleeper'
import {
  buildAiCacheKey,
  createSmokeAiResult,
  isAiResultCacheSmokeProviderEnabled,
  readAiResultCache,
  writeAiResultCache,
} from '@/lib/ai-result-cache'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { leagueId?: string; week?: number; context?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : ''
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
  }

  const league = await assertLeagueAccess(leagueId, userId)
  if (!league) {
    return NextResponse.json({ error: 'League not found or forbidden' }, { status: 403 })
  }

  if (league.userId !== userId) {
    return NextResponse.json({ error: 'Only the commissioner can generate a league note' }, { status: 403 })
  }

  const sleeperId = requireSleeper(league)
  let sleeperSummary = ''
  if (sleeperId) {
    try {
      const bundle = await fetchSleeperLeagueBundle(sleeperId)
      const wk =
        typeof body.week === 'number' ? body.week : readSleeperStateWeek(bundle.state)
      sleeperSummary = JSON.stringify(
        {
          name: bundle.league.name,
          sport: bundle.sport,
          season: bundle.league.season,
          week: wk,
          teams: bundle.rosters.length,
        },
        null,
        2
      )
    } catch {
      sleeperSummary = ''
    }
  }

  const settingsSnippet = JSON.stringify(league.settings ?? {}, null, 2).slice(0, 6000)

  try {
    const smokeProviderEnabled = isAiResultCacheSmokeProviderEnabled()

    const system = `You are Chimmy, AllFantasy's commissioner communications assistant. Draft a concise, friendly commissioner note ready to post to the league chat. Respond with ONLY valid JSON (no markdown):
{"title":string,"body":string}
Tone: clear, inclusive, no insults.`

    const userPayload = `League name: ${league.name ?? leagueId}\nSport: ${league.sport}\nOptional week focus: ${body.week ?? 'current'}\nCommissioner extra context:\n${(body.context ?? '').trim() || '(none)'}\n\nSleeper snapshot:\n${sleeperSummary || '(not available)'}\n\nSynced settings (truncated):\n${settingsSnippet}`

    // ── AiResult cache gate (1h TTL — commissioner can regenerate explicitly) ───────────────
    const COMMISH_NOTE_TTL_MS = 60 * 60 * 1000
    const { resultKey, inputHash } = buildAiCacheKey('commish-note', {
      leagueId,
      sport: league.sport,
      week: body.week ?? null,
      context: (body.context ?? '').trim().toLowerCase() || null,
    })
    const cached = await readAiResultCache(resultKey)
    if (cached?.resultJson) {
      console.log(`[api/ai/commish-note] AiResult cache hit { league: '${leagueId}' }`)
      if (smokeProviderEnabled) {
        return NextResponse.json({
          ok: true,
          source: 'ai-result-cache',
          resultKey,
          data: cached.resultJson,
        })
      }
      return NextResponse.json(cached.resultJson)
    }

    if (smokeProviderEnabled) {
      const smoke = createSmokeAiResult({
        feature: 'commish-note',
        leagueId,
        route: '/api/ai/commish-note',
        input: {
          leagueId,
          week: body.week ?? null,
          context: body.context ?? null,
        },
      })
      const smokeResult = {
        title: 'Smoke Commissioner Note',
        body: smoke.text,
        meta: smoke.json,
      }

      await writeAiResultCache({
        resultKey,
        inputHash,
        feature: 'commish-note',
        scopeType: 'league',
        scopeId: leagueId,
        provider: 'smoke-provider',
        inputJson: { leagueId, sport: league.sport, week: body.week ?? null, smokeProvider: true },
        resultJson: smokeResult,
        ttlMs: COMMISH_NOTE_TTL_MS,
      })

      return NextResponse.json({
        ok: true,
        source: 'smoke-provider',
        resultKey,
        note: smoke.text,
        data: smokeResult,
      })
    }

    // Owner, 2026-11-28: every model call is signed in and capped. After the cache (a hit costs nothing),
    // immediately before the model call.
    const gated = await aiCostGate(req, 'commish_note', userId)
    if (gated) return gated

    const raw = await callClaudeJson({ system, user: userPayload, userId })

    // Write to AiResult cache (fire-and-forget).
    writeAiResultCache({
      resultKey,
      inputHash,
      feature: 'commish-note',
      scopeType: 'league',
      scopeId: leagueId,
      provider: 'anthropic',
      inputJson: { leagueId, sport: league.sport, week: body.week ?? null },
      resultJson: raw,
      ttlMs: COMMISH_NOTE_TTL_MS,
    }).catch(() => undefined)

    return NextResponse.json(raw)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Commissioner note failed'
    console.error('[api/ai/commish-note]', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
