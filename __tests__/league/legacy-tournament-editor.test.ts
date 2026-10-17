/**
 * Legacy tournament editor in the Specialty tab: the parser's locks and types, and the handler's
 * `legacyTournament` read and save against an in-memory LegacyTournament. The access rule is the
 * real lib/tournament/legacyTournamentAccess (creator, or staff with settings permission).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = {
    session: 'u-creator',
    staff: new Map<string, Record<string, boolean>>(),
    tournament: null as null | {
      id: string; name: string; sport: string; season: number; status: string; creatorId: string
      settings: Record<string, unknown>; hubSettings: Record<string, unknown>; lockedAt: Date | null
    },
    conferences: [] as Array<{ id: string; name: string; tournamentId: string; orderIndex: number }>,
    audits: [] as Array<Record<string, unknown>>,
  }
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))
  const prisma: Record<string, any> = {
    tournamentLeague: { findUnique: vi.fn(async () => null) },
    legacyTournamentLeague: {
      findUnique: vi.fn(async () => {
        const t = state.tournament
        if (!t) return null
        return {
          phase: 'qualification',
          roundIndex: 0,
          conference: { name: state.conferences[0]?.name ?? 'Black' },
          tournament: {
            ...clone({ ...t, lockedAt: null }),
            lockedAt: t.lockedAt,
            conferences: state.conferences.filter((c) => c.tournamentId === t.id).map(({ id, name }) => ({ id, name })),
            _count: { leagues: 10 },
          },
        }
      }),
    },
    legacyTournament: {
      findUnique: vi.fn(async ({ select }: { select: Record<string, boolean> }) => {
        const t = state.tournament
        if (!t) return null
        return select.creatorId ? { creatorId: t.creatorId } : { settings: clone(t.settings), hubSettings: clone(t.hubSettings) }
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(state.tournament!, clone(data))),
    },
    legacyTournamentStaff: {
      findUnique: vi.fn(async ({ where }: { where: { tournamentId_userId: { userId: string } } }) => {
        const p = state.staff.get(where.tournamentId_userId.userId)
        return p ? { permissions: p } : null
      }),
    },
    legacyTournamentConference: {
      count: vi.fn(async ({ where }: { where: { tournamentId: string; id: { in: string[] } } }) =>
        state.conferences.filter((c) => c.tournamentId === where.tournamentId && where.id.in.includes(c.id)).length),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { name: string } }) => {
        const c = state.conferences.find((x) => x.id === where.id)!
        c.name = data.name
        return c
      }),
    },
    legacyTournamentAuditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => state.audits.push(data)) },
  }
  prisma.$transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma))
  return { state, prisma }
})

vi.mock('@/lib/prisma', () => ({ prisma: h.prisma }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { id: h.state.session, email: null } })) }))
vi.mock('@/lib/subscription/entitlement-middleware', () => ({ requireFeatureEntitlement: vi.fn() }))
vi.mock('@/lib/guillotine/GuillotineLeagueConfig', () => ({ getGuillotineConfig: vi.fn(), upsertGuillotineConfig: vi.fn() }))
vi.mock('@/lib/salary-cap/SalaryCapLeagueConfig', () => ({ getSalaryCapConfig: vi.fn(), upsertSalaryCapConfig: vi.fn() }))
vi.mock('@/lib/scoring-engine/resolveTeamLabels', () => ({ buildRosterLabelMap: vi.fn(async () => new Map()) }))
vi.mock('@/lib/league/specialty-settings-access', async (orig) => {
  const actual = await orig<typeof import('@/lib/league/specialty-settings-access')>()
  return {
    ...actual,
    detectGatedSpecialtyFormats: vi.fn(async () => ['tournament']),
    resolveSpecialtySettingsAccess: vi.fn(async () => ({
      isCommish: true, canEdit: true, coveredBySubscription: true, unlock: null, season: 2026,
      tokenCost: 200, paywallLive: true, paywallStartsAt: '2026-10-15',
    })),
    specialtySettingsEditRefusal: vi.fn(async () => null),
  }
})

import { legacyTournamentEditorValue, parseLegacyTournamentPatch } from '@/lib/tournament-mode/legacyTournamentEditor'
import { GET, PATCH } from '@/app/api/leagues/[leagueId]/specialty-settings/handler'

const open = { locked: false, live: false }

describe('parseLegacyTournamentPatch', () => {
  it('writes the keys the engine reads, never the ones it ignores', () => {
    const r = parseLegacyTournamentPatch({ bubbleWeekEnabled: true, eliminationAdvancementPerLeague: 4, faabBudgetDefault: 200 }, open)
    expect(r).toEqual({
      ok: true,
      patch: { settings: { bubbleWeekEnabled: true, eliminationAdvancementPerLeague: 4, faabBudgetDefault: 200 } },
    })
  })

  it('refuses wrong types, out-of-range values and a bad tiebreaker list', () => {
    expect(parseLegacyTournamentPatch({ eliminationAdvancementPerLeague: 12 }, open).ok).toBe(false)
    expect(parseLegacyTournamentPatch({ faabBudgetDefault: '100' }, open).ok).toBe(false)
    expect(parseLegacyTournamentPatch({ faabResetByRound: 'yes' }, open).ok).toBe(false)
    expect(parseLegacyTournamentPatch({ qualificationTiebreakers: [] }, open).ok).toBe(false)
    expect(parseLegacyTournamentPatch({ qualificationTiebreakers: ['wins', 'wins'] }, open).ok).toBe(false)
    expect(parseLegacyTournamentPatch({ qualificationTiebreakers: ['coin_flip'] }, open).ok).toBe(false)
    expect(parseLegacyTournamentPatch({ draftType: 'linear' }, open).ok).toBe(false)
  })

  it('freezes name and description once locked, and draft type and bubble once live', () => {
    expect(parseLegacyTournamentPatch({ name: 'New' }, { locked: true, live: false }).ok).toBe(false)
    expect(parseLegacyTournamentPatch({ description: 'x' }, { locked: true, live: false }).ok).toBe(false)
    expect(parseLegacyTournamentPatch({ draftType: 'auction' }, { locked: false, live: true }).ok).toBe(false)
    expect(parseLegacyTournamentPatch({ bubbleWeekEnabled: true }, { locked: false, live: true }).ok).toBe(false)
    // Locked is not live: the cut can still be tuned before elimination.
    expect(parseLegacyTournamentPatch({ eliminationAdvancementPerLeague: 4 }, { locked: true, live: false }).ok).toBe(true)
  })

  it('reads defaults for keys a tournament never stored', () => {
    expect(legacyTournamentEditorValue({ name: 'T', settings: {}, hubSettings: {} })).toMatchObject({
      draftType: 'snake',
      bubbleWeekEnabled: false,
      eliminationAdvancementPerLeague: 6,
      qualificationTiebreakers: ['wins', 'points_for'],
      faabBudgetDefault: 100,
      faabResetByRound: true,
      benchSpotsElimination: 2,
    })
  })
})

const L = 'L1'
const params = { params: { leagueId: L } }
function req(method: string, body?: unknown) {
  return new Request(`http://localhost/api/leagues/${L}/specialty-settings`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as never
}

describe('specialty-settings handler — legacyTournament', () => {
  beforeEach(() => {
    h.state.session = 'u-creator'
    h.state.staff = new Map()
    h.state.audits = []
    h.prisma.legacyTournament.update.mockClear()
    h.state.tournament = {
      id: 'LT1', name: 'Black vs Gold', sport: 'NFL', season: 2026, status: 'qualification', creatorId: 'u-creator',
      settings: { draftType: 'snake', bubbleWeekEnabled: false, participantPoolSize: 120, someOtherKey: 'keep me' },
      hubSettings: { visibility: 'public' },
      lockedAt: null,
    }
    h.state.conferences = [
      { id: 'c1', name: 'Black', tournamentId: 'LT1', orderIndex: 0 },
      { id: 'c2', name: 'Gold', tournamentId: 'LT1', orderIndex: 1 },
    ]
  })

  it('GET shows the legacy tournament, editable for its creator', async () => {
    const body = await (await GET(req('GET'), params)).json()
    expect(body.tournament).toBeNull()
    expect(body.legacyTournament).toMatchObject({ tournamentId: 'LT1', canEdit: true, locked: false, live: false })
    expect(body.legacyTournament.value.eliminationAdvancementPerLeague).toBe(6)
  })

  it('PATCH merges into settings without dropping other keys, renames a conference, and audits', async () => {
    const res = await PATCH(
      req('PATCH', { legacyTournament: { bubbleWeekEnabled: true, description: 'Hi', conferenceNames: [{ id: 'c2', name: 'Golden' }] } }),
      params,
    )
    expect(res.status).toBe(200)
    expect(h.state.tournament!.settings).toEqual({
      draftType: 'snake', bubbleWeekEnabled: true, participantPoolSize: 120, someOtherKey: 'keep me',
    })
    expect(h.state.tournament!.hubSettings).toEqual({ visibility: 'public', description: 'Hi' })
    expect(h.state.conferences[1]!.name).toBe('Golden')
    expect(h.state.audits).toEqual([
      expect.objectContaining({ action: 'bulk_update', actorId: 'u-creator', metadata: expect.objectContaining({ fields: ['description', 'bubbleWeekEnabled', 'conference:c2'] }) }),
    ])
  })

  it('staff with settings permission may save; a plain league co-commish may not', async () => {
    h.state.session = 'u-staff'
    h.state.staff.set('u-staff', { manageSettings: true })
    expect((await PATCH(req('PATCH', { legacyTournament: { benchSpotsElimination: 3 } }), params)).status).toBe(200)
    h.state.session = 'u-co'
    const get = await (await GET(req('GET'), params)).json()
    expect(get.legacyTournament.canEdit).toBe(false)
    expect((await PATCH(req('PATCH', { legacyTournament: { benchSpotsElimination: 1 } }), params)).status).toBe(403)
    expect(h.state.tournament!.settings.benchSpotsElimination).toBe(3)
  })

  it('refuses a conference from another tournament and a change that the live bracket freezes', async () => {
    h.state.conferences.push({ id: 'cX', name: 'Elsewhere', tournamentId: 'LT2', orderIndex: 0 })
    expect((await PATCH(req('PATCH', { legacyTournament: { conferenceNames: [{ id: 'cX', name: 'Mine' }] } }), params)).status).toBe(404)
    expect(h.state.conferences.find((c) => c.id === 'cX')!.name).toBe('Elsewhere')
    h.state.tournament!.status = 'elimination'
    expect((await PATCH(req('PATCH', { legacyTournament: { draftType: 'auction' } }), params)).status).toBe(400)
    expect(h.state.tournament!.settings.draftType).toBe('snake')
  })

  it('a save that changes nothing writes and audits nothing', async () => {
    expect((await PATCH(req('PATCH', { legacyTournament: { draftType: 'snake' } }), params)).status).toBe(200)
    expect(h.prisma.legacyTournament.update).not.toHaveBeenCalled()
    expect(h.state.audits).toEqual([])
  })
})
