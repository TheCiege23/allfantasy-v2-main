/**
 * [UPDATED] GET/PUT: Commissioner roster settings (multi-sport: NFL + NBA).
 */
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import {
  checkCommissionerPermission,
  getLeagueRosterConfig,
  getRosterEngineRegistry,
  updateLeagueRosterConfig,
} from '@/lib/roster-engine'
import { notifyCommissionerChange } from '@/lib/commissioner/CommissionerChangeNotifier'
import { invalidateLeagueDraftCaches } from '@/lib/league/invalidateLeagueDraftCaches'
import { settingsLockedResponse } from '@/lib/league/settingsLockGuard'
import { decideSettingsEdit, recordMidSeasonSettingsChange } from '@/lib/league/settingsLifecycleGate'
import { applyRosterTemplateChange } from '@/lib/draft/syncDraftRoundsToRoster'
import { EntitlementResolver } from '@/lib/subscription/EntitlementResolver'
import {
  PROSPECT_STASH_UNAVAILABLE_CODE,
  PROSPECT_STASH_UNAVAILABLE_MESSAGE,
  filterRosterTemplatesForProspectPolicy,
  findAddedProspectStashSlots,
  isProspectStashSlotKey,
  sportSupportsProspectStash,
} from '@/lib/league-creation/prospectStashPolicy'

