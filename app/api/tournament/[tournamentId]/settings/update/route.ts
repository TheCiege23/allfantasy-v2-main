/**
 * Commissioner-only PATCH for tournament-level settings (name, description,
 * advancement defaults, bubble config). Used by the General / Playoffs /
 * Advanced tabs of TournamentSettingsModalEditable. Read-only fields that
 * would orphan in-flight rounds (sport, conferenceCount, leaguesPerConference,
 * teamsPerLeague) are intentionally NOT accepted here — those require a full
 * rebalance + redraft flow.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logTournamentAudit } from '@/lib/tournament-mode/TournamentAuditService'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const NAME_MAX = 120
const DESCRIPTION_MAX = 1500
const FAAB_MAX = 10_000
const BENCH_MAX = 20
// The advance route clamps to 11; storing 12 would be shown as 12 and applied as 11.
const ADV_MAX = 11

// Mirror the validation surface of /api/tournament/create — only snake +
// auction are runnable by TournamentRedraftService today. Allowing 3rd_reversal
// or linear here would let a commissioner store a value the redraft engine
// silently downgrades back to snake on every round.
const ALLOWED_DRAFT_TYPES = ['snake', 'auction'] as const
type AllowedDraftType = (typeof ALLOWED_DRAFT_TYPES)[number]

function clampInt(v: unknown, min: number, max: number): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return null
  return Math.max(min, Math.min(max, Math.floor(n)))
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ tournamentId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id ?? null
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tournamentId } = await params
  const tournament = await prisma.legacyTournament.findUnique({
    where: { id: tournamentId },
    select: { creatorId: true, name: true, settings: true, hubSettings: true, status: true },
  })
  if (!tournament) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (tournament.creatorId !== userId) {
    return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const currentSettings: Record<string, unknown> = (tournament.settings as Record<string, unknown> | null) ?? {}
  const currentHub: Record<string, unknown> = (tournament.hubSettings as Record<string, unknown> | null) ?? {}
  const isLocked = Boolean(currentSettings.locked)
  const isLive = ['elimination', 'finals'].includes(tournament.status ?? '')

  const update: { name?: string; settings?: Record<string, unknown>; hubSettings?: Record<string, unknown> } = {}
  const settings: Record<string, unknown> = { ...currentSettings }
  const hubSettings: Record<string, unknown> = { ...currentHub }
  const changed: string[] = []

  if (typeof body.name === 'string' && body.name.trim().length > 0) {
    const v = body.name.trim().slice(0, NAME_MAX)
    if (v !== tournament.name) {
      update.name = v
      changed.push('name')
    }
  }
  // Description lives on hubSettings — LegacyTournament has no first-class column for it.
  if (typeof body.description === 'string') {
    const v = body.description.slice(0, DESCRIPTION_MAX)
    if (v !== (typeof currentHub.description === 'string' ? currentHub.description : '')) {
      hubSettings.description = v
      changed.push('description')
    }
  }

  // ---- Advancement defaults (safe to edit while locked but never mid-elimination) ----
  if (body.faabBudgetDefault != null) {
    const v = clampInt(body.faabBudgetDefault, 0, FAAB_MAX)
    if (v != null && v !== currentSettings.faabBudgetDefault) {
      settings.faabBudgetDefault = v
      changed.push('faabBudgetDefault')
    }
  }
  if (body.benchSpotsElimination != null) {
    const v = clampInt(body.benchSpotsElimination, 0, BENCH_MAX)
    if (v != null && v !== currentSettings.benchSpotsElimination) {
      settings.benchSpotsElimination = v
      changed.push('benchSpotsElimination')
    }
  }
  // ⚠ The engine reads `eliminationAdvancementPerLeague` (/api/tournament/[id]/advance, clamped to
  // 11 there). This route used to write `advancementPerLeague`, which nothing reads — a save that
  // changed nothing. The old body name is still accepted from older clients.
  const advRaw = body.eliminationAdvancementPerLeague ?? body.advancementPerLeague
  if (advRaw != null) {
    const v = clampInt(advRaw, 1, ADV_MAX)
    if (v != null && v !== currentSettings.eliminationAdvancementPerLeague) {
      settings.eliminationAdvancementPerLeague = v
      changed.push('eliminationAdvancementPerLeague')
    }
  }
  if (body.faabResetByRound != null) {
    const v = Boolean(body.faabResetByRound)
    if (v !== Boolean(currentSettings.faabResetByRound)) {
      settings.faabResetByRound = v
      changed.push('faabResetByRound')
    }
  }

  // ---- Draft type — locked once tournament is live to avoid corrupting in-flight rounds ----
  if (typeof body.draftType === 'string') {
    const dt = body.draftType.toLowerCase() as AllowedDraftType
    if (!(ALLOWED_DRAFT_TYPES as readonly string[]).includes(dt)) {
      return NextResponse.json({ error: `draftType must be one of ${ALLOWED_DRAFT_TYPES.join(', ')}` }, { status: 400 })
    }
    if (isLive) {
      return NextResponse.json({ error: 'Cannot change draftType after elimination has started' }, { status: 400 })
    }
    if (dt !== currentSettings.draftType) {
      settings.draftType = dt
      changed.push('draftType')
    }
  }

  // ---- Bubble config (safe to flip pre-elimination only) ----
  // ⚠ The engine reads `bubbleWeekEnabled` (TournamentStandingsService, TournamentProgressionService,
  // the bracket route). This route used to write `bubbleEnabled`, which nothing reads. The old body
  // name is still accepted from older clients.
  const bubbleRaw = body.bubbleWeekEnabled ?? body.bubbleEnabled
  if (bubbleRaw != null) {
    if (isLive) {
      return NextResponse.json({ error: 'Cannot toggle bubble after elimination has started' }, { status: 400 })
    }
    const v = Boolean(bubbleRaw)
    if (v !== Boolean(currentSettings.bubbleWeekEnabled)) {
      settings.bubbleWeekEnabled = v
      changed.push('bubbleWeekEnabled')
    }
  }
  // A legacy tournament's bubble has no size or scoring mode to set: the number of bubble spots
  // follows the cut (getBubbleSlotsPerConference). Refuse rather than store a value nothing reads.
  if (body.bubbleSize != null || body.bubbleScoringMode != null) {
    return NextResponse.json(
      { error: "This tournament's bubble size follows its cut and can't be set directly." },
      { status: 400 },
    )
  }

  if (changed.length === 0) {
    return NextResponse.json({ ok: true, changed: [], message: 'No changes' })
  }

  // Reject any tournament-name change while the tournament is locked — feels confusing
  // for participants who already saw posters/announcements with the original name.
  if (isLocked && (changed.includes('name') || changed.includes('description'))) {
    return NextResponse.json({ error: 'Tournament is locked — name/description are read-only' }, { status: 400 })
  }

  if (changed.some((k) => k !== 'name' && k !== 'description')) {
    update.settings = settings
  }
  if (changed.includes('description')) {
    update.hubSettings = hubSettings
  }

  await prisma.legacyTournament.update({
    where: { id: tournamentId },
    data: update,
  })

  await logTournamentAudit(tournamentId, 'bulk_update', {
    actorId: userId,
    metadata: { fields: changed, source: 'settings_modal' },
  }).catch(() => {})

  return NextResponse.json({ ok: true, changed })
}
