import { beforeEach, describe, expect, it, vi } from 'vitest'

type TL = { id: string; tournamentId: string; name: string; leagueId: string | null; status: string; teamSlots: number; leagueNumber: number; updatedAt: Date; participants: Array<{ userId: string; draftSlot: number | null }> }
type Seat = { leagueId: string; slotNumber: number; rosterId: string }

const { db, prismaMock, create, assign, release, saveScoring } = vi.hoisted(() => {
  const db = {
    shell: null as Record<string, unknown> | null,
    leagues: [] as TL[],
    seats: [] as Seat[],
    holders: new Map<string, string>(),
    sessions: [] as Array<{ id: string; leagueId: string; status: string; teamCount: number }>,
    audits: [] as Array<{ action: string; data: Record<string, unknown> }>,
    bodies: [] as Array<Record<string, unknown>>,
    failNames: new Set<string>(),
    n: 0,
  }
  const matches = (row: TL, where: Record<string, unknown>): boolean => Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Array<Record<string, unknown>>).some(w => matches(row, w))
    if (k === 'status' && v && typeof v === 'object') return row.status !== (v as { not: string }).not
    if (k === 'updatedAt') return row.updatedAt < (v as { lt: Date }).lt
    if (k === 'divisionId' || k === 'conferenceId') return true
    return (row as Record<string, unknown>)[k] === v
  })
  const tl = {
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => db.leagues.filter(l => l.tournamentId === where.tournamentId).sort((a, b) => a.leagueNumber - b.leagueNumber).map(l => ({ ...l }))),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<TL> }) => {
      const rows = db.leagues.filter(l => matches(l, where)); rows.forEach(r => Object.assign(r, data, { updatedAt: new Date() })); return { count: rows.length }
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<TL> }) => Object.assign(db.leagues.find(l => l.id === where.id)!, data)),
  }
  const prismaMock = {
    tournamentShell: { findUnique: vi.fn(async () => (db.shell ? { ...db.shell } : null)) },
    tournamentLeague: tl,
    leagueEntrySlot: { findMany: vi.fn(async ({ where }: { where: { leagueId: string } }) => db.seats.filter(s => s.leagueId === where.leagueId).sort((a, b) => a.slotNumber - b.slotNumber)) },
    roster: { findMany: vi.fn(async ({ where }: { where: { leagueId: string } }) => db.seats.filter(s => s.leagueId === where.leagueId).map(s => ({ id: s.rosterId, platformUserId: db.holders.get(s.rosterId)! }))) },
    draftSession: {
      findFirst: vi.fn(async ({ where }: { where: { leagueId: string; status: string } }) => db.sessions.find(s => s.leagueId === where.leagueId && s.status === where.status) ?? null),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    tournamentAuditLog: { create: vi.fn(async ({ data }: { data: { action: string; data: Record<string, unknown> } }) => { db.audits.push(data); return data }) },
    $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(prismaMock)),
  }
  /** Stand-in for the canonical create: commissioner in seat 1, open seats after, one pre-draft session. */
  const create = vi.fn(async ({ appUserId, body }: { appUserId: string; body: Record<string, unknown> }) => {
    db.bodies.push(body)
    if (db.failNames.has(String(body.leagueName))) return { ok: false, status: 500, response: { success: false, error: 'Failed to create league', errors: [] } }
    const leagueId = 'L' + ++db.n
    for (let slot = 1; slot <= Number(body.teamCount); slot++) {
      const rosterId = `${leagueId}-r${slot}`
      db.seats.push({ leagueId, slotNumber: slot, rosterId })
      db.holders.set(rosterId, slot === 1 ? appUserId : `open-slot-${leagueId}-${slot}`)
    }
    db.sessions.push({ id: 'S' + leagueId, leagueId, status: 'pre_draft', teamCount: Number(body.teamCount) })
    return { ok: true, response: { success: true, league: { id: leagueId } } }
  })
  const assign = vi.fn(async (_tx: unknown, a: { rosterId: string; userId: string; leagueId: string }) => {
    const held = db.holders.get(a.rosterId)
    if (held === a.userId) return { ok: true, rosterId: a.rosterId, teamNumber: null, alreadyHeld: true }
    if (held && !held.startsWith('open-slot-') && !held.startsWith('orphan-')) return { ok: false, code: 'ROSTER_TAKEN', message: 'taken' }
    const other = db.seats.find(s => s.leagueId === a.leagueId && db.holders.get(s.rosterId) === a.userId)
    if (other) return { ok: false, code: 'ALREADY_HOLDS_ROSTER', message: 'holds' }
    db.holders.set(a.rosterId, a.userId)
    return { ok: true, rosterId: a.rosterId, teamNumber: null, alreadyHeld: false }
  })
  const release = vi.fn(async (_tx: unknown, a: { rosterId: string }) => { const prev = db.holders.get(a.rosterId) ?? null; db.holders.set(a.rosterId, `orphan-${a.rosterId}`); return { ok: true, previousOwner: prev } })
  const saveScoring = vi.fn(async (..._a: unknown[]) => undefined)
  return { db, prismaMock, create, assign, release, saveScoring }
})

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/league-creation/canonical/executeCanonicalLeagueCreation', () => ({ executeCanonicalLeagueCreation: (a: never) => create(a) }))
vi.mock('@/lib/league/leagueSeats', () => ({ assignLeagueSeat: (t: unknown, a: never) => assign(t, a), releaseLeagueSeat: (t: unknown, a: never) => release(t, a) }))
vi.mock('@/lib/live-draft-engine/DraftSessionService', () => ({ buildSlotOrderForLeague: vi.fn(async () => []) }))
vi.mock('@/lib/nfl-scoring/NflScoringConfigService', () => ({ saveLeagueNflScoringConfig: (...a: unknown[]) => saveScoring(...a) }))

