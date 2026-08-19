// app/api/league/transfer/route.ts
// Transfers an entire league from Sleeper/Yahoo/MFL/ESPN/Fleaflicker/Fantrax
// to AllFantasy — 1-for-1 copy of all data.
//
// POST /api/league/transfer
// Returns a streaming JSON response with progress events.

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession }          from 'next-auth'
import { authOptions }               from '@/lib/auth'
import { prisma }                    from '@/lib/prisma'
import { toPrismaJsonInput }          from '@/lib/prisma-json'

// ─── TYPES ──────────────────────────────────────────────────────

type Platform = 'sleeper' | 'yahoo' | 'mfl' | 'espn' | 'fleaflicker' | 'fantrax'

type TransferStep =
  | 'validating'
  | 'settings'
  | 'rosters'
  | 'drafts'
  | 'playoffs'
  | 'trades'
  | 'waivers'
  | 'complete'
  | 'error'
  | 'unavailable'

interface TransferProgress {
  step:       TransferStep
  progress:   number        // 0-100
  message:    string
  leagueId?:  string        // new AF league ID on complete
  error?:     string
}

interface TransferOptions {
  copyDraftHistory:   boolean
  copyPlayoffHistory: boolean
  copyTradeHistory:   boolean
  copyWaiverHistory:  boolean
  copyRosters:        boolean
  copySettings:       boolean
}

// ─── SLEEPER API HELPERS ─────────────────────────────────────────

const SLEEPER_BASE = 'https://api.sleeper.app/v1' // db-first-exception: league transfer is an explicit user-triggered import pipeline

