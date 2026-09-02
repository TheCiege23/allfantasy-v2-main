import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getServedOrigin } from '@/lib/http/served-origin'
import { createZombieUniverseForTier } from '@/lib/zombie/setupEngine'
import type { ZombieUniverseTierId } from '@/lib/zombie/zombie-universe-tier'
import { isZombieEligibleLeagueSport } from '@/lib/zombie/zombie-sport-eligibility'
import { z } from 'zod'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const ZOMBIE_ALLOWED_TEAM_COUNTS = [8, 10, 12, 14, 16] as const

// `single_gamma` is included so the same endpoint can produce a one-league
// "universe" — the response surfaces primaryLeagueId and the client routes the
// user straight to /league/[id] (no commissioner dashboard for solo zombie).
const schema = z.object({
  zombieUniverseTier: z.enum(['single_gamma', 'beta_trio', 'alpha_hex']),
  /** Same JSON shape as `POST /api/league/create` (native manual path). */
  leagueCreatePayload: z.record(z.unknown()),
})

/**
 * Creates a Zombie universe + multiple manual leagues (3- or 6-league tiers).
 * Each league is created via the standard `/api/league/create` handler (cookie-forwarded).
 */
export async function POST(req: Request) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let json: unknown
  try {
    json = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload', details: parsed.error.flatten() }, { status: 400 })
  }

  const { zombieUniverseTier, leagueCreatePayload } = parsed.data
  const sportRaw = leagueCreatePayload.sport
  const sport = typeof sportRaw === 'string' ? sportRaw.toUpperCase() : 'NFL'
  if (!isZombieEligibleLeagueSport(sport)) {
    return NextResponse.json({ error: `Sport "${sportRaw}" is not eligible for Zombie universes.` }, { status: 400 })
  }

  // Snake-only — auction is rejected here so the per-league /api/league/create
  // call below never receives a draftType the zombie engine can't run.
  const requestedDraft =
    typeof leagueCreatePayload.draftType === 'string'
      ? leagueCreatePayload.draftType.toLowerCase()
      : 'snake'
  if (requestedDraft !== 'snake') {
    return NextResponse.json(
      { error: 'Zombie universes only support snake drafts (auction not supported).' },
      { status: 400 },
    )
  }
  // Reject any client attempt to enable playoffs on a zombie league.
  if (leagueCreatePayload.playoffEnabled === true || leagueCreatePayload.playoffsEnabled === true) {
    return NextResponse.json({ error: 'Zombie leagues cannot enable playoffs.' }, { status: 400 })
  }
  // Team count must be one of the allowed values; default to 12 when omitted.
  const requestedTeamCount =
    typeof leagueCreatePayload.leagueSize === 'number' ? leagueCreatePayload.leagueSize : 12
  if (!(ZOMBIE_ALLOWED_TEAM_COUNTS as readonly number[]).includes(requestedTeamCount)) {
    return NextResponse.json(
      { error: `Team count must be one of ${ZOMBIE_ALLOWED_TEAM_COUNTS.join(', ')}.` },
      { status: 400 },
    )
  }

  // Paid universe leagues are allowed, but must route dues through supported
  // external providers only.
  const requestedIsPaid = Boolean(leagueCreatePayload.isPaid)
  const requestedPaymentProvider =
    typeof leagueCreatePayload.paymentProvider === 'string'
      ? leagueCreatePayload.paymentProvider.toLowerCase()
      : null
  const requestedBuyIn =
    typeof leagueCreatePayload.buyIn === 'number' ? leagueCreatePayload.buyIn : null
  if (requestedIsPaid) {
    if (!requestedPaymentProvider || !['leaguesafe', 'fancred'].includes(requestedPaymentProvider)) {
      return NextResponse.json(
        { error: "Paid zombie leagues require paymentProvider: 'leaguesafe' or 'fancred'." },
        { status: 400 },
      )
    }
    if (requestedBuyIn == null || !Number.isFinite(requestedBuyIn) || requestedBuyIn <= 0) {
      return NextResponse.json(
        { error: 'Paid leagues require a buyIn amount greater than zero.' },
        { status: 400 },
      )
    }
  }

  const baseName =
    typeof leagueCreatePayload.name === 'string' && leagueCreatePayload.name.trim()
      ? String(leagueCreatePayload.name).trim()
      : `${sport} Zombie Universe`

  const universe = await createZombieUniverseForTier(session.user.id, {
    name: baseName,
    sport,
    tier: zombieUniverseTier as ZombieUniverseTierId,
  })

  // Self-directed fetch — see lib/http/served-origin.ts; new URL(req.url).origin
  // is the bind address here, not a host anything can connect to.
  const origin = getServedOrigin(req)
  const cookie = req.headers.get('cookie') ?? ''

  const created: { leagueId: string; name?: string | null; levelId: string | null; tierLabel: string | null }[] = []

  for (const level of universe.levels) {
    const slots = Math.max(1, level.leagueCount ?? 1)
    for (let i = 0; i < slots; i++) {
      const label = `${level.tierLabel ?? level.name} ${i + 1}`
      const merged = {
        ...leagueCreatePayload,
        name: `${baseName} — ${label}`,
        sport,
        settings: {
          ...(typeof leagueCreatePayload.settings === 'object' && leagueCreatePayload.settings !== null
            ? leagueCreatePayload.settings
            : {}),
          zombie_universe_id: universe.id,
          zombie_universe_tier: zombieUniverseTier,
          zombie_level_id: level.id,
          zombie_level_slot: `${level.tierLabel ?? 'Tier'}-${i + 1}`,
        },
      }

      const res = await fetch(`${origin}/api/league/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          cookie,
        },
        body: JSON.stringify(merged),
      })

      const data = (await res.json().catch(() => ({}))) as { league?: { id?: string; name?: string | null }; error?: string }
      if (!res.ok) {
        return NextResponse.json(
          {
            error: data.error ?? 'League creation failed mid-universe',
            partial: created,
            universeId: universe.id,
          },
          { status: res.status >= 400 ? res.status : 500 },
        )
      }
      const leagueId = data.league?.id
      if (leagueId) {
        created.push({
          leagueId,
          name: data.league?.name ?? merged.name,
          levelId: level.id,
          tierLabel: level.tierLabel ?? level.name,
        })
        await fetch(`${origin}/api/zombie/league`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', cookie },
          body: JSON.stringify({
            leagueId,
            sport,
            universeId: universe.id,
            tierId: level.id,
            name: merged.name,
            teamCount: typeof leagueCreatePayload.leagueSize === 'number' ? leagueCreatePayload.leagueSize : 12,
            isPaid: requestedIsPaid,
            paymentProvider: requestedPaymentProvider,
            buyIn: requestedBuyIn,
            whispererSelectionMode:
              (merged.settings as Record<string, unknown>)?.zombie_whisperer_selection === 'veteran_priority'
                ? 'veteran_priority'
                : 'random',
          }),
        }).catch(() => {})
      }
    }
  }

  // For solo zombie ("single_gamma"), tell the client to land on the standard
  // /league/[id] dashboard — there is no commissioner dashboard for one-league
  // universes per product spec.
  const requiresUniverseDashboard = zombieUniverseTier !== 'single_gamma'

  return NextResponse.json({
    success: true,
    universeId: universe.id,
    leagues: created,
    primaryLeagueId: created[0]?.leagueId ?? null,
    requiresUniverseDashboard,
    redirectTo:
      requiresUniverseDashboard
        ? `/zombie/universe/${universe.id}`
        : created[0]?.leagueId
          ? `/league/${created[0].leagueId}`
          : null,
  })
}
