import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requireFeatureEntitlement } from '@/lib/subscription/entitlement-middleware'
import { assertLeagueAccess, requireSleeper } from '@/lib/ai/league-settings-ai/access'
import { callClaudeJson } from '@/lib/ai/league-settings-ai/claude'
import { consumeDailyLimit } from '@/lib/rate-limit-daily'
import {
  fetchPlayersMap,
  fetchSleeperLeagueBundle,
  nameForPlayer,
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
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Plan gate before any rate-limit spend or AI call: `commissioner_power_rankings` (lib/monetization/entitlements.ts).
  const gate = await requireFeatureEntitlement({ userId: userId, userEmail: (session?.user as { email?: string | null } | undefined)?.email ?? null, featureId: 'commissioner_power_rankings' })
  if (!gate.ok) return gate.response

  let body: { leagueId?: string }
  try {
    body = (await req.json()) as { leagueId?: string }
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

  const sleeperId = requireSleeper(league)
  if (!sleeperId) {
    return NextResponse.json({ error: 'Power rankings require a Sleeper-synced league' }, { status: 400 })
  }

  const daily = await consumeDailyLimit({
    provider: 'sleeper',
    endpoint: `power-rankings:${leagueId}`,
  })
  if (!daily.success) {
    return NextResponse.json(
      {
        error: 'Power rankings can only be generated once per day per league.',
        retryAfterSec: daily.retryAfterSec,
      },
      { status: 429 }
    )
  }

  try {
    const smokeProviderEnabled = isAiResultCacheSmokeProviderEnabled()

    const bundle = await fetchSleeperLeagueBundle(sleeperId)
    const playersMap = await fetchPlayersMap(bundle.sport)
    const userById = new Map(bundle.users.map((u) => [u.user_id, u]))

    const teams = bundle.rosters
      .filter((r) => r.owner_id)
      .map((r) => {
        const u = userById.get(r.owner_id!)
        const pids = [...(r.starters ?? []), ...(r.players ?? [])].filter(Boolean)
        const uniq = Array.from(new Set(pids)).slice(0, 24)
        const playerNames = uniq.map((id) => nameForPlayer(playersMap, id))
        const wins = r.settings?.wins ?? 0
        const losses = r.settings?.losses ?? 0
        const pts = r.settings?.fpts ?? 0
        return {
          rosterId: r.roster_id,
          teamName: u?.metadata?.team_name?.trim() || u?.display_name || 'Team',
          ownerName: u?.display_name || u?.username || r.owner_id,
          record: `${wins}-${losses}`,
          seasonPoints: pts,
          playersSample: playerNames,
        }
      })

    const leagueName = String(bundle.league.name ?? league.name ?? 'League')
    const season = String(bundle.league.season ?? '')
    const scoring = JSON.stringify(bundle.league.scoring_settings ?? {}, null, 0).slice(0, 4000)

    // ── AiResult cache gate (4h TTL — roster/record snapshot is stable intra-day) ──────────────────
    const POWER_RANKINGS_TTL_MS = 4 * 60 * 60 * 1000
    const weekTag = String(bundle.state?.week ?? 'offseason')
    const { resultKey, inputHash } = buildAiCacheKey('power-rankings', {
      leagueId,
      sport: bundle.sport,
      season,
      week: weekTag,
    })
    const cached = await readAiResultCache(resultKey)
    if (cached?.resultJson) {
      console.log(`[api/ai/power-rankings] AiResult cache hit { league: '${leagueId}', week: ${weekTag} }`)
      if (smokeProviderEnabled) {
        return NextResponse.json({
          ok: true,
          source: 'ai-result-cache',
          resultKey,
          rankings: cached.resultJson,
        })
      }
      return NextResponse.json(cached.resultJson)
    }

    if (smokeProviderEnabled) {
      const smoke = createSmokeAiResult({
        feature: 'power-rankings',
        leagueId,
        route: '/api/ai/power-rankings',
        input: {
          leagueId,
          sport: bundle.sport,
          season,
          week: weekTag,
        },
      })
      const smokeResult = {
        rankings: teams
          .slice(0, Math.max(1, Math.min(teams.length, 10)))
          .map((team, idx) => ({
            rank: idx + 1,
            teamName: team.teamName,
            ownerName: team.ownerName,
            blurb: smoke.text,
          })),
        meta: smoke.json,
      }

      await writeAiResultCache({
        resultKey,
        inputHash,
        feature: 'power-rankings',
        scopeType: 'league',
        scopeId: leagueId,
        provider: 'smoke-provider',
        inputJson: { leagueId, sport: bundle.sport, season, week: weekTag, smokeProvider: true },
        resultJson: smokeResult,
        ttlMs: POWER_RANKINGS_TTL_MS,
      })

      return NextResponse.json({
        ok: true,
        source: 'smoke-provider',
        resultKey,
        rankings: smokeResult,
      })
    }

    const system = `You are Chimmy, AllFantasy's fantasy sports analyst. The league runs on Sleeper. You must rank every team from 1 to N (N = number of teams) using roster quality and season points / record as signals. Respond with ONLY valid JSON (no markdown) in this exact shape:
{"rankings":[{"rank":number,"teamName":string,"ownerName":string,"blurb":string}]}
Each blurb is exactly one sentence. League context: sport=${bundle.sport}, season=${season}.`

    const userPayload = `League: ${leagueName}\nScoring snapshot (truncated): ${scoring}\n\nTeams:\n${JSON.stringify(teams, null, 2)}`

    const raw = await callClaudeJson({ system, user: userPayload, userId })

    // Write to AiResult cache (fire-and-forget).
    writeAiResultCache({
      resultKey,
      inputHash,
      feature: 'power-rankings',
      scopeType: 'league',
      scopeId: leagueId,
      provider: 'anthropic',
      inputJson: { leagueId, sport: bundle.sport, season, week: weekTag },
      resultJson: raw,
      ttlMs: POWER_RANKINGS_TTL_MS,
    }).catch(() => undefined)

    return NextResponse.json(raw)
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Power rankings failed'
    console.error('[api/ai/power-rankings]', e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