export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  /*
   * 🛑 MEMBER GATE. This GET returned the league to ANY signed-in user. It
   * computed the commissioner flag and handed it back as a FIELD for the UI to
   * branch on, and never refused on it — so naming any leagueId returned that
   * league's settings and team list, owner names included.
   *
   * ⚠ MEMBER-LEVEL, NOT COMMISSIONER-LEVEL, AND THAT IS LOAD-BEARING.
   * `LeagueDuesTrackerPanel` and `RosterSettingsEditor` fetch this, read
   * `isCommissioner` off the response, and render READ-ONLY for ordinary
   * members. Gating at commissioner level would close the hole and break every
   * non-commissioner in the league. The write handlers keep their own stricter
   * check; this one only has to exclude non-members.
   *
   * ⚠ BEFORE THE READ, not after. `resolveLeagueMembership` is the four-path
   * canonical predicate (owner, RedraftLeagueMember, roster-backed, claimed
   * team) and returns 401/404/403 itself, so a missing league and a league that
   * is not yours stay indistinguishable to the caller.
   */
  const membership = await resolveLeagueMembership(leagueId, session.user.id)
  if (!membership.ok) {
    return NextResponse.json(
      { error: membership.status === 404 ? 'Not found' : 'Forbidden' },
      { status: membership.status },
    )
  }

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, sport: true, leagueType: true, leagueVariant: true } })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const registry = getRosterEngineRegistry()
  if (!registry.isSupported(league.sport)) {
    return NextResponse.json({ error: `Roster settings not yet available for ${league.sport}` }, { status: 400 })
  }

  const service = registry.getService(league.sport)
  const permission = await checkCommissionerPermission(session.user.id, leagueId)
  const defaultTemplate = service.resolveDefaultTemplate(league.leagueType ?? 'redraft')
  const [config, unifiedConfig] = await Promise.all([
    service.getConfig(leagueId),
    getLeagueRosterConfig(leagueId),
  ])

  // NHL / MLB: do not OFFER taxi / prospect slots. A slot this league already has stays listed, so an
  // existing league's editor still renders and can reduce it.
  const currentSlots = config.slots ?? {}
  const slotDefs = sportSupportsProspectStash(league.sport)
    ? service.getSlots()
    : service.getSlots().filter((def) => !isProspectStashSlotKey(def.key) || Number(currentSlots[def.key] ?? 0) > 0)

  return NextResponse.json({
    config,
    unifiedConfig,
    slotDefs,
    templates: filterRosterTemplatesForProspectPolicy(league.sport, service.getTemplates()),
    defaultTemplateKey: defaultTemplate.key,
    isCommissioner: permission.isCommissioner,
    roleAwareReadOnlyMode: permission.readOnly,
    sport: league.sport,
    leagueType: league.leagueType,
    leagueVariant: league.leagueVariant,
  })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ leagueId: string }> }) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { leagueId } = await params
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, sport: true } })
  if (!league) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const registry = getRosterEngineRegistry()
  if (!registry.isSupported(league.sport)) {
    return NextResponse.json({ error: `Roster settings not yet available for ${league.sport}` }, { status: 400 })
  }

  if (league.userId !== session.user.id) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
  const locked = await settingsLockedResponse(leagueId, 'rosters')
  if (locked) return locked

  const body = await req.json().catch(() => ({}))
  const slots = body.slots as Record<string, number> | undefined
  const templateKey = (body.templateKey as string) ?? 'custom'
  if (!slots || typeof slots !== 'object') return NextResponse.json({ error: 'slots required' }, { status: 400 })
  const lifecycle = await decideSettingsEdit(leagueId, session.user.id, 'roster', body)
  if (!lifecycle.ok) return NextResponse.json(lifecycle.body, { status: lifecycle.status })

  const oldConfig = await getLeagueRosterConfig(leagueId)
  // NHL / MLB have no prospect pool: refuse adding or growing TAXI / PROSPECT / RIGHTS / MINORS.
  // Keeping or lowering what the league already has is allowed.
  const previousSlots = (await registry.getService(league.sport).getConfig(leagueId)).slots ?? {}
  const addedStash = findAddedProspectStashSlots(league.sport, slots, previousSlots)
  if (addedStash.length > 0) {
    return NextResponse.json(
      { error: PROSPECT_STASH_UNAVAILABLE_MESSAGE, code: PROSPECT_STASH_UNAVAILABLE_CODE, slots: addedStash },
      { status: 400 },
    )
  }
  await updateLeagueRosterConfig(leagueId, { templateKey, slots }, session.user.id)
  invalidateLeagueDraftCaches(leagueId)
  // Rounds = draftable roster spots, so the draft follows the roster it was just given.
  const draftRounds = await applyRosterTemplateChange(leagueId, {
    keepManualOverride: await hasAfCommissionerSub(session.user.id),
    logTag: 'roster-settings PUT',
  })
  const config = await registry.getService(league.sport).getConfig(leagueId)
  const unifiedConfig = await getLeagueRosterConfig(leagueId)

  // Notify league chat of roster changes
  try {
    const changes: { field: string; oldValue: string; newValue: string }[] = []
    const oldTemplateKey = oldConfig?.rosterTemplateKey
    if (templateKey && templateKey !== oldTemplateKey) {
      changes.push({ field: 'Roster Template', oldValue: oldTemplateKey ?? 'default', newValue: templateKey })
    }
    const oldSlots =
      oldConfig?.rosterConfig?.sections?.reduce<Record<string, number>>((acc, section) => {
        for (const [slotKey, slotCount] of Object.entries(section.slots ?? {})) {
          acc[slotKey] = Number(slotCount)
        }
        return acc
      }, {}) ?? undefined
    if (oldSlots && slots) {
      for (const [key, val] of Object.entries(slots)) {
        if (oldSlots[key] !== val) {
          changes.push({ field: key.replace(/_/g, ' ').toUpperCase(), oldValue: String(oldSlots[key] ?? 0), newValue: String(val) })
        }
      }
    }
    if (changes.length > 0) {
      await notifyCommissionerChange(leagueId, session.user.id, 'Roster Settings', changes)
    }
  } catch { /* non-fatal */ }

  await recordMidSeasonSettingsChange(lifecycle, { leagueId: leagueId, userId: session.user.id, section: 'roster', source: 'roster-settings', detail: { templateKey } })
  return NextResponse.json({ ok: true, config, unifiedConfig, draftRounds })
}

/** AF Commissioner entitlement — the same check the draft settings route uses for a manual round count. */
async function hasAfCommissionerSub(userId: string): Promise<boolean> {
  const r = await new EntitlementResolver()
    .resolveForUser(userId, 'commissioner_ai_tools')
    .catch(() => ({ hasAccess: false }))
  return Boolean(r.hasAccess)
}