import { validateCreatePayload } from '@/lib/league-creation/canonical/validateCreateLeague'
import { nflScoringSeedForCreate } from '@/lib/nfl-scoring/nflScoringSeedForCreate'
import { conferenceLeagueCreateBody, conferenceLeaguePlan } from '@/lib/tournament/divisions/conferenceLeagueSettings'
import { provisionConferenceLeagues, seatPlan } from '@/lib/tournament/divisions/conferenceLeagues'
import { rosterChoices, scoringChoices } from '@/lib/tournament/divisions/rules'

const shell = (formatSettings: Record<string, unknown>, sport = 'NFL') => ({ id: 't1', format: 'divisions', status: 'placed', sport, commissionerId: 'owner', formatSettings })
const placed = (count: number, teamSlots: number, membersPer: number) => {
  db.leagues = Array.from({ length: count }, (_, i) => ({
    id: `tl${i + 1}`, tournamentId: 't1', name: `Conference ${i + 1}`, leagueId: null, status: 'forming', teamSlots, leagueNumber: i + 1, updatedAt: new Date(0),
    participants: Array.from({ length: membersPer }, (_, m) => ({ userId: `u${i + 1}-${m + 1}`, draftSlot: m + 1 })),
  }))
}
const heldBy = (leagueId: string) => db.seats.filter(s => s.leagueId === leagueId).sort((a, b) => a.slotNumber - b.slotNumber).map(s => db.holders.get(s.rosterId))

beforeEach(() => {
  db.shell = null; db.leagues = []; db.seats = []; db.holders = new Map(); db.sessions = []; db.audits = []; db.bodies = []; db.failNames = new Set(); db.n = 0
  create.mockClear(); assign.mockClear(); release.mockClear(); saveScoring.mockClear()
})

