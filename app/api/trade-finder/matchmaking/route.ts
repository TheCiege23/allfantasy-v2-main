import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { consumeRateLimit, getClientIp } from '@/lib/rate-limit'
import { pricePlayer, ValuationContext } from '@/lib/hybrid-valuation'
import { fetchFantasyCalcValues, type FantasyCalcSettings } from '@/lib/fantasycalc'
import { convertSleeperToAssets } from '@/lib/trade-engine'
import { getPreAnalysisStatus, runPreAnalysis } from '@/lib/trade-pre-analysis'
import { waitUntil } from '@vercel/functions'
import { resolveTendencyCoverage } from '@/lib/trade-finder/tendencyCoverage'
import { findBestPartners, type MatchmakingGoal } from '@/lib/trade-finder/partner-matchmaking'
import type { PricedAsset } from '@/lib/trade-finder/candidate-generator'
import type { LeagueIntelligence, ManagerProfile } from '@/lib/trade-engine/types'
import { attachPlayerMediaBatch } from '@/lib/player-media'
import {
  getPlayersBySport,
  getLeagueInfo,
  getLeagueRosters,
  getLeagueTransactions,
  getLeagueUsers,
} from '@/lib/sleeper-client'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const VALID_GOALS: MatchmakingGoal[] = [
  'rb_depth', 'wr_depth', 'qb_upgrade', 'te_upgrade',
  'get_younger', 'acquire_picks', 'win_now', 'rebuild', 'target_player',
]

const SleeperUserSchema = z.object({
  username: z.string().min(1),
  userId: z.string().optional().default(''),
})

const RequestSchema = z.object({
  leagueId: z.string().min(1),
  username: z.string().min(1).optional(),
  sleeperUser: SleeperUserSchema.optional(),
  goal: z.string().refine(g => VALID_GOALS.includes(g as MatchmakingGoal), 'Invalid goal'),
  targetPlayerName: z.string().optional(),
  targetPlayerId: z.string().optional(),
  maxResults: z.number().min(1).max(10).default(5),
}).refine(
  d => d.sleeperUser?.username || d.username,
  { message: 'Either sleeperUser.username or username is required' }
)

type RosteredPlayer = {
  id: string
  name: string
  pos: string
  team?: string
  slot: 'Starter' | 'Bench' | 'IR' | 'Taxi'
  isIdp?: boolean
  age?: number
}

type ParsedRoster = {
  rosterId: number
  userId: string
  displayName: string
  avatar?: string
  pointsFor: number
  record: string
  players: RosteredPlayer[]
  tradeCount: number
}

const SKILL_POSITIONS = ['QB', 'RB', 'WR', 'TE']

