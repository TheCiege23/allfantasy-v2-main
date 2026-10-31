import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { assertLeagueCommissioner, assertLeagueMember } from '@/lib/league/league-access'
import { notifyCommissionerChange } from '@/lib/commissioner/CommissionerChangeNotifier'
import {
  DEVY_LEGACY_FIELDS,
  DEVY_LEGACY_LOCKED,
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

const ACTIVE_BUCKETS = new Set(['active_starter', 'active_bench', 'ir'])

export async function GET(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const leagueId = req.nextUrl.searchParams?.get('leagueId')?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueMember(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const config = await prisma.devyLeague.findUnique({ where: { leagueId } })
  if (!config) return NextResponse.json({ error: 'Devy league not configured' }, { status: 404 })
  return NextResponse.json({ config })
}

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json()) as { leagueId?: string }
  const leagueId = body.leagueId?.trim()
  if (!leagueId) return NextResponse.json({ error: 'leagueId required' }, { status: 400 })

  const gate = await assertLeagueCommissioner(leagueId, userId)
  if (!gate.ok) return NextResponse.json({ error: 'Forbidden' }, { status: gate.status })

  const existing = await prisma.devyLeague.findUnique({ where: { leagueId } })
  if (existing) return NextResponse.json({ config: existing })

  /*
   * 🛑 SEASON MUST COME FROM THE LEAGUE. `DevyLeague.season` carries `@default(2025)`, and a
   * config created today would take it — but it is not inert:
   *
   *   app/api/devy/picks/route.ts:28   `const season = seasonParam ? Number(seasonParam) : cfg.season`
   *   app/api/devy/draft/route.ts:156  same
   *
   * and picks/route then calls `generatePickInventory(leagueId, season, 3)`. So a devy league
   * configured now would generate its pick inventory for a season that has already passed, and
   * the draft pool cache would key on it too. Nothing throws; the wrong year is simply used.
   *
   * Same defect and same fix as IDPCapConfig — see the commissioner cap-config route, where the
   * identical stale default hid every current-season contract.
   */
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { season: true } })
  const config = await prisma.devyLeague.create({
    data: {
      leagueId,
      isDynastyOnly: true,
      season: Number(league?.season) || new Date().getUTCFullYear(),
    },
  })
  return NextResponse.json({ config })
}

/**
 * PATCH: commissioner edits this league's older `DevyLeague` record (the Commissioner Settings
 * legacy Devy tabs). Explicit allowlist in lib/legacy-specialty-settings/legacySettingsSpec.ts.
 *
 * Live-state locks (409), each read from the table the engine itself checks:
 *  - taxi slots   ≥ the most `devy_taxi_slots` rows any team holds (moveToTaxi refuses at the cap)
 *  - devy slots / max devy per team ≥ the most `devy_devy_slots` rows any team holds
 *  - active + bench + IR ≥ the most players any team holds in those buckets (assertActiveCapacity)
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
  if (!gate.ok) return NextResponse.json({ error: 'Commissioner only' }, { status: gate.status })

  const current = await prisma.devyLeague.findUnique({ where: { leagueId } })
  if (!current) return NextResponse.json({ error: 'Devy league not configured' }, { status: 404 })

  const parsed = parseLegacyPatch(body, DEVY_LEGACY_FIELDS, DEVY_LEGACY_LOCKED)
  if (!parsed.ok) return legacyParseError(parsed)

  const cur = current as unknown as Record<string, unknown>
  const data: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(parsed.data)) if (!legacySameValue(cur[k], v)) data[k] = v
  if (Object.keys(data).length === 0) return NextResponse.json({ ok: true, config: current, changed: [] })

  const next = { ...cur, ...data } as Record<string, number>

  // ── Slot counts against what teams hold now ──
  const conflicts: SlotConflict[] = []
  if ('taxiSlots' in data) {
    const rows = await prisma.devyTaxiSlot.findMany({ where: { leagueId }, select: { rosterId: true } })
    const held = maxPerRoster(rows)
    if (next.taxiSlots! < held) conflicts.push({ field: 'taxiSlots', held, requested: next.taxiSlots! })
  }
  if ('devySlots' in data || 'maxDevyPerTeam' in data) {
    const rows = await prisma.devyDevySlot.findMany({ where: { leagueId }, select: { rosterId: true } })
    const held = maxPerRoster(rows)
    for (const f of ['devySlots', 'maxDevyPerTeam'] as const) {
      if (f in data && next[f]! < held) conflicts.push({ field: f, held, requested: next[f]! })
    }
  }
  if ('activeRosterSize' in data || 'benchSlots' in data || 'irSlots' in data) {
    const rows = await prisma.devyPlayerState.findMany({
      where: { leagueId },
      select: { rosterId: true, bucketState: true },
    })
    const held = maxPerRoster(rows, (r) => ACTIVE_BUCKETS.has(r.bucketState))
    const requested = next.activeRosterSize! + next.benchSlots! + next.irSlots!
    if (requested < held) conflicts.push({ field: 'activeCapacity', held, requested })
  }
  if (conflicts.length) return slotConflictResponse(conflicts)

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
    const picks = await prisma.devyDraftPick.findMany({ where: { leagueId }, select: { season: true, isUsed: true } })
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

  const config = await prisma.devyLeague.update({ where: { leagueId }, data })

  const changes = Object.keys(data).map((k) => ({
    field: LEGACY_CHAT_LABELS[k] ?? k,
    oldValue: legacyValueText(cur[k]),
    newValue: legacyValueText(data[k]),
  }))
  await notifyCommissionerChange(leagueId, userId, 'Devy Settings', changes).catch(() => {})

  return NextResponse.json({ ok: true, config, changed: Object.keys(data) })
}

