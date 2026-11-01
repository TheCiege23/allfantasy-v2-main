import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner } from '@/lib/league/league-access'
import { isTaxiLockMode, type TaxiLockMode } from '@/lib/c2c/taxiLockResolver'
import { notifyCommissionerChange } from '@/lib/commissioner/CommissionerChangeNotifier'
import {
  C2C_LEGACY_FIELDS,
  C2C_LEGACY_LOCKED,
  LEGACY_CHAT_LABELS,
  legacySameValue,
  legacyValueText,
  parseLegacyPatch,
} from '@/lib/legacy-specialty-settings/legacySettingsSpec'
import {
  draftIsRunning,
  maxPerRoster,
  seasonDraftUnderWay,
  startupDraftHasStarted,
  type SlotConflict,
} from '@/lib/legacy-specialty-settings/legacySettingsLocks'
import { legacyParseError, slotConflictResponse } from '@/lib/legacy-specialty-settings/legacySettingsResponses'

export const dynamic = 'force-dynamic'

type StateRow = { rosterId: string; bucketState: string; playerSide: string }

/**
 * Slot field → which `c2c_player_states` rows occupy it. The college count is the same one
 * `movePlayer` hands `validateC2CRosterSlots` as `collegeSlotsFilled` (devy + campus starters).
 */
const SLOT_OCCUPANTS: Record<string, (r: StateRow) => boolean> = {
  campusStarterSlots: (r) => r.bucketState === 'campus_starter',
  cantonStarterSlots: (r) => r.bucketState === 'canton_starter',
  benchSlots: (r) => r.bucketState === 'bench',
  taxiSlots: (r) => r.bucketState === 'taxi',
  irSlots: (r) => r.bucketState === 'ir',
  devySlots: (r) => r.bucketState === 'devy' || (r.bucketState === 'campus_starter' && r.playerSide === 'campus'),
}

/**
 * PATCH: commissioner edits this league's older `C2CLeague` record — the Commissioner Settings
 * legacy C2C tabs (Format, Rosters, Scoring, Taxi, Devy, Drafts). Explicit allowlist in
 * lib/legacy-specialty-settings/legacySettingsSpec.ts. `taxiLockMode` is stored in
 * `League.settings.c2cTaxiLockMode`, which `resolveTaxiLock()` reads.
 *
 * Live-state locks (409):
 *  - each slot count ≥ the most players any team holds in that bucket today
 *  - startup draft format: frozen once a live draft session has started
 *  - future draft format: frozen while a live draft runs or a season's picks are part used
 */
