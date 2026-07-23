import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { computeLeagueCount, createTournament } from '@/lib/tournament-mode/TournamentCreationService'
import { validateCommissionerLeagueNames } from '@/lib/tournament-mode/LeagueNamingService'
import { DEFAULT_TOURNAMENT_SETTINGS } from '@/lib/tournament-mode/constants'
import { TOURNAMENT_PARTICIPANT_POOL_SIZES_EXTENDED } from '@/lib/tournament-mode/pool-sizes'
import type { TournamentSettings } from '@/lib/tournament-mode/types'
import { isSupportedSport } from '@/lib/sport-scope'
import { RetiredConceptError } from '@/lib/league-creation/retiredConcepts'
import { z } from 'zod'

/**
 * Tournament hub creation — uses `TournamentCreationService` (not POST /api/leagues).
 * Returns `leagueIds` so clients can navigate to `/league/[firstFeederId]?tournamentHub=...`
 * for the unified league shell; hub tools remain available from settings / tournament routes.
 */

const VALID_POOL_SIZES = new Set(TOURNAMENT_PARTICIPANT_POOL_SIZES_EXTENDED)

const createBodySchema = z.object({
  name: z.string().min(1).max(120),
  sport: z.string().min(1).max(8),
  season: z.number().int().optional(),
  variant: z.string().max(32).optional(),
  settings: z.record(z.unknown()).optional(),
  hubSettings: z.record(z.unknown()).optional(),
  conferenceNames: z.tuple([z.string(), z.string()]).optional(),
  leagueNames: z.array(z.string()).optional(),
})

export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as any)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = createBodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid input' },
      { status: 400 }
    )
  }

  const { name, sport, season, variant, settings, hubSettings, conferenceNames, leagueNames } = parsed.data
  if (!isSupportedSport(sport)) {
    return NextResponse.json(
      { error: 'Sport must be one of: NFL, NBA, MLB, NHL, NCAAF, NCAAB, SOCCER' },
      { status: 400 }
    )
  }

  const mergedSettings: Partial<TournamentSettings> = {
    ...DEFAULT_TOURNAMENT_SETTINGS,
    ...settings,
  }

  const poolSize = mergedSettings.participantPoolSize ?? DEFAULT_TOURNAMENT_SETTINGS.participantPoolSize
  if (!(VALID_POOL_SIZES as Set<number>).has(poolSize)) {
    return NextResponse.json(
      { error: `Participant pool size must be one of: ${[...TOURNAMENT_PARTICIPANT_POOL_SIZES_EXTENDED].join(', ')}` },
      { status: 400 }
    )
  }

  const rawDraft = String(mergedSettings.draftType ?? DEFAULT_TOURNAMENT_SETTINGS.draftType).toLowerCase()
  if (!['snake', 'linear', 'auction'].includes(rawDraft)) {
    return NextResponse.json(
      { error: 'Draft type must be snake or auction' },
      { status: 400 }
    )
  }
  const draftType = rawDraft === 'linear' ? 'snake' : rawDraft === 'auction' ? 'auction' : 'snake'
  mergedSettings.draftType = draftType as typeof mergedSettings.draftType

  mergedSettings.initialLeagueSize = 12
  const computedLeagueCount = computeLeagueCount(poolSize, 12)
  if (computedLeagueCount < 2) {
    return NextResponse.json(
      { error: 'Tournament mode requires at least 2 feeder leagues. Lower league size or increase participant pool.' },
      { status: 400 }
    )
  }

  if (mergedSettings.leagueNamingMode === 'commissioner_custom' && leagueNames?.length) {
    const validation = validateCommissionerLeagueNames(leagueNames)
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.errors.join(' ') },
        { status: 400 }
      )
    }
    if (leagueNames.length < computedLeagueCount) {
      return NextResponse.json(
        {
          error: `Commissioner naming mode requires ${computedLeagueCount} league names for this pool size (${poolSize} managers), but only ${leagueNames.length} were provided.`,
        },
        { status: 400 }
      )
    }
  }

  try {
    const result = await createTournament({
      name,
      sport,
      creatorId: userId,
      season,
      variant: variant ?? 'black_vs_gold',
      settings: mergedSettings,
      hubSettings,
      conferenceNames,
      leagueNames,
    })
    return NextResponse.json({
      tournamentId: result.tournamentId,
      leagueIds: result.leagueIds,
      inviteDistribution: result.inviteDistribution,
      conferenceNames: result.conferenceNames,
    })
  } catch (err) {
    // Tournament Mode is retired from active creation — surface the stable
    // reason code as a 400 rather than letting it fall through to a generic 500.
    if (err instanceof RetiredConceptError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    }
    console.error('[tournament/create] Error:', err)
    return NextResponse.json(
      { error: 'Failed to create tournament' },
      { status: 500 }
    )
  }
}
