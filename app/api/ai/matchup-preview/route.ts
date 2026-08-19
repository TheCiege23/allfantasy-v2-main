import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueAccess, requireSleeper } from '@/lib/ai/league-settings-ai/access'
import { callClaudeJson } from '@/lib/ai/league-settings-ai/claude'
import {
  fetchPlayersMap,
  fetchSleeperLeagueBundle,
  fetchMatchups,
  nameForPlayer,
  readSleeperStateWeek,
} from '@/lib/ai/league-settings-ai/sleeper'
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
  const sessionUserId = session?.user?.id
  if (!sessionUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { leagueId?: string; week?: number; userId?: string }
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
    return NextResponse.json({ error: 'Cannot preview matchups for another user' }, { status: 403 })
  }

  const sleeperId = requireSleeper(league)
  if (!sleeperId) {
    return NextResponse.json({ error: 'Matchup preview requires a Sleeper-synced league' }, { status: 400 })
  }

  try {
    const smokeProviderEnabled = isAiResultCacheSmokeProviderEnabled()

    const bundle = await fetchSleeperLeagueBundle(sleeperId)
    const stateWeek = readSleeperStateWeek(bundle.state) ?? NaN
    const week =
      typeof body.week === 'number' && body.week > 0
        ? body.week
        : Number.isFinite(stateWeek)
          ? stateWeek
          : 1

    const teams = await prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { id: true, platformUserId: true, claimedByUserId: true },
    })
    const myLeagueTeam = teams.find((t) => t.claimedByUserId === targetUserId) ?? null
    const sleeperUserId = myLeagueTeam?.platformUserId ?? null
    if (!sleeperUserId) {
      return NextResponse.json({ error: 'No Sleeper user linked to this manager' }, { status: 400 })
    }

    const myRoster = bundle.rosters.find((r) => r.owner_id === sleeperUserId)
    const myRid = myRoster?.roster_id

    const matchups = await fetchMatchups(sleeperId, week)
    const mine = (Array.isArray(matchups) ? matchups : []).find((m) => m.roster_id === myRid)
    const opp = (Array.isArray(matchups) ? matchups : []).find(
      (m) => m.matchup_id === mine?.matchup_id && m.roster_id !== myRid
    )

    const playersMap = await fetchPlayersMap(bundle.sport)
    const users = bundle.users
    const rosterLineup = (r: (typeof bundle.rosters)[0] | undefined) => {
      const starters = r?.starters ?? []
      return starters.map((pid) => ({
        name: nameForPlayer(playersMap, String(pid)),
        pos: playersMap[String(pid)]?.position ?? '',
      }))
    }

    const myTeam = users.find((u) => u.user_id === sleeperUserId)
    const oppOwner = opp
      ? bundle.rosters.find((x) => x.roster_id === opp.roster_id)?.owner_id
      : null
    const oppUser = oppOwner ? users.find((u) => u.user_id === oppOwner) : null

    const myR = bundle.rosters.find((x) => x.roster_id === myRid)
    const oppR = bundle.rosters.find((x) => x.roster_id === opp?.roster_id)

    // HONESTY PASS (slice 12): win probability used to be asked of the LLM from
    // a snapshot containing only player NAMES and partial points — the model
    // invented a percentage and we rendered it as an analysis. Win probability
    // is a simulation output, not a language output. Read the real one from
    // MatchupSimulationResult; when it doesn't exist, say so instead of
    // guessing.
    const simulation = myLeagueTeam
      ? await prisma.matchupSimulationResult
          .findFirst({
            where: {
              leagueId,
              weekOrPeriod: week,
              OR: [{ teamAId: myLeagueTeam.id }, { teamBId: myLeagueTeam.id }],
            },
            orderBy: { createdAt: 'desc' },
            select: {
              teamAId: true,
              expectedScoreA: true,
              expectedScoreB: true,
              winProbabilityA: true,
              winProbabilityB: true,
            },
          })
          .catch(() => null)
      : null
    const isTeamA = simulation?.teamAId === myLeagueTeam?.id
    const deterministicWinProbability = simulation
      ? Math.round((isTeamA ? simulation.winProbabilityA : simulation.winProbabilityB) * 100)
      : null
    const deterministicExpectedScores = simulation
      ? {
          mine: isTeamA ? simulation.expectedScoreA : simulation.expectedScoreB,
          opponent: isTeamA ? simulation.expectedScoreB : simulation.expectedScoreA,
        }
      : null

    const snapshot = {
      week,
      myTeam: myTeam?.metadata?.team_name || myTeam?.display_name || 'My team',
      oppTeam: oppUser?.metadata?.team_name || oppUser?.display_name || 'Opponent',
      myProjectedLineup: rosterLineup(myR),
      oppProjectedLineup: rosterLineup(oppR),
      myPointsSoFar: mine?.points,
      oppPointsSoFar: opp?.points,
      // Deterministic facts (may be null) — the model must not restate these as its own estimate.
      simulatedWinProbability: deterministicWinProbability,
      simulatedExpectedScores: deterministicExpectedScores,
    }

    const system = `You are Chimmy, AllFantasy's matchup strategist. Using the snapshot (points may be partial if mid-week), describe the matchup and suggest lineup tweaks. Respond with ONLY valid JSON (no markdown):
{"keyMatchups":string[],"lineupRecommendation":string}
keyMatchups are short bullets (e.g. positional edges).
CRITICAL: Do NOT output a win probability, odds, or any percentage chance of winning. ${
      deterministicWinProbability != null
        ? `The simulated win probability is ${deterministicWinProbability}% — you may reference that exact figure, but never invent a different one.`
        : 'No simulation exists for this matchup, so no win probability is available. Do not estimate one; discuss matchup edges qualitatively instead.'
    }`

    const userPayload = `League: ${String(bundle.league.name ?? '')} (${bundle.sport})\n${JSON.stringify(snapshot, null, 2)}`

    // ── AiResult cache gate (2h TTL — scores change during games) ─────────────────────────
    const MATCHUP_PREVIEW_TTL_MS = 2 * 60 * 60 * 1000
    const { resultKey, inputHash } = buildAiCacheKey('matchup-preview', {
      leagueId,
      userId: targetUserId,
      sport: bundle.sport,
      week,
    })
    const cached = await readAiResultCache(resultKey)
    if (cached?.resultJson) {
      console.log(`[api/ai/matchup-preview] AiResult cache hit { league: '${leagueId}', user: '${targetUserId}', week: ${week} }`)
      if (smokeProviderEnabled) {
        return NextResponse.json({
          ok: true,
          source: 'ai-result-cache',
          resultKey,
          preview: cached.resultJson,
        })
      }
      return NextResponse.json(cached.resultJson)
    }

    if (smokeProviderEnabled) {
      const smoke = createSmokeAiResult({
        feature: 'matchup-preview',
        leagueId,
        route: '/api/ai/matchup-preview',
        input: {
          leagueId,
          userId: targetUserId,
          sport: bundle.sport,
          week,
        },
      })
      const smokeResult = {
        winProbability: null,
        winProbabilitySource: 'unavailable' as const,
        keyMatchups: [smoke.text],
        lineupRecommendation: 'Smoke-mode placeholder recommendation generated from deterministic input hash.',
        meta: smoke.json,
      }

      await writeAiResultCache({
        resultKey,
        inputHash,
        feature: 'matchup-preview',
        scopeType: 'league',
        scopeId: leagueId,
        provider: 'smoke-provider',
        inputJson: { leagueId, userId: targetUserId, sport: bundle.sport, week, smokeProvider: true },
        resultJson: smokeResult,
        ttlMs: MATCHUP_PREVIEW_TTL_MS,
      })

      return NextResponse.json({
        ok: true,
        source: 'smoke-provider',
        resultKey,
        preview: smokeResult,
      })
    }

    const raw = await callClaudeJson({ system, user: userPayload, userId: sessionUserId })

    // Honesty pass: the deterministic simulation is authoritative for
    // winProbability. Any model-produced value is discarded — never merged,
    // never used as a fallback. `winProbabilitySource` makes the provenance
    // explicit to every consumer.
    const modelOutput = (raw ?? {}) as Record<string, unknown>
    delete modelOutput.winProbability
    const result = {
      ...modelOutput,
      winProbability: deterministicWinProbability,
      winProbabilitySource: deterministicWinProbability != null ? 'simulation' : 'unavailable',
      expectedScores: deterministicExpectedScores,
    }

    // Write to AiResult cache (fire-and-forget).
    writeAiResultCache({
      resultKey,
      inputHash,
      feature: 'matchup-preview',
      scopeType: 'league',
      scopeId: leagueId,
      provider: 'anthropic',
      inputJson: { leagueId, userId: targetUserId, sport: bundle.sport, week },
      resultJson: result,
      ttlMs: MATCHUP_PREVIEW_TTL_MS,
    }).catch(() => undefined)

    return NextResponse.json(result)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Matchup preview failed'
    console.error('[api/ai/matchup-preview]', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
