import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { ensureArray, ensureNumber } from '@/lib/engine/response-guard'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { listProfilesByLeague } from '@/lib/psychological-profiles/ManagerBehaviorQueryService'
import { resolveProfileAccessForUser } from '@/lib/psychological-profiles/ProfileAccess'
import { filterLabelsByDimension } from '@/lib/psychological-profiles/ProfileLabelResolver'
import type { ProfileLabel } from '@/lib/psychological-profiles/types'
import {
  getAllPlayers,
  getLeagueDrafts,
  getLeagueInfo,
  getLeagueRosters,
  getLeagueUsers,
  getTradedDraftPicks,
} from '@/lib/sleeper-client'

export const dynamic = 'force-dynamic'

type Sport = 'nfl' | 'nba'

interface SleeperUser {
  user_id: string
  display_name?: string
  username?: string
}

interface SleeperRoster {
  roster_id: number
  owner_id: string | null
  players?: string[] | null
  starters?: string[] | null
  reserve?: string[] | null
  taxi?: string[] | null
  settings?: {
    wins?: number
    losses?: number
    fpts?: number
    waiver_budget_used?: number
  }
}

interface SleeperLeague {
  season?: string
  season_type?: string
  status?: string
  total_rosters?: number
  settings?: {
    waiver_budget?: number
    trade_deadline?: number
    num_teams?: number
    playoff_teams?: number
    playoff_week_start?: number
    best_ball?: number
    taxi_slots?: number
    reserve_slots?: number
    bench_lock?: number
    disable_trades?: number
    veto_votes_needed?: number
  }
  scoring_settings?: Record<string, number>
  roster_positions?: string[]
}

interface SleeperDraftPick {
  season: string
  round: number
  roster_id: number
  previous_owner_id: number
  owner_id: number
}

interface SleeperDraft {
  draft_id: string
  season: string
  status: string
  draft_order?: Record<string, number> // user_id -> pick position (1-12)
  slot_to_roster_id?: Record<string, number> // slot position -> roster_id
}

interface SleeperDraftPickDetails {
  round: number
  pick_no: number // pick within round (1-12)
  roster_id: number
  draft_slot: number
}

interface SleeperPlayer {
  full_name?: string
  first_name?: string
  last_name?: string
  position?: string
  team?: string
}

