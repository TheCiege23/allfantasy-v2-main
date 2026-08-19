import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueAccess, requireSleeper } from '@/lib/ai/league-settings-ai/access'
import { callClaudeJson } from '@/lib/ai/league-settings-ai/claude'
import {
  fetchPlayersMap,
  fetchSleeperLeagueBundle,
  fetchTrendingAdds,
  nameForPlayer,
  rosterForOwner,
} from '@/lib/ai/league-settings-ai/sleeper'
import {
  buildAiCacheKey,
  createSmokeAiResult,
  isAiResultCacheSmokeProviderEnabled,
  readAiResultCache,
  writeAiResultCache,
} from '@/lib/ai-result-cache'
import { getUserAfProStatus, AfProRequiredError } from '@/lib/entitlements/afAccess'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const sessionUserId = session?.user?.id
  if (!sessionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // AF Pro gate — personal AI waiver recommendations require AF Pro
  const hasAfPro = await getUserAfProStatus(sessionUserId)
  if (!hasAfPro) {
    return NextResponse.json(new AfProRequiredError().toResponse(), { status: 402 })
  }

  let body: { leagueId?: string; userId?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const leagueId = typeof body.leagueId === 'string' ? body.leagueId.trim() : ''
  const targetUserId = typeof body.userId === 'string' ? body.userId.trim() : sessionUserId
  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId is required' }, { status: 400 })
  }

  const league = await assertLeagueAccess(leagueId, sessionUserId)
  if (!league) {
    return NextResponse.json({ error: 'League not found or forbidden' }, { status: 403 })
  }

  if (targetUserId !== sessionUserId && league.userId !== sessionUserId) {
    return NextResponse.json({ error: 'Cannot run waivers for another user' }, { status: 403 })
  }

  const sleeperId = requireSleeper(league)
  if (!sleeperId) {
    return NextResponse.json({ error: 'Waiver recommendations require a Sleeper-synced league' }, { status: 400 })
  }

  try {
    const smokeProviderEnabled = isAiResultCacheSmokeProviderEnabled()

    const bundle = await fetchSleeperLeagueBundle(sleeperId)
    const playersMap = await fetchPlayersMap(bundle.sport)
    const teams = await prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { platformUserId: true, claimedByUserId: true },
    })
    const sleeperUserId =
      teams.find((t) => t.claimedByUserId === targetUserId)?.platformUserId ?? null
    if (!sleeperUserId) {
      return NextResponse.json({ error: 'No Sleeper user linked to this manager in the league' }, { status: 400 })
    }

    const myRoster = rosterForOwner(bundle.rosters, sleeperUserId)
    const myPlayerIds = [...new Set([...(myRoster?.starters ?? []), ...(myRoster?.players ?? [])])].filter(Boolean)
    const myRosterNames = myPlayerIds.slice(0, 40).map((id) => ({
      id,
      name: nameForPlayer(playersMap, id),
      pos: playersMap[id]?.position ?? '',
    }))

    const trending = await fetchTrendingAdds(bundle.sport, 15)
    const trendingNames = trending
      .map((t) => (t.player_id ? nameForPlayer(playersMap, t.player_id) : null))
      .filter(Boolean)

    // HONESTY PASS (slice 12): the inputs here ARE real (the manager's actual
    // roster + Sleeper's real league-wide trending adds), but there are NO
    // projections in this path, so these are popularity-and-shape suggestions,
    // not a projected-points ranking. The response now says so, and the model
    // is barred from inventing statistics to justify a pick.
    // FOLLOW-UP: route this through the Decision OS waiver engine
    // (/api/waiver-ai/engine) once Sleeper↔FantasyProjection player-id
    // namespaces are reconciled — attempting that join today silently matches
    // nothing (known wrong-row-join defect).
    const system = `You are Chimmy, AllFantasy's waiver wire assistant. Identify roster weaknesses using the roster sample and suggest realistic adds using trending names. Respond with ONLY valid JSON (no markdown):
{"recommendations":[{"addPlayer":string,"dropPlayer":string,"rationale":string}]}
Provide up to 5 objects. dropPlayer should name a realistic cut from the user's roster; if unclear use "bench stash".

CRITICAL HONESTY RULES:
- You have NO projection or statistical data in this request. Do NOT state projected points, percentages, target shares, snap counts, rankings, or any number presented as measured fact.
- Base each rationale on roster composition (positional need, depth) and the fact that a player is trending across leagues. Say "trending in add activity" rather than implying analysis you did not perform.
- Never claim a player "projects for X points" or "is ranked Nth".`

    const userPayload = `League: ${String(bundle.league.name ?? '')} (${bundle.sport})\nMy roster (sample):\n${JSON.stringify(myRosterNames, null, 2)}\n\nTrending adds / available buzz (names only):\n${JSON.stringify(trendingNames, null, 2)}`

    // ── AiResult cache gate (2h TTL — trending adds rotate intra-day) ─────────────────────
    const WAIVER_RECS_TTL_MS = 2 * 60 * 60 * 1000
    const weekTag = String(bundle.state?.week ?? 'offseason')
    const { resultKey, inputHash } = buildAiCacheKey('waiver-recs', {
      leagueId,
      userId: targetUserId,
      sport: bundle.sport,
      week: weekTag,
      rosterIds: myPlayerIds.slice(0, 40).sort(),
    })
    const cached = await readAiResultCache(resultKey)
    if (cached?.resultJson) {
      console.log(`[api/ai/waiver-recs] AiResult cache hit { league: '${leagueId}', user: '${targetUserId}', week: ${weekTag} }`)
      if (smokeProviderEnabled) {
        return NextResponse.json({
          ok: true,
          source: 'ai-result-cache',
          resultKey,
          recommendations: cached.resultJson,
        })
      }
      return NextResponse.json(cached.resultJson)
    }

    if (smokeProviderEnabled) {
      const smoke = createSmokeAiResult({
        feature: 'waiver-recs',
        leagueId,
        route: '/api/ai/waiver-recs',
        input: {
          leagueId,
          userId: targetUserId,
          sport: bundle.sport,
          week: weekTag,
          rosterIds: myPlayerIds.slice(0, 40).sort(),
        },
      })
      const smokeResult = {
        recommendations: [
          {
            addPlayer: 'Smoke Add Candidate',
            dropPlayer: 'bench stash',
            rationale: smoke.text,
          },
        ],
        meta: smoke.json,
      }

      await writeAiResultCache({
        resultKey,
        inputHash,
        feature: 'waiver-recs',
        scopeType: 'league',
        scopeId: leagueId,
        provider: 'smoke-provider',
        inputJson: {
          leagueId,
          userId: targetUserId,
          sport: bundle.sport,
          week: weekTag,
          smokeProvider: true,
        },
        resultJson: smokeResult,
        ttlMs: WAIVER_RECS_TTL_MS,
      })

      return NextResponse.json({
        ok: true,
        source: 'smoke-provider',
        resultKey,
        recommendations: smokeResult,
      })
    }

    const raw = (await callClaudeJson({ system, user: userPayload, userId: targetUserId })) as Record<
      string,
      unknown
    >

    // Provenance is part of the answer: these are suggestions from roster shape
    // + real league-wide add trends, NOT a projection-ranked waiver board.
    const result = {
      ...raw,
      basis: 'roster_composition_and_league_trending_adds',
      usesProjections: false,
      limitations: [
        'Suggestions reflect roster composition and league-wide add activity — not projected points.',
        'For a projection-ranked waiver board, use the Waiver Assistant in your league.',
      ],
    }

    // Write to AiResult cache (fire-and-forget).
    writeAiResultCache({
      resultKey,
      inputHash,
      feature: 'waiver-recs',
      scopeType: 'league',
      scopeId: leagueId,
      provider: 'anthropic',
      inputJson: { leagueId, userId: targetUserId, sport: bundle.sport, week: weekTag },
      resultJson: result,
      ttlMs: WAIVER_RECS_TTL_MS,
    }).catch(() => undefined)

    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Waiver recommendations failed'
    console.error('[api/ai/waiver-recs]', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