async function sleeperGet<T>(path: string): Promise<T> {
  const res = await fetch(`${SLEEPER_BASE}${path}`, {
    next: { revalidate: 0 },
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) throw new Error(`Sleeper API error ${res.status} for ${path}`)
  return res.json() as Promise<T>
}

// ─── SLEEPER TRANSFER ────────────────────────────────────────────

async function transferFromSleeper(
  leagueId:  string,
  userId:    string,
  options:   TransferOptions,
  emit:      (p: TransferProgress) => void
): Promise<string> {

  emit({ step: 'validating', progress: 5, message: 'Fetching league from Sleeper...' })

  // 1. Fetch all league data in parallel
  const [leagueData, rostersData, usersData] = await Promise.all([
    sleeperGet<Record<string,unknown>>(`/league/${leagueId}`),
    sleeperGet<Record<string,unknown>[]>(`/league/${leagueId}/rosters`),
    sleeperGet<Record<string,unknown>[]>(`/league/${leagueId}/users`),
  ])

  if (!leagueData || !leagueData.league_id) {
    throw new Error('League not found on Sleeper. Check the league ID.')
  }

  emit({ step: 'settings', progress: 20, message: 'Copying league settings...' })

  // 2. Map Sleeper league → AF League model (exact name copy)
  const leagueName = String(leagueData.name ?? `Sleeper League ${leagueId}`)
  const sport      = String(leagueData.sport ?? 'nfl').toUpperCase()
  const season     = Number(leagueData.season ?? new Date().getFullYear())
  const settings   = leagueData.settings as Record<string,unknown> ?? {}
  const scoring    = (leagueData.scoring_settings as Record<string,unknown>) ?? {}
  const rosterPos  = (leagueData.roster_positions as string[]) ?? []
  const totalTeams = Number(leagueData.total_rosters ?? 12)
  const isDynasty  = Boolean(settings.type === 2)   // 0=redraft 1=keeper 2=dynasty
  const isKeeper   = Boolean(settings.type === 1)

  // Create AF League record
  const afLeague = await prisma.league.create({
    data: {
      userId,
      platform:         'sleeper',
      platformLeagueId: leagueId,
      name:             leagueName,            // EXACT copy
      sport:            sport === 'NFL' ? 'NFL' : sport === 'NBA' ? 'NBA' : 'NFL',
      season,
      leagueSize:       totalTeams,
      isDynasty,
      scoring:          isDynasty ? 'dynasty' : isKeeper ? 'keeper' : 'redraft',
      starters:         rosterPos,
      rosterSize:       rosterPos.length,
      settings:         toPrismaJsonInput({
        scoringSettings: scoring,
        rosterPositions: rosterPos,
        playoffTeams:    Number(settings.playoff_teams ?? 4),
        tradeDeadline:   Number(settings.trade_deadline ?? 0),
        waiverType:      Number(settings.waiver_type ?? 0),
        faabBudget:      Number(settings.waiver_budget ?? 100),
        bestBall:        Boolean(settings.best_ball),
        taxiSlots:       Number(settings.taxi_slots ?? 0),
      }),
      status: 'active',
    }
  })

  emit({ step: 'settings', progress: 30, message: 'League created — copying managers...' })

  // 3. Build user lookup (userId → displayName, EXACT)
  const userMap = new Map<string, { displayName: string; avatar: string; username: string }>()
  for (const u of usersData) {
    userMap.set(String(u.user_id), {
      displayName: String(u.display_name ?? u.username ?? 'Unknown'),  // EXACT
      avatar:      String(u.avatar ?? ''),
      username:    String(u.username ?? ''),
    })
  }

  // 4. Create LeagueTeam rows — exact manager names
  if (options.copyRosters) {
    for (const roster of rostersData) {
      const ownerId   = String(roster.owner_id ?? '')
      const userInfo  = userMap.get(ownerId) ?? { displayName: `Team ${roster.roster_id}`, avatar: '', username: '' }
      const rSettings = roster.settings as Record<string,unknown> ?? {}

      await prisma.leagueTeam.create({
        data: {
          leagueId:    afLeague.id,
          externalId:  String(roster.roster_id),
          ownerName:   userInfo.displayName,   // EXACT copy
          teamName:    userInfo.displayName,   // Sleeper uses display names as team names
          avatarUrl:   userInfo.avatar || null,
          wins:        Number(rSettings.wins   ?? 0),
          losses:      Number(rSettings.losses ?? 0),
          ties:        Number(rSettings.ties   ?? 0),
          pointsFor:   Number(rSettings.fpts   ?? 0),
          pointsAgainst: 0,
          currentRank: 0,
        }
      })

      // Create Roster row with player data
      await prisma.roster.create({
        data: {
          leagueId:      afLeague.id,
          platformUserId: ownerId,
          playerData:    toPrismaJsonInput({
            starters: roster.starters ?? [],
            players:  roster.players  ?? [],
            reserve:  roster.reserve  ?? [],
            taxi:     roster.taxi     ?? [],
          }),
          faabRemaining: Number((roster.settings as Record<string,unknown>)?.waiver_budget_used ?? 0),
        }
      })
    }
  }

  emit({ step: 'rosters', progress: 50, message: 'Rosters copied — fetching draft history...' })

  // 5. Draft history
  if (options.copyDraftHistory) {
    try {
      const drafts = await sleeperGet<Record<string,unknown>[]>(`/league/${leagueId}/drafts`)
      for (const draft of drafts) {
        const draftId  = String(draft.draft_id)
        const picks    = await sleeperGet<Record<string,unknown>[]>(`/draft/${draftId}/picks`)

        await prisma.mockDraft.create({
          data: {
            leagueId:  afLeague.id,
            userId,
            shareId:   null,
            rounds:    Number(draft.settings && (draft.settings as Record<string,unknown>).rounds) || 15,
            results:   toPrismaJsonInput({
              draftId,
              type:     draft.type,
              status:   draft.status,
              season:   draft.season,
              picks:    picks.map(p => ({
                round:       p.round,
                pick:        p.pick_no,
                playerId:    p.player_id,
                pickedBy:    p.picked_by,
                rosterId:    p.roster_id,
                // Exact metadata
                metadata:    p.metadata,
              })),
            }),
          }
        })
      }
      emit({ step: 'drafts', progress: 70, message: 'Draft history imported...' })
    } catch {
      // Draft import failure is non-fatal
      emit({ step: 'drafts', progress: 70, message: 'Draft history unavailable — skipping...' })
    }
  }

  // 6. Playoff history (bracket)
  if (options.copyPlayoffHistory) {
    try {
      const [wBracket, lBracket] = await Promise.all([
        sleeperGet<unknown>(`/league/${leagueId}/winners_bracket`),
        sleeperGet<unknown>(`/league/${leagueId}/losers_bracket`),
      ])
      // Store as league settings extension
      await prisma.league.update({
        where: { id: afLeague.id },
        data: {
          settings: toPrismaJsonInput({
            ...(afLeague.settings as Record<string,unknown>),
            playoffBracket: { winners: wBracket, losers: lBracket },
          })
        }
      })
      emit({ step: 'playoffs', progress: 85, message: 'Playoff brackets imported...' })
    } catch {
      emit({ step: 'playoffs', progress: 85, message: 'Playoff data unavailable — skipping...' })
    }
  }

  // 7. Trade history (transactions)
  if (options.copyTradeHistory) {
    try {
      const weeks = Array.from({ length: 18 }, (_, i) => i + 1)
      const tradeTxns: unknown[] = []
      for (const week of weeks.slice(0, 18)) {
        const txns = await sleeperGet<Record<string,unknown>[]>(`/league/${leagueId}/transactions/${week}`)
        const trades = txns.filter(t => t.type === 'trade')
        tradeTxns.push(...trades)
      }
      if (tradeTxns.length > 0) {
        await prisma.league.update({
          where: { id: afLeague.id },
          data: {
            settings: toPrismaJsonInput({
              ...(afLeague.settings as Record<string,unknown>),
              tradeHistory: tradeTxns,
            })
          }
        })
      }
      emit({ step: 'trades', progress: 93, message: `${tradeTxns.length} trades imported...` })
    } catch {
      emit({ step: 'trades', progress: 93, message: 'Trade history unavailable — skipping...' })
    }
  }

  emit({ step: 'complete', progress: 100, message: 'Transfer complete!', leagueId: afLeague.id })
  return afLeague.id
}

// ─── ROUTE HANDLER ───────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: {
    platform:  Platform
    leagueId:  string
    username?: string
    season?:   string
    options:   TransferOptions
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { platform, leagueId, options } = body
  const userId = session.user.id

  if (!platform || !leagueId) {
    return NextResponse.json({ error: 'platform and leagueId are required' }, { status: 400 })
  }

  // Only Sleeper is fully supported right now
  if (platform !== 'sleeper') {
    return NextResponse.json({
      step:    'unavailable',
      progress: 0,
      message: `${platform.charAt(0).toUpperCase() + platform.slice(1)} transfer is coming soon. We're actively building it — Sleeper is fully supported now.`,
    } satisfies TransferProgress)
  }

  // Check if this league was already transferred
  const existing = await prisma.league.findFirst({
    where: { userId, platformLeagueId: leagueId, platform: 'sleeper' },
  })
  if (existing) {
    return NextResponse.json({
      step:     'complete',
      progress: 100,
      message:  'This league is already on AllFantasy.',
      leagueId: existing.id,
    } satisfies TransferProgress)
  }

  // Stream the progress via a ReadableStream (SSE-style JSON lines)
  const encoder = new TextEncoder()
  const stream  = new ReadableStream({
    async start(controller) {
      const emit = (p: TransferProgress) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(p)}\n\n`))
      }

      try {
        await transferFromSleeper(leagueId, userId, options, emit)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Transfer failed'
        emit({ step: 'error', progress: 0, message: msg, error: msg })
      } finally {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type':      'text/event-stream',
      'Cache-Control':     'no-cache, no-transform',
      'Connection':        'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

// ─── PREVIEW ENDPOINT (GET) ──────────────────────────────────────
// Fetches league data without creating anything — for the preview step

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const platform  = searchParams?.get('platform') as Platform | null
  const leagueId  = searchParams?.get('leagueId')

  if (!platform || !leagueId) {
    return NextResponse.json({ error: 'platform and leagueId required' }, { status: 400 })
  }

  if (platform !== 'sleeper') {
    return NextResponse.json({
      available: false,
      message:   `${platform} preview coming soon`,
    })
  }

  try {
    const [leagueData, usersData] = await Promise.all([
      sleeperGet<Record<string,unknown>>(`/league/${leagueId}`),
      sleeperGet<Record<string,unknown>[]>(`/league/${leagueId}/users`),
    ])

    const settings = leagueData.settings as Record<string,unknown> ?? {}
    const type     = Number(settings.type ?? 0)

    return NextResponse.json({
      available: true,
      league: {
        name:       String(leagueData.name ?? ''),
        season:     leagueData.season,
        sport:      leagueData.sport,
        teamCount:  leagueData.total_rosters,
        format:     type === 2 ? 'Dynasty' : type === 1 ? 'Keeper' : 'Redraft',
        scoring:    leagueData.scoring_settings,
        managers:   usersData.map(u => ({
          name:   String(u.display_name ?? u.username ?? 'Unknown'),  // EXACT
          avatar: u.avatar,
        })),
        rosterPositions: leagueData.roster_positions,
        playoffTeams:    settings.playoff_teams,
        hasDraft:        true,
      }
    })
  } catch (err: unknown) {
    return NextResponse.json({
      available: false,
      message:   err instanceof Error ? err.message : 'League not found',
    }, { status: 404 })
  }
}