export async function PATCH(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = (await req.json().catch(() => null)) as unknown
  const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId.trim() : ''
  if (!body || !leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueCommissioner(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const current = await prisma.c2CLeague.findUnique({ where: { leagueId } })
  if (!current) return NextResponse.json({ error: 'C2C not configured' }, { status: 404 })

  const parsed = parseLegacyPatch(body, C2C_LEGACY_FIELDS, C2C_LEGACY_LOCKED)
  if (!parsed.ok) return legacyParseError(parsed)

  const patch = { ...parsed.data }

  // Campus + canton weights always sum to 1: send one and the other follows.
  const hasCampus = 'campusScoreWeight' in patch
  const hasCanton = 'cantonScoreWeight' in patch
  if (hasCampus && hasCanton) {
    const sum = (patch.campusScoreWeight as number) + (patch.cantonScoreWeight as number)
    if (Math.abs(sum - 1) > 0.011) {
      return NextResponse.json(
        {
          error: 'campusScoreWeight and cantonScoreWeight must add up to 1',
          code: 'INVALID_FIELDS',
          invalid: [{ field: 'cantonScoreWeight', reason: 'must add up to 1 with campusScoreWeight' }],
        },
        { status: 400 },
      )
    }
  } else if (hasCampus) {
    patch.cantonScoreWeight = Math.round((1 - (patch.campusScoreWeight as number)) * 100) / 100
  } else if (hasCanton) {
    patch.campusScoreWeight = Math.round((1 - (patch.cantonScoreWeight as number)) * 100) / 100
  }

  const leagueSettings = ((gate.league as { settings?: unknown }).settings ?? {}) as Record<string, unknown>
  const currentMode: TaxiLockMode = isTaxiLockMode(leagueSettings.c2cTaxiLockMode)
    ? leagueSettings.c2cTaxiLockMode
    : 'no_limit'

  let nextMode: TaxiLockMode | null = null
  if ('taxiLockMode' in patch) {
    if (patch.taxiLockMode !== currentMode) nextMode = patch.taxiLockMode as TaxiLockMode
    delete patch.taxiLockMode
  }

  const cur = current as unknown as Record<string, unknown>
  const data: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) if (!legacySameValue(cur[k], v)) data[k] = v

  if (Object.keys(data).length === 0 && !nextMode) {
    return NextResponse.json({ ok: true, c2c: { ...current, taxiLockMode: currentMode }, config: current, taxiLockMode: currentMode, changed: [] })
  }

  // ── Slot counts against what teams hold now ──
  const slotFields = Object.keys(data).filter((k) => k in SLOT_OCCUPANTS)
  if (slotFields.length) {
    const rows = await prisma.c2CPlayerState.findMany({
      where: { leagueId },
      select: { rosterId: true, bucketState: true, playerSide: true },
    })
    const conflicts: SlotConflict[] = []
    for (const f of slotFields) {
      const held = maxPerRoster(rows, SLOT_OCCUPANTS[f]!)
      const requested = data[f] as number
      if (requested < held) conflicts.push({ field: f, held, requested })
    }
    if (conflicts.length) return slotConflictResponse(conflicts)
  }

  // ── Draft formats against drafts in play ──
  if ('startupDraftFormat' in data && (await startupDraftHasStarted(leagueId))) {
    return NextResponse.json(
      {
        error: 'The startup draft has started, so its format can no longer change.',
        code: 'DRAFT_STARTED',
        field: 'startupDraftFormat',
      },
      { status: 409 },
    )
  }
  if ('futureDraftFormat' in data) {
    const picks = await prisma.c2CDraftPick.findMany({ where: { leagueId }, select: { season: true, isUsed: true } })
    if ((await draftIsRunning(leagueId)) || seasonDraftUnderWay(picks)) {
      return NextResponse.json(
        {
          error: 'A draft is under way. Change the future draft format after it ends.',
          code: 'DRAFT_IN_PROGRESS',
          field: 'futureDraftFormat',
        },
        { status: 409 },
      )
    }
  }

  // Taxi lock mode lives in League.settings so it doesn't require a new Prisma column.
  if (nextMode) {
    await prisma.league.update({
      where: { id: leagueId },
      data: { settings: { ...leagueSettings, c2cTaxiLockMode: nextMode } },
    })
  }

  const updated = Object.keys(data).length
    ? await prisma.c2CLeague.update({ where: { leagueId }, data })
    : current
  const taxiLockMode = nextMode ?? currentMode

  const changes = Object.keys(data).map((k) => ({
    field: LEGACY_CHAT_LABELS[k] ?? k,
    oldValue: legacyValueText(cur[k]),
    newValue: legacyValueText(data[k]),
  }))
  if (nextMode) changes.push({ field: LEGACY_CHAT_LABELS.taxiLockMode!, oldValue: currentMode, newValue: nextMode })
  await notifyCommissionerChange(leagueId, userId, 'C2C Settings', changes).catch(() => {})

  const changed = [...Object.keys(data), ...(nextMode ? ['taxiLockMode'] : [])]
  return NextResponse.json({
    ok: true,
    c2c: { ...updated, taxiLockMode },
    config: updated,
    taxiLockMode,
    changed,
  })
}