describe('conference league settings come from the tournament rules', () => {
  it('every choosable scoring × roster pair maps to a body the real create validator accepts', () => {
    for (const sport of ['NFL', 'NBA'] as const) {
      for (const s of scoringChoices(sport).filter(c => !c.disabled)) for (const r of rosterChoices(sport).filter(c => !c.disabled)) {
        for (const teamCount of [8, 10, 12, 14]) {
          const { body } = conferenceLeagueCreateBody(sport, { scoringId: s.id, rosterId: r.id }, { name: 'North Gold', teamCount })
          const v = validateCreatePayload(body)
          expect(v.ok, `${sport} ${s.id} ${r.id} ${teamCount}: ${v.ok ? '' : v.error}`).toBe(true)
        }
      }
    }
  })

  it('a standard NFL roster seeds exactly the scoring label’s preset through the create flow', () => {
    for (const [scoringId, presetKey] of [['std', 'af_standard'], ['half', 'af_default'], ['ppr', 'af_ppr'], ['te', 'af_ppr']] as const) {
      const plan = conferenceLeaguePlan('NFL', { scoringId, rosterId: 'nfl-std' })
      const seed = nflScoringSeedForCreate({ scoringPresetId: plan.scoringPreset, tePremiumPoints: plan.tePremiumPoints })
      expect(seed.presetKey).toBe(presetKey)
      expect(plan.scoringOverride).toBeNull()
      expect(seed.rules.te_premium ?? 0).toBe(scoringId === 'te' ? 0.5 : 0)
    }
  })

  it('Superflex and IDP rosters keep their roster preset and name the scoring to write over Half PPR', () => {
    expect(conferenceLeaguePlan('NFL', { scoringId: 'half', rosterId: 'nfl-sf' })).toMatchObject({ concept: 'redraft', scoringPreset: 'fb_superflex', scoringOverride: null })
    expect(conferenceLeaguePlan('NFL', { scoringId: 'ppr', rosterId: 'nfl-sf' })).toMatchObject({ scoringPreset: 'fb_superflex', scoringOverride: { presetKey: 'af_ppr', tePremiumPoints: null } })
    expect(conferenceLeaguePlan('NFL', { scoringId: 'std', rosterId: 'nfl-idp' })).toMatchObject({ concept: 'idp', scoringPreset: 'fb_idp', scoringOverride: { presetKey: 'af_standard' } })
    expect(conferenceLeaguePlan('NBA', { scoringId: 'cat8', rosterId: 'nba-std' })).toMatchObject({ scoringPreset: 'nba_8cat', scoringOverride: null })
  })

  it('seats members by draft slot and gives a clash the next free seat', () => {
    expect([...seatPlan([{ userId: 'b', draftSlot: 2 }, { userId: 'a', draftSlot: 2 }, { userId: 'c', draftSlot: null }], 4).entries()].sort()).toEqual([[1, 'b'], [2, 'a'], [3, 'c']])
  })
})