const playersCache: Record<Sport, { at: number; data: Record<string, SleeperPlayer> | null }> = {
  nfl: { at: 0, data: null },
  nba: { at: 0, data: null },
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000

async function getSleeperPlayers(sport: Sport) {
  const now = Date.now()
  const cached = playersCache[sport]
  if (cached.data && now - cached.at < CACHE_TTL_MS) return cached.data

  if (sport !== 'nfl') {
    playersCache[sport] = { at: now, data: {} }
    return playersCache[sport].data!
  }

  const players = await getAllPlayers()
  playersCache[sport] = { at: now, data: players as Record<string, SleeperPlayer> }
  return playersCache[sport].data!
}

export const GET = withApiUsage({ endpoint: "/api/legacy/trade/league-managers", tool: "LegacyTradeLeagueManagers" })(async (req: NextRequest) => {
  try {
    const leagueId = String(req.nextUrl.searchParams?.get('league_id') || '').trim()
    const sportRaw = String(req.nextUrl.searchParams?.get('sport') || 'nfl').trim().toLowerCase()

    if (!leagueId) {
      return NextResponse.json({ error: 'Missing league_id' }, { status: 400 })
    }

    const sport: Sport = sportRaw === 'nba' ? 'nba' : 'nfl'

    // 1) Get league info for FAAB budget
    const leagueData = await getLeagueInfo(leagueId) as SleeperLeague | null
    const totalFaabBudget = leagueData?.settings?.waiver_budget || 100
    const rosterPositions = leagueData?.roster_positions || []

    // 2) Get all users in the league
    const users = await getLeagueUsers(leagueId) as SleeperUser[]
    if (!Array.isArray(users)) {
      return NextResponse.json({ error: 'Failed to load league users from Sleeper' }, { status: 502 })
    }

    // 3) Get all rosters
    const rosters = await getLeagueRosters(leagueId) as SleeperRoster[]
    if (!Array.isArray(rosters)) {
      return NextResponse.json({ error: 'Failed to load league rosters from Sleeper' }, { status: 502 })
    }

    // 4) Get traded draft picks
    const tradedPicks = await getTradedDraftPicks(leagueId) as SleeperDraftPick[]

    // 4b) Get drafts to determine pick slots
    const drafts = await getLeagueDrafts(leagueId) as SleeperDraft[]
    
    // Build user_id to roster_id map for draft order conversion
    const userToRoster = new Map<string, number>()
    rosters.forEach((r: SleeperRoster) => {
      if (r.owner_id) {
        userToRoster.set(r.owner_id, r.roster_id)
      }
    })
    
    // Build a map of roster_id -> draft slot for each season
    const rosterToSlot: Record<string, Map<number, number>> = {}
    let latestSlotMap: Map<number, number> | null = null
    let latestSlotSeason = 0
    
    // Sort drafts by season descending so we can identify the most recent
    const sortedDrafts = [...drafts].sort((a, b) => parseInt(b.season) - parseInt(a.season))
    
    for (const draft of sortedDrafts) {
      const slotMap = new Map<number, number>()
      
      // Check slot_to_roster_id first (maps slot -> roster_id)
      if (draft.slot_to_roster_id) {
        for (const [slotStr, rId] of Object.entries(draft.slot_to_roster_id)) {
          const slot = parseInt(slotStr)
          slotMap.set(rId, slot)
        }
      }
      // Also check draft_order (maps user_id -> slot) - more common in Sleeper
      else if (draft.draft_order) {
        for (const [userId, slot] of Object.entries(draft.draft_order)) {
          const rosterId = userToRoster.get(userId)
          if (rosterId) {
            slotMap.set(rosterId, slot as number)
          }
        }
      }
      
      if (slotMap.size > 0) {
        rosterToSlot[draft.season] = slotMap
        const seasonNum = parseInt(draft.season)
        if (seasonNum > latestSlotSeason) {
          latestSlotSeason = seasonNum
          latestSlotMap = slotMap
        }
      }
    }
    
    // 5) Load player directory
    const playersDict = await getSleeperPlayers(sport)

    // Create a map of user_id to display name
    const userMap = new Map<string, string>()
    users.forEach(u => {
      const name = u.display_name || u.username || u.user_id
      userMap.set(u.user_id, name)
    })

    // Create a map of roster_id to owner info
    const rosterOwnerMap = new Map<number, { userId: string; displayName: string }>()
    rosters.forEach(r => {
      if (r.owner_id) {
        rosterOwnerMap.set(r.roster_id, {
          userId: r.owner_id,
          displayName: userMap.get(r.owner_id) || `Team ${r.roster_id}`
        })
      }
    })

    // Determine current year for draft picks
    const currentYear = new Date().getFullYear()
    const futureYears = [currentYear, currentYear + 1, currentYear + 2, currentYear + 3]

    // For future years without a draft, use the most recent draft's slot mapping as fallback
    // Only apply if the slot map covers enough current rosters (handles owner turnover)
    if (latestSlotMap) {
      const currentRosterIds = new Set(rosters.map(r => r.roster_id))
      const coveredCount = [...currentRosterIds].filter(rid => latestSlotMap!.has(rid)).length
      const coverageRatio = coveredCount / currentRosterIds.size
      
      if (coverageRatio >= 0.5) {
        for (const year of futureYears) {
          const yearStr = String(year)
          if (!rosterToSlot[yearStr]) {
            rosterToSlot[yearStr] = latestSlotMap
          }
        }
      }
    }

    // Build managers data
    const managers = rosters.map(roster => {
      const ownerInfo = rosterOwnerMap.get(roster.roster_id)
      const displayName = ownerInfo?.displayName || `Team ${roster.roster_id}`
      const userId = ownerInfo?.userId || ''

      const starterIds = (roster.starters || []).filter(Boolean)

      const playerIds = roster.players || []
      const players = playerIds.map(pid => {
        const meta = playersDict[pid] || {}
        const name = meta.full_name || 
          [meta.first_name, meta.last_name].filter(Boolean).join(' ') || 
          pid
        const pos = (meta.position || 'UNK').toUpperCase()
        const team = (meta.team || '').toUpperCase() || undefined
        return { id: pid, name, pos, team }
      })

      // Sort players by position value (QB > RB > WR > TE > others)
      const posOrder: Record<string, number> = { QB: 1, RB: 2, WR: 3, TE: 4, K: 5, DEF: 6 }
      players.sort((a, b) => {
        const aOrder = posOrder[a.pos] || 99
        const bOrder = posOrder[b.pos] || 99
        if (aOrder !== bOrder) return aOrder - bOrder
        return a.name.localeCompare(b.name)
      })

      // Calculate draft picks owned by this roster
      const draftPicks: { season: string; round: number; slot: number | null; originalOwner: string; originalRosterId: number }[] = []
      const numTeams = rosters.length
      
      // Start with default picks for future years
      futureYears.forEach(year => {
        const yearStr = String(year)
        const numRounds = sport === 'nfl' ? 4 : 3
        
        // Get draft slot for this roster's original picks
        const slotMap = rosterToSlot[yearStr]
        const rosterSlot = slotMap?.get(roster.roster_id) || null
        
        for (let round = 1; round <= numRounds; round++) {
          // Check if this pick is currently owned by someone else
          // roster_id = original owner of the pick, owner_id = who currently owns it
          const isTradedAway = tradedPicks.some(p => 
            p.season === yearStr && 
            p.round === round && 
            p.roster_id === roster.roster_id &&
            p.owner_id !== roster.roster_id
          )
          
          if (!isTradedAway) {
            draftPicks.push({
              season: yearStr,
              round,
              slot: rosterSlot,
              originalOwner: displayName,
              originalRosterId: roster.roster_id
            })
          }
        }
      })

      // Add picks traded TO this roster (originally belonging to other rosters)
      tradedPicks
        .filter(p => p.owner_id === roster.roster_id && p.roster_id !== roster.roster_id)
        .forEach(p => {
          const originalRosterId = p.roster_id
          const originalOwnerName = rosterOwnerMap.get(originalRosterId)?.displayName || `Team ${originalRosterId}`
          const slotMap = rosterToSlot[p.season]
          const originalSlot = slotMap?.get(originalRosterId) || null
          
          draftPicks.push({
            season: p.season,
            round: p.round,
            slot: originalSlot,
            originalOwner: originalOwnerName,
            originalRosterId: originalRosterId
          })
        })

      // Sort picks by year then round then slot
      draftPicks.sort((a, b) => {
        const yearDiff = parseInt(a.season) - parseInt(b.season)
        if (yearDiff !== 0) return yearDiff
        if (a.round !== b.round) return a.round - b.round
        return (a.slot || 99) - (b.slot || 99)
      })

      // Calculate remaining FAAB
      const faabUsed = roster.settings?.waiver_budget_used || 0
      const faabRemaining = totalFaabBudget - faabUsed

      // Calculate record and rank
      const wins = roster.settings?.wins || 0
      const losses = roster.settings?.losses || 0
      const pointsFor = roster.settings?.fpts || 0

      return {
        rosterId: roster.roster_id,
        userId,
        displayName,
        players,
        starters: starterIds,
        draftPicks,
        faab: {
          total: totalFaabBudget,
          used: faabUsed,
          remaining: faabRemaining
        },
        record: { wins, losses },
        pointsFor
      }
    })

    // Sort managers by wins (best first)
    managers.sort((a, b) => {
      const winDiff = b.record.wins - a.record.wins
      if (winDiff !== 0) return winDiff
      return b.pointsFor - a.pointsFor
    })

    const scoringSettings = leagueData?.scoring_settings || {}
    const ppr = scoringSettings.rec ?? 0
    const tepBonus = scoringSettings.bonus_rec_te ?? 0
    const ppCarry = scoringSettings.rush_att ?? 0
    const ppCompletion = scoringSettings.pass_cmp ?? 0
    const sixPtPassTd = (scoringSettings.pass_td ?? 4) >= 6
    const isSuperFlex = rosterPositions.includes('SUPER_FLEX')
    const isTEP = tepBonus > 0
    const idp = rosterPositions.some(p => ['DL', 'LB', 'DB', 'IDP_FLEX'].includes(p))

    const slotCounts: Record<string, number> = {}
    rosterPositions.forEach(p => { slotCounts[p] = (slotCounts[p] || 0) + 1 })

    // Manager psychology, attached to the managers this endpoint already returns.
    //
    // Two things this must not assume. First, `league_id` here is the SLEEPER id,
    // while profiles are keyed by canonical League.id, so the mapping is explicit
    // and yields nothing rather than guessing when the league was never imported.
    // Second, the legacy auth helpers on these routes do not actually
    // authenticate — requireAuthOrOrigin reports anonymous callers as
    // authenticated — so the gate reads the session directly instead of trusting
    // the surrounding wrapper.
    const psychologyByManager = await loadLegacyManagerPsychology(leagueId)

    const managersWithPsychology = managers.map((m: { rosterId?: number } & Record<string, unknown>) => {
      const entry = psychologyByManager.get(String(m.rosterId ?? ''))
      return entry ? { ...m, psychology: entry } : { ...m, psychology: null }
    })

    const tradeDeadlineWeek = leagueData?.settings?.trade_deadline ?? 99
    const vetoVotesNeeded = leagueData?.settings?.veto_votes_needed ?? 0

    return NextResponse.json({ 
      success: true, 
      managers: ensureArray(managersWithPsychology),
      total: ensureNumber(managersWithPsychology?.length),
      leagueSettings: {
        faabBudget: totalFaabBudget,
        sport,
        rosterPositions,
        season: leagueData?.season || String(new Date().getFullYear()),
        seasonType: leagueData?.season_type || 'regular',
        status: leagueData?.status || 'unknown',
        numTeams: rosters.length,

        scoring: {
          ppr,
          tepBonus,
          ppCarry,
          ppCompletion,
          sixPtPassTd,
          passTd: scoringSettings.pass_td ?? 4,
          passInt: scoringSettings.pass_int ?? -2,
          rushTd: scoringSettings.rush_td ?? 6,
          recTd: scoringSettings.rec_td ?? 6,
          fumLost: scoringSettings.fum_lost ?? -2,
          raw: scoringSettings,
        },

        roster: {
          slots: slotCounts,
          maxRoster: rosterPositions.length,
          taxiSlots: leagueData?.settings?.taxi_slots ?? 0,
          reserveSlots: leagueData?.settings?.reserve_slots ?? 0,
        },

        flags: {
          isSuperFlex,
          isTEP,
          idp,
          bestBall: !!(leagueData?.settings?.best_ball),
        },

        trade: {
          tradeDeadlineWeek,
          vetoType: vetoVotesNeeded > 0 ? 'vote' : 'none',
          faabTradable: totalFaabBudget > 0,
        },
      }
    })
  } catch (e) {
    console.error('trade/league-managers error', e)
    return NextResponse.json({ error: 'Failed to load league managers', details: String(e) }, { status: 500 })
  }
})


/**
 * Trade psychology for the managers of a Sleeper league, keyed by roster id.
 *
 * Returns an empty map for anything it cannot establish — league never imported,
 * caller not signed in, caller not entitled — because a Legacy ledger that shows
 * confident reads on some managers and silence on others is more honest than one
 * that fills the gaps.
 *
 * Trade-dimension labels only: this is the trade ledger, and how someone drafts
 * belongs in the draft room.
 */
async function loadLegacyManagerPsychology(
  sleeperLeagueId: string
): Promise<Map<string, { labels: string[]; tradesObserved: number; confidence: string | null; shortfall: string | null }>> {
  const empty = new Map<string, { labels: string[]; tradesObserved: number; confidence: string | null; shortfall: string | null }>()
  try {
    const session = (await getServerSession(authOptions as never)) as
      | { user?: { id?: string; email?: string } }
      | null
    const userId = session?.user?.id
    if (!userId) return empty

    const league = await prisma.league.findFirst({
      where: { platformLeagueId: sleeperLeagueId },
      select: { id: true },
    })
    if (!league) return empty

    const access = await resolveProfileAccessForUser(league.id, userId, session?.user?.email ?? null)
    if (!access.ok) return empty

    const profiles = await listProfilesByLeague(league.id, { limit: 32 })
    const out = empty
    for (const profile of profiles) {
      const isSelf = access.ownManagerIds.has(profile.managerId)
      if (!isSelf && !access.canSeeOpponents) continue

      const trade = profile.evidenceSummary?.dimensions.trade
      const labels = Array.isArray(profile.profileLabels)
        ? filterLabelsByDimension(profile.profileLabels as ProfileLabel[], 'trade')
        : []
      out.set(profile.managerId, {
        labels,
        tradesObserved: trade?.evidenceCount ?? 0,
        confidence: trade?.confidence ?? null,
        shortfall:
          trade && !trade.sufficient
            ? trade.evidenceCount === 0
              ? 'No trades recorded for this manager yet.'
              : `Only ${trade.evidenceCount} trade action${trade.evidenceCount === 1 ? '' : 's'} on record — not enough to call a pattern.`
            : null,
      })
    }
    return out
  } catch {
    return empty
  }
}
