/**
 * Tournament editor in the Specialty tab: the type-strict parser, and the handler's `tournament`
 * read and save running the REAL lib/tournament/updateTournamentSettings against an in-memory
 * TournamentShell. Access, format detection and the specialty gate are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  type Shell = Record<string, unknown> & { id: string; commissionerId: string }
  const state = {
    session: 'u-tc',
    refuse: false,
    linked: true,
    advanced: 0,
    shell: null as Shell | null,
    conferences: [] as Array<{ id: string; name: string; isActive: boolean; conferenceNumber: number; tournamentId: string }>,
    audits: [] as Array<Record<string, unknown>>,
  }
  const prisma = {
    tournamentLeague: {
      findUnique: vi.fn(async () => {
        if (!state.linked || !state.shell) return null
        return {
          round: { roundLabel: 'Opening Round' },
          conference: { name: state.conferences[0]?.name ?? null },
          tournament: { ...state.shell, conferences: state.conferences.map(({ id, name, isActive }) => ({ id, name, isActive })) },
        }
      }),
    },
    tournamentAdvancementGroup: { count: vi.fn(async () => state.advanced) },
    tournamentShell: {
      findFirst: vi.fn(async ({ where }: { where: { id: string; commissionerId: string } }) =>
        state.shell && state.shell.id === where.id && state.shell.commissionerId === where.commissionerId
          ? { id: state.shell.id, currentParticipantCount: 0 }
          : null),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(state.shell!, data)),
    },
    tournamentConference: {
      findMany: vi.fn(async ({ where }: { where: { tournamentId: string; id: { in: string[] } } }) =>
        state.conferences.filter((c) => c.tournamentId === where.tournamentId && where.id.in.includes(c.id)).map((c) => ({ id: c.id }))),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: { name: string } }) => {
        const c = state.conferences.find((x) => x.id === where.id)!
        c.name = data.name
        return c
      }),
    },
    tournamentAuditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => state.audits.push(data)) },
    $transaction: vi.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
  }
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
  const { NextResponse } = await import('next/server')
  return {
    ...actual,
    detectGatedSpecialtyFormats: vi.fn(async () => ['tournament']),
    resolveSpecialtySettingsAccess: vi.fn(async () => ({
      isCommish: true, canEdit: true, coveredBySubscription: true, unlock: null, season: 2026,
      tokenCost: 200, paywallLive: true, paywallStartsAt: '2026-10-15',
    })),
    specialtySettingsEditRefusal: vi.fn(async () =>
      h.state.refuse ? NextResponse.json({ error: 'locked' }, { status: 402 }) : null),
  }
})

import { parseTournamentEditorPatch, type TournamentEditorValue } from '@/lib/tournament/tournamentEditorPatch'
import { GET, PATCH } from '@/app/api/leagues/[leagueId]/specialty-settings/handler'

const current: TournamentEditorValue = {
  name: 'Big Dance',
  advancersPerLeague: 1,
  wildcardCount: 2,
  bubbleEnabled: true,
  bubbleSize: 8,
  tiebreakerMode: 'points_for',
}

describe('parseTournamentEditorPatch', () => {
  it('passes typed values through and trims names', () => {
    expect(parseTournamentEditorPatch({ name: '  Spring Bash ', bubbleSize: 4, tiebreakerMode: 'points_against_inverse' }, current)).toEqual({
      ok: true,
      patch: { name: 'Spring Bash', bubbleSize: 4, tiebreakerMode: 'points_against_inverse' },
    })
  })

  it('refuses wrong types instead of coercing them', () => {
    expect(parseTournamentEditorPatch({ advancersPerLeague: '2' }, current).ok).toBe(false)
    expect(parseTournamentEditorPatch({ bubbleEnabled: 'false' }, current).ok).toBe(false)
    expect(parseTournamentEditorPatch({ wildcardCount: 1.5 }, current).ok).toBe(false)
    expect(parseTournamentEditorPatch({ tiebreakerMode: 'coin_flip' }, current).ok).toBe(false)
    expect(parseTournamentEditorPatch({ name: '   ' }, current).ok).toBe(false)
    expect(parseTournamentEditorPatch({ conferenceNames: [{ id: 'c1', name: '' }] }, current).ok).toBe(false)
  })

  it('allows a conference-wide cut (0 per league) but never an empty cut', () => {
    // 0 per league + the saved 2 per conference is a real format.
    expect(parseTournamentEditorPatch({ advancersPerLeague: 0 }, current)).toEqual({ ok: true, patch: { advancersPerLeague: 0 } })
    // Zeroing the other half against a saved 0 per league leaves nobody advancing.
    const zeroPerLeague = { ...current, advancersPerLeague: 0 }
    expect(parseTournamentEditorPatch({ wildcardCount: 0 }, zeroPerLeague).ok).toBe(false)
    expect(parseTournamentEditorPatch({ advancersPerLeague: 0, wildcardCount: 0 }, current).ok).toBe(false)
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

describe('specialty-settings handler — tournament', () => {
  beforeEach(() => {
    h.state.session = 'u-tc'
    h.state.refuse = false
    h.state.linked = true
    h.state.advanced = 0
    h.state.audits = []
    h.state.shell = {
      id: 'T1', name: 'Big Dance', sport: 'NFL', status: 'active', commissionerId: 'u-tc',
      currentRoundNumber: 1, totalRounds: 4, conferenceCount: 2, leaguesPerConference: 6, teamsPerLeague: 10,
      advancersPerLeague: 1, wildcardCount: 2, bubbleEnabled: true, bubbleSize: 8, tiebreakerMode: 'points_for',
    }
    h.state.conferences = [
      { id: 'c1', name: 'East', isActive: true, conferenceNumber: 1, tournamentId: 'T1' },
      { id: 'c2', name: 'West', isActive: true, conferenceNumber: 2, tournamentId: 'T1' },
    ]
  })

  it('GET shows the tournament rules and structure, editable for the tournament commish', async () => {
    const body = await (await GET(req('GET'), params)).json()
    expect(body.tournament).toMatchObject({
      tournamentId: 'T1',
      canEdit: true,
      value: { advancersPerLeague: 1, wildcardCount: 2, bubbleSize: 8 },
      overview: { totalRounds: 4, thisLeague: { roundLabel: 'Opening Round', conferenceName: 'East' } },
    })
  })

  it('PATCH saves through updateTournamentSettings, which audits', async () => {
    const res = await PATCH(req('PATCH', { tournament: { wildcardCount: 4, conferenceNames: [{ id: 'c2', name: 'Pacific' }] } }), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.tournament.value.wildcardCount).toBe(4)
    expect(body.tournament.conferences.map((c: { name: string }) => c.name)).toEqual(['East', 'Pacific'])
    expect(h.state.audits).toEqual([expect.objectContaining({ action: 'tournament.settings_changed', actorId: 'u-tc' })])
  })

  it('a league co-commish who is not the tournament commish sees it read-only and cannot save', async () => {
    h.state.session = 'u-co'
    const get = await (await GET(req('GET'), params)).json()
    expect(get.tournament.canEdit).toBe(false)
    const res = await PATCH(req('PATCH', { tournament: { wildcardCount: 4 } }), params)
    expect(res.status).toBe(403)
    expect(h.state.shell!.wildcardCount).toBe(2)
    expect(h.state.audits).toEqual([])
  })

  it('a conference from another tournament cannot be renamed', async () => {
    h.state.conferences.push({ id: 'cX', name: 'Elsewhere', isActive: true, conferenceNumber: 1, tournamentId: 'T2' })
    const res = await PATCH(req('PATCH', { tournament: { conferenceNames: [{ id: 'cX', name: 'Mine now' }] } }), params)
    expect(res.status).toBe(404)
    expect(h.state.conferences.find((c) => c.id === 'cX')!.name).toBe('Elsewhere')
  })

  it('PATCH is refused by the specialty gate, and on a league with no editable tournament', async () => {
    h.state.refuse = true
    expect((await PATCH(req('PATCH', { tournament: { bubbleSize: 4 } }), params)).status).toBe(402)
    h.state.refuse = false
    h.state.linked = false
    expect((await PATCH(req('PATCH', { tournament: { bubbleSize: 4 } }), params)).status).toBe(409)
    expect(h.state.shell!.bubbleSize).toBe(8)
  })
})