describe('placement creates real leagues', () => {
  it('creates one league per conference with the scoring, roster, size and members, links it and leaves a pre-draft draft', async () => {
    db.shell = shell({ sport: 'NFL', rules: { scoringId: 'ppr', rosterId: 'nfl-std' } })
    placed(3, 12, 10)
    const r = await provisionConferenceLeagues('t1', 'owner')
    expect(r.complete).toBe(true)
    expect(create).toHaveBeenCalledTimes(3)
    expect(db.bodies.map(b => [b.concept, b.sport, b.scoringPreset, b.teamCount, b.leagueName])).toEqual([1, 2, 3].map(i => ['redraft', 'NFL', 'fb_ppr', 12, `Conference ${i}`]))
    expect(create.mock.calls.every(c => c[0].appUserId === 'owner')).toBe(true)
    for (const [i, l] of db.leagues.entries()) {
      expect(l.leagueId).toBe(`L${i + 1}`)
      expect(l.status).toBe('ready')
      // Members hold seats 1..10 in draft-slot order; the commissioner (not an entrant) gave seat 1 back.
      expect(heldBy(l.leagueId!).slice(0, 10)).toEqual(l.participants.map(p => p.userId))
      expect(heldBy(l.leagueId!)).not.toContain('owner')
    }
    expect(db.sessions.every(s => s.status === 'pre_draft')).toBe(true)
    expect(saveScoring).not.toHaveBeenCalled()
    expect(db.audits.at(-1)).toMatchObject({ action: 'divisions_conference_leagues_provisioned', data: { complete: true, counts: { created: 3 } } })
  })

  it('a commissioner who is also an entrant keeps a seat — their own draft slot', async () => {
    db.shell = shell({ sport: 'NFL' })
    placed(1, 8, 4)
    db.leagues[0]!.participants[2]!.userId = 'owner'
    await provisionConferenceLeagues('t1', 'owner')
    expect(heldBy('L1').slice(0, 4)).toEqual(['u1-1', 'u1-2', 'owner', 'u1-4'])
  })

  it('re-running placement setup is a no-op once every league is ready', async () => {
    db.shell = shell({ sport: 'NFL' })
    placed(2, 10, 10)
    await provisionConferenceLeagues('t1', 'owner')
    assign.mockClear()
    const again = await provisionConferenceLeagues('t1', 'owner')
    expect(create).toHaveBeenCalledTimes(2)
    expect(assign).not.toHaveBeenCalled()
    expect(again.outcomes.map(o => o.outcome)).toEqual(['ready', 'ready'])
  })

  it('a failure in one conference does not stop or duplicate the others, and the retry creates only the missing one', async () => {
    db.shell = shell({ sport: 'NFL' })
    placed(3, 10, 8)
    db.failNames.add('Conference 2')
    const first = await provisionConferenceLeagues('t1', 'owner')
    expect(first.complete).toBe(false)
    expect(first.outcomes.map(o => o.outcome)).toEqual(['created', 'failed', 'created'])
    expect(first.outcomes[1]!.error).toMatch(/could not be created/)
    expect(db.leagues[1]).toMatchObject({ leagueId: null, status: 'forming' })
    expect(db.audits.at(-1)!.data).toMatchObject({ complete: false, problems: [{ league: 'Conference 2', outcome: 'failed' }] })

    db.failNames.clear()
    const retry = await provisionConferenceLeagues('t1', 'owner')
    expect(retry.complete).toBe(true)
    expect(create).toHaveBeenCalledTimes(4)
    expect(db.bodies.slice(3).map(b => b.leagueName)).toEqual(['Conference 2'])
    expect(new Set(db.leagues.map(l => l.leagueId)).size).toBe(3)
  })

  it('a linked league whose seating failed is finished on the retry, never re-created', async () => {
    db.shell = shell({ sport: 'NFL' })
    placed(1, 10, 6)
    assign.mockImplementationOnce(async () => ({ ok: false, code: 'USER_NOT_FOUND', message: 'x' }))
    const first = await provisionConferenceLeagues('t1', 'owner')
    expect(first.outcomes[0]).toMatchObject({ outcome: 'failed', leagueId: 'L1' })
    expect(db.leagues[0]).toMatchObject({ leagueId: 'L1', status: 'provisioning' })
    const retry = await provisionConferenceLeagues('t1', 'owner')
    expect(retry.outcomes[0]).toMatchObject({ outcome: 'created', leagueId: 'L1' })
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('a conference another run is creating right now is left alone', async () => {
    db.shell = shell({ sport: 'NFL' })
    placed(1, 10, 6)
    Object.assign(db.leagues[0]!, { status: 'provisioning', updatedAt: new Date() })
    const r = await provisionConferenceLeagues('t1', 'owner')
    expect(r.outcomes[0]!.outcome).toBe('busy')
    expect(create).not.toHaveBeenCalled()
  })

  it('tournaments saved before rules existed use the sport defaults', async () => {
    db.shell = shell({ sport: 'NFL' })
    placed(1, 12, 4)
    await provisionConferenceLeagues('t1', 'owner')
    db.shell = shell({ sport: 'NBA' }, 'NBA')
    placed(1, 10, 4)
    await provisionConferenceLeagues('t1', 'owner')
    expect(db.bodies.map(b => [b.sport, b.concept, b.scoringPreset])).toEqual([['NFL', 'redraft', 'fb_half_ppr'], ['NBA', 'redraft', 'nba_points']])
  })

  it('writes the chosen scoring over a Superflex league’s Half PPR seed', async () => {
    db.shell = shell({ sport: 'NFL', rules: { scoringId: 'te', rosterId: 'nfl-sf' } })
    placed(1, 12, 4)
    await provisionConferenceLeagues('t1', 'owner')
    expect(db.bodies[0]).toMatchObject({ scoringPreset: 'fb_superflex', conceptSetup: { tePremiumPoints: 0.5 } })
    expect(saveScoring).toHaveBeenCalledTimes(1)
    const [leagueId, cfg] = saveScoring.mock.calls[0] as [string, { presetKey: string; rules: Record<string, number> }]
    expect(leagueId).toBe('L1')
    expect(cfg.presetKey).toBe('af_ppr')
    expect(cfg.rules.te_premium).toBe(0.5)
    expect(cfg.rules.reception).toBe(1)
  })

  it('does nothing before placement', async () => {
    db.shell = { ...shell({ sport: 'NFL' }), status: 'registering' }
    placed(1, 12, 4)
    expect(await provisionConferenceLeagues('t1', 'owner')).toEqual({ outcomes: [], complete: false })
    expect(create).not.toHaveBeenCalled()
  })
})