export const POST = withApiUsage({ endpoint: "/api/trade-finder/matchmaking", tool: "TradeFinderMatchmaking" })(async (req: NextRequest) => {
  const ip = getClientIp(req)
  const rl = consumeRateLimit({
    scope: 'legacy',
    action: 'trade_matchmaking',
    ip,
    maxRequests: 10,
    windowMs: 60_000,
    includeIpInKey: true,
  })
  if (!rl.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait before trying again.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } }
    )
  }

  try {
    const body = await req.json()
    const parsed = RequestSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.issues }, { status: 400 })
    }

    const { leagueId, username: legacyUsername, sleeperUser: sleeperUserIdentity, goal, targetPlayerName, targetPlayerId, maxResults } = parsed.data
    const resolvedUsername = sleeperUserIdentity?.username || legacyUsername || ''

    if (goal === 'target_player' && !targetPlayerName && !targetPlayerId) {
      return NextResponse.json({ error: 'target_player goal requires targetPlayerName or targetPlayerId' }, { status: 400 })
    }

    const [league, rosters, users] = await Promise.all([
      getLeagueInfo(leagueId),
      getLeagueRosters(leagueId),
      getLeagueUsers(leagueId),
    ])

    if (!league || !rosters.length || !users.length) {
      return NextResponse.json({ error: 'Failed to fetch league data from Sleeper' }, { status: 502 })
    }

    const userMap = new Map<string, { display_name?: string; username?: string; avatar?: string | null }>()
    for (const u of users) {
      userMap.set(u.user_id, u)
    }

    const sleeperUser = sleeperUserIdentity?.userId
      ? users.find((u: any) => u.user_id === sleeperUserIdentity.userId)
      : users.find((u: any) =>
          u.username?.toLowerCase() === resolvedUsername.toLowerCase() ||
          u.display_name?.toLowerCase() === resolvedUsername.toLowerCase()
        )
    if (!sleeperUser) {
      return NextResponse.json({ error: 'User not found in this league' }, { status: 404 })
    }

    const leagueSport = String(league.sport ?? 'nfl').toLowerCase()
    const sportPlayers = await getPlayersBySport(leagueSport).catch(() => ({} as Record<string, any>))

    const leagueSettings = league.settings || {}
    const rosterPositions: string[] = league.roster_positions || []
    const isSF = rosterPositions.some((p: string) => p === 'SUPER_FLEX')
    const isTEP = (league.scoring_settings?.bonus_rec_te ?? 0) > 0
    const tepBonus = league.scoring_settings?.bonus_rec_te ?? 0
    const parsedNumTeams = Number(leagueSettings.num_teams)
    const numTeams = Number.isFinite(parsedNumTeams) && parsedNumTeams > 0 ? parsedNumTeams : rosters.length

    const transactionsData = await getLeagueTransactions(leagueId, 1).catch(() => [])
    const tradeCountByRosterId: Record<number, number> = {}
    for (const tx of transactionsData) {
      if (tx.type === 'trade' && tx.roster_ids) {
        for (const rid of tx.roster_ids) {
          tradeCountByRosterId[rid] = (tradeCountByRosterId[rid] || 0) + 1
        }
      }
    }

    const allRosters: ParsedRoster[] = rosters.map((r: any) => {
      const user = userMap.get(r.owner_id || '')
      const starters = new Set(r.starters || [])
      const players: RosteredPlayer[] = (r.players || []).map((pid: string) => {
        const p = sportPlayers[pid]
        const slot = starters.has(pid) ? 'Starter' as const :
          (r.reserve || []).includes(pid) ? 'IR' as const :
          (r.taxi || []).includes(pid) ? 'Taxi' as const :
          'Bench' as const
        return {
          id: pid,
          name: p ? `${p.first_name} ${p.last_name}` : pid,
          pos: p?.position || 'UNKNOWN',
          team: p?.team || undefined,
          slot,
          isIdp: ['LB', 'DL', 'DB', 'EDGE', 'IDP'].includes(p?.position || ''),
          age: p?.age ?? undefined,
        }
      })

      const wins = r.settings?.wins ?? 0
      const losses = r.settings?.losses ?? 0
      const fpts = (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100

      return {
        rosterId: r.roster_id,
        userId: r.owner_id || '',
        displayName: user?.display_name || user?.username || `Team ${r.roster_id}`,
        avatar: user?.avatar || undefined,
        pointsFor: fpts,
        record: `${wins}-${losses}`,
        players,
        tradeCount: tradeCountByRosterId[r.roster_id] || 0,
      }
    })

    const userRoster = allRosters.find(r => r.userId === sleeperUser.user_id)
    if (!userRoster) {
      return NextResponse.json({ error: 'Could not find your roster in this league' }, { status: 404 })
    }

    let fcPlayers: any[] = []
    try {
      const recSetting = Number(league.scoring_settings?.rec ?? 1)
      const ppr: 0 | 0.5 | 1 = recSetting >= 1 ? 1 : recSetting >= 0.5 ? 0.5 : 0
      const fcSettings: FantasyCalcSettings = {
        isDynasty: league.settings?.type === 2,
        numQbs: isSF ? 2 : 1,
        numTeams: Number(numTeams) || 12,
        ppr,
      }
      fcPlayers = await fetchFantasyCalcValues(fcSettings)
    } catch { fcPlayers = [] }

    const ctx: ValuationContext = {
      asOfDate: new Date().toISOString().slice(0, 10),
      isSuperFlex: isSF,
      fantasyCalcPlayers: fcPlayers,
      numTeams: Number(numTeams),
    }

    const fantasyCalcValueMap: Record<string, { value: number; marketValue?: number; impactValue?: number; vorpValue?: number; volatility?: number }> = {}
    const allPlayerNames = new Set<string>()
    for (const r of allRosters) {
      for (const p of r.players) {
        if (p.name && !p.isIdp) allPlayerNames.add(p.name)
      }
    }
    const uniqueNames = Array.from(allPlayerNames)
    const batchSize = 50
    for (let i = 0; i < uniqueNames.length; i += batchSize) {
      const batch = uniqueNames.slice(i, i + batchSize)
      const pricedBatch = await Promise.all(batch.map(name => pricePlayer(name, ctx)))
      for (const priced of pricedBatch) {
        if (priced.value > 0) {
          fantasyCalcValueMap[priced.name] = {
            value: priced.value,
            marketValue: priced.assetValue.marketValue,
            impactValue: priced.assetValue.impactValue,
            vorpValue: priced.assetValue.vorpValue,
            volatility: priced.assetValue.volatility,
          }
        }
      }
    }

    const assetsByRosterId = convertSleeperToAssets({
      rosters: allRosters.map(r => ({
        rosterId: r.rosterId,
        players: r.players.map(p => ({
          id: p.id,
          name: p.name,
          pos: p.pos,
          team: p.team,
          slot: p.slot,
          isIdp: p.isIdp,
          age: p.age,
        })),
      })),
      fantasyCalcValues: fantasyCalcValueMap,
      leagueSettings: { isSF, isTEP },
    })

    const leagueAverage = allRosters.reduce((sum, r) => sum + r.pointsFor, 0) / Math.max(1, allRosters.length)

    const positionCounts = (players: RosteredPlayer[]) => {
      const counts: Record<string, number> = {}
      for (const p of players.filter(pl => !pl.isIdp && pl.slot === 'Starter')) {
        counts[p.pos] = (counts[p.pos] || 0) + 1
      }
      return counts
    }

    const detectNeeds = (players: RosteredPlayer[], assets: any[]): string[] => {
      const needs: string[] = []
      const startersByPos = positionCounts(players)
      const idealStarters: Record<string, number> = { QB: 1, RB: 2, WR: 2, TE: 1 }
      if (isSF) idealStarters.QB = 2
      for (const [pos, ideal] of Object.entries(idealStarters)) {
        const count = startersByPos[pos] || 0
        if (count < ideal) needs.push(pos)
      }
      const posValues: Record<string, number[]> = {}
      for (const a of assets) {
        if (a.type === 'PLAYER' && a.pos && !['LB', 'DL', 'DB', 'EDGE', 'IDP'].includes(a.pos)) {
          if (!posValues[a.pos]) posValues[a.pos] = []
          posValues[a.pos].push(a.value)
        }
      }
      for (const [pos, vals] of Object.entries(posValues)) {
        const avg = vals.reduce((s, v) => s + v, 0) / vals.length
        if (avg < 2500 && !needs.includes(pos)) needs.push(pos)
      }
      return needs
    }

    const detectSurplus = (assets: any[]): string[] => {
      const surplus: string[] = []
      const posValues: Record<string, number[]> = {}
      for (const a of assets) {
        if (a.type === 'PLAYER' && a.pos && !['LB', 'DL', 'DB', 'EDGE', 'IDP'].includes(a.pos)) {
          if (!posValues[a.pos]) posValues[a.pos] = []
          posValues[a.pos].push(a.value)
        }
      }
      for (const [pos, vals] of Object.entries(posValues)) {
        if (vals.length >= 3 && vals.sort((a, b) => b - a)[2] >= 2000) surplus.push(pos)
      }
      return surplus
    }

    const managerProfiles: Record<number, ManagerProfile> = {}
    for (const r of allRosters) {
      const assets = assetsByRosterId[r.rosterId] || []
      const needs = detectNeeds(r.players, assets)
      const surplus = detectSurplus(assets)

      managerProfiles[r.rosterId] = {
        rosterId: r.rosterId,
        userId: r.userId,
        displayName: r.displayName,
        avatar: r.avatar,
        record: { wins: parseInt(r.record.split('-')[0]) || 0, losses: parseInt(r.record.split('-')[1]) || 0 },
        isChampion: false,
        contenderTier:
          r.pointsFor > leagueAverage * 1.1 ? 'contender' as const :
          r.pointsFor < leagueAverage * 0.9 ? 'rebuild' as const :
          'middle' as const,
        needs,
        surplus,
        tradeAggression:
          r.tradeCount >= 5 ? 'high' as const :
          r.tradeCount >= 2 ? 'medium' as const :
          'low' as const,
        prefersPicks: false,
        prefersYouth: false,
        assets,
        faabRemaining: undefined,
        pointsFor: r.pointsFor,
        username: userMap.get(r.userId)?.username,
      }
    }

    /**
     * MANAGER TENDENCIES ARE THE MAJORITY OF THE SCORE, AND THEY WERE SILENTLY OPTIONAL.
     *
     * Four of the five scoring dimensions -- bias alignment, trade frequency, overpay
     * willingness and part of need overlap -- come from `TradePreAnalysisCache`. Nothing
     * on the new surface has ever written that table: the only two callers of
     * `runPreAnalysis` live inside `app/af-legacy/`, and there is no cron or script for
     * it. Production held ONE row across every league.
     *
     * So this block was a no-op almost every time, wrapped in a bare `catch {}` that made
     * the miss invisible. Ranking on roster overlap alone and ranking on the full model
     * rendered identically, which is precisely the "absence averaged into the answer"
     * failure the trade grades already avoid.
     *
     * Now: use the cache when it is ready, warm it in the background when it is not, and
     * tell the caller which of those happened. `runPreAnalysis` is safe to trigger this
     * way -- it has a 4h freshness check, an in-progress guard, and fans out per manager
     * through `Promise.allSettled` -- but it is several provider round-trips, so it must
     * not sit in front of the response.
     */
    let tendenciesMap: Record<string, any> = {}
    let warmStarted = false
    let lookupFailed = false

    try {
      const preAnalysis = await getPreAnalysisStatus(resolvedUsername, leagueId)
      if (preAnalysis.status === 'ready') {
        if (preAnalysis.cache?.managerTendencies) {
          for (const [managerId, tendency] of Object.entries(preAnalysis.cache.managerTendencies)) {
            const matchedRoster = allRosters.find(r => r.userId === managerId)
            if (matchedRoster) {
              tendenciesMap[String(matchedRoster.rosterId)] = tendency
            }
          }
        }
        if (preAnalysis.cache?.managerProfiles) {
          for (const [managerId, profile] of Object.entries(preAnalysis.cache.managerProfiles as Record<string, any>)) {
            const matchedRoster = allRosters.find(r => r.userId === managerId)
            if (matchedRoster && !tendenciesMap[String(matchedRoster.rosterId)]) {
              tendenciesMap[String(matchedRoster.rosterId)] = profile
            }
          }
        }
      }

      if (Object.keys(tendenciesMap).length === 0) {
        // Background, never in front of the response. runPreAnalysis is idempotent and
        // guards its own concurrency, so a burst of requests produces one run.
        waitUntil(
          runPreAnalysis(resolvedUsername, leagueId).catch((e) => {
            console.error('[matchmaking] pre-analysis warm failed', e instanceof Error ? e.message : e)
          }),
        )
        warmStarted = true
      }
    } catch (e) {
      // Previously `catch {}`. A failure here silently downgraded every score, so it is
      // reported to the caller rather than absorbed.
      console.error('[matchmaking] tendency lookup failed', e instanceof Error ? e.message : e)
      lookupFailed = true
    }

    const intelligence: LeagueIntelligence = {
      assetsByRosterId,
      managerProfiles,
      managerTendencies: Object.entries(tendenciesMap).reduce((acc, [k, v]) => {
        acc[Number(k)] = v
        return acc
      }, {} as Record<number, any>),
      leagueSettings: {
        leagueName: league.name || 'League',
        scoringType: league.scoring_settings?.rec === 1 ? 'PPR' : league.scoring_settings?.rec === 0.5 ? 'Half PPR' : 'Standard',
        numTeams,
        isTEP,
        tepBonus,
        isSF,
        rosterPositions,
        starterSlots: rosterPositions.filter((p: string) => p !== 'BN').length,
        benchSlots: rosterPositions.filter((p: string) => p === 'BN').length,
        taxiSlots: Number(league.settings?.taxi_slots ?? 0) || 0,
      },
    }

    const pricedAssets: Record<string, PricedAsset[]> = {}
    for (const r of allRosters) {
      const teamId = String(r.rosterId)
      const starters = new Set(r.players.filter(p => p.slot === 'Starter').map(p => p.id))
      pricedAssets[teamId] = []

      for (const p of r.players) {
        if (p.isIdp || !SKILL_POSITIONS.includes(p.pos)) continue
        const fcData = fantasyCalcValueMap[p.name]
        const value = fcData?.value ?? 0
        if (value < 200) continue

        pricedAssets[teamId].push({
          assetId: p.id,
          name: p.name,
          value,
          position: p.pos,
          tier: value >= 9000 ? 'Tier0_Untouchable' :
                value >= 7500 ? 'Tier1_Cornerstone' :
                value >= 5500 ? 'Tier2_HighEnd' :
                value >= 3500 ? 'Tier3_Starter' :
                value >= 1500 ? 'Tier4_Depth' : 'Tier5_Filler',
          age: p.age,
          isStarter: starters.has(p.id),
          isPick: false,
        })
      }
    }

    const result = findBestPartners({
      userRosterId: userRoster.rosterId,
      goal: goal as MatchmakingGoal,
      targetPlayerName,
      targetPlayerId,
      intelligence,
      pricedAssets,
      tendencies: tendenciesMap,
      maxResults,
    })

    const allOfferAssets: Array<{ assetId: string; teamAbbr: string | null; isPick: boolean }> = []
    for (const p of result.partners) {
      if (p.suggestedOffer) {
        for (const a of [...p.suggestedOffer.userGives, ...p.suggestedOffer.partnerGives]) {
          if (!a.isPick) {
            allOfferAssets.push({ assetId: a.assetId, teamAbbr: sportPlayers[a.assetId]?.team || null, isPick: false })
          }
        }
      }
    }

    const mediaMap = await attachPlayerMediaBatch(
      allOfferAssets.map(a => ({ playerId: a.assetId, teamAbbr: a.teamAbbr, sport: leagueSport }))
    )

    const enrichAsset = (a: { assetId: string; name: string; value: number; position: string; isPick: boolean }) => {
      if (a.isPick) {
        return {
          ...a,
          playerId: a.assetId,
          fullName: a.name,
          teamAbbr: null,
          sport: leagueSport,
          media: { headshotUrl: null, teamLogoUrl: null },
        }
      }
      const resolved = mediaMap.get(a.assetId)
      return {
        ...a,
        playerId: a.assetId,
        fullName: a.name,
        teamAbbr: resolved?.teamAbbr || sportPlayers[a.assetId]?.team || null,
        sport: leagueSport,
        media: resolved?.media || { headshotUrl: null, teamLogoUrl: null },
      }
    }

    const enrichedResult = {
      ...result,
      partners: result.partners.map(p => ({
        ...p,
        suggestedOffer: p.suggestedOffer ? {
          ...p.suggestedOffer,
          userGives: p.suggestedOffer.userGives.map(enrichAsset),
          partnerGives: p.suggestedOffer.partnerGives.map(enrichAsset),
        } : null,
      })),
    }

    return NextResponse.json({
      success: true,
      ...enrichedResult,
      /**
       * What the ranking was actually able to use. A caller that renders partners without
       * reading this is presenting a roster-overlap ranking as the full model.
       */
      tendencyCoverage: resolveTendencyCoverage({
        managersWithTendencies: Object.keys(tendenciesMap).length,
        managersEvaluated: allRosters.length,
        warmStarted,
        lookupFailed,
      }),
      leagueInfo: {
        name: league.name,
        type: league.settings?.type === 2 ? 'Dynasty' : 'Redraft',
        teams: numTeams,
        scoring: intelligence.leagueSettings?.scoringType || 'PPR',
      },
      userInfo: {
        name: userRoster.displayName,
        record: userRoster.record,
        rosterId: userRoster.rosterId,
      },
      rate_limit: { remaining: rl.remaining },
    })

  } catch (error: any) {
    console.error('Trade matchmaking error:', error)
    return NextResponse.json({ error: error.message || 'Failed to find trade partners' }, { status: 500 })
  }
})

export const GET = withApiUsage({ endpoint: "/api/trade-finder/matchmaking", tool: "TradeFinderMatchmaking" })(async () => {
  return NextResponse.json({
    message: 'AllFantasy Trade Partner Matchmaking API — Deterministic partner scoring',
    usage: {
      method: 'POST',
      body: {
        leagueId: 'Sleeper league ID',
        sleeperUser: '{ username: string, userId?: string }',
        username: '(deprecated) Your Sleeper username — use sleeperUser instead',
        goal: 'rb_depth | wr_depth | qb_upgrade | te_upgrade | get_younger | acquire_picks | win_now | rebuild | target_player',
        targetPlayerName: '(optional) Specific player name to target',
        targetPlayerId: '(optional) Sleeper player ID to target',
        maxResults: '(optional) 1-10, default 5',
      },
    },
  })
})
