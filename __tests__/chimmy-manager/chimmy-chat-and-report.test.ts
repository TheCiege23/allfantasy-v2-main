/**
 * Chimmy speaks for its castaways (a vote line to its tribe, an Exile line to the Exile chat) and
 * sends the commissioner one weekly line per Chimmy team. Both are spoiler-safe: no vote target, and
 * no idol, ever.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const h = vi.hoisted(() => ({
  castaway: null as null | { displayName: string; tribeId: string | null },
  channels: [] as Array<{ id: string; channelType: string; tribeId?: string | null }>,
  posted: [] as Array<Record<string, unknown>>,
  cast: [] as Array<{ userId: string; displayName: string; playerState: string; redraftRosterId: string | null }>,
  settings: {} as Record<string, unknown>,
  councils: [] as Array<{ id: string }>,
  votes: [] as Array<{ councilId: string; voterUserId: string }>,
  entries: [] as Array<{ userId: string; submittedLineup: unknown }>,
  alerts: [] as Array<{ kind: string; input: { dedupeKey: string; title: string; body: string } }>,
  upserts: new Map<string, Record<string, unknown>>(),
  phase: 'pre_merge',
  language: 'en' as string | null,
  revealed: [] as Array<{ id: string; eliminatedUserId: string | null }>,
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    survivorPlayer: {
      findUnique: vi.fn(async () => h.castaway),
      findMany: vi.fn(async () => h.cast),
    },
    survivorChatChannel: {
      findFirst: vi.fn(async (q: { where: { channelType: string | { in: string[] }; tribeId?: string } }) => {
        const types = typeof q.where.channelType === 'string' ? [q.where.channelType] : q.where.channelType.in
        return h.channels.find((c) => types.includes(c.channelType) && (q.where.tribeId === undefined || c.tribeId === q.where.tribeId)) ?? null
      }),
    },
    league: { findUnique: vi.fn(async () => ({ settings: h.settings, language: h.language })) },
    survivorTribalCouncil: { findMany: vi.fn(async (q: { where: { isRevealed?: boolean } }) => (q.where.isRevealed ? h.revealed : h.councils)) },
    survivorGameState: { findUnique: vi.fn(async () => ({ phase: h.phase })) },
    survivorVote: { findMany: vi.fn(async () => h.votes) },
    exileWeeklyEntry: { findMany: vi.fn(async () => h.entries) },
  },
}))
vi.mock('@/lib/survivor/survivorChatBridge', () => ({
  createSurvivorChatMessage: vi.fn(async (_db: unknown, args: { data: Record<string, unknown> }) => { h.posted.push(args.data); return { id: 'm1' } }),
  // Keyed like the real upsert: a second post under the same id changes nothing.
  upsertSurvivorChatMessage: vi.fn(async (_db: unknown, args: { where: { id: string }; create: Record<string, unknown> }) => {
    if (!h.upserts.has(args.where.id)) h.upserts.set(args.where.id, args.create)
    return { id: args.where.id }
  }),
}))
vi.mock('@/lib/survivor/survivorCommissionerAlerts', () => ({
  notifySurvivorCommissionerOnce: vi.fn(async (_l: string, kind: string, input: { dedupeKey: string; title: string; body: string }) => {
    if (h.alerts.some((a) => a.kind === kind && a.input.dedupeKey === input.dedupeKey)) return { sent: false, reason: 'duplicate' }
    h.alerts.push({ kind, input })
    return { sent: true, notificationId: 'n1' }
  }),
}))

import { CHIMMY_MERGED_LINE, chimmyExileLine, chimmySurvivedLine, chimmyVoteLine, postChimmyCastawayLine, postChimmyWeekLines } from '@/lib/survivor/chimmyCastawayChat'
import { chimmyWeeklyReportBody, chimmyWeeklyReportTitle, sendChimmyWeeklyReport } from '@/lib/survivor/chimmyWeeklyReport'

const chimmyEntry = (seat: string) => ({ since: 's', byUserId: 'c', ownerUserId: seat, autopilot: { style: 'win_now', since: 's', byUserId: 'c' } })

beforeEach(() => {
  h.castaway = { displayName: 'Bay Raiders (Chimmy)', tribeId: 't1' }
  h.channels = [{ id: 'tribe-t1', channelType: 'tribe', tribeId: 't1' }, { id: 'exile-ch', channelType: 'exile' }]
  h.posted = []
  h.cast = [
    { userId: 'orphan-r9', displayName: 'Bay Raiders (Chimmy)', playerState: 'active', redraftRosterId: 'r9' },
    { userId: 'orphan-r8', displayName: 'Chimmy 2', playerState: 'exile', redraftRosterId: 'r8' },
  ]
  h.settings = { af_managed_lineups: { r9: chimmyEntry('orphan-r9'), r8: chimmyEntry('orphan-r8') } }
  h.councils = [{ id: 'c1' }]
  h.votes = [{ councilId: 'c1', voterUserId: 'orphan-r9' }]
  h.entries = [{ userId: 'orphan-r8', submittedLineup: { version: 1, anchorId: 'p', team: 'KC', players: [], closedAt: null, lockedAt: null } }]
  h.alerts = []
  h.upserts = new Map()
  h.phase = 'pre_merge'
  h.language = 'en'
  h.revealed = [{ id: 'c1', eliminatedUserId: 'someone' }]
})

describe('Chimmy\'s chat lines', () => {
  it('says its vote is in to its own tribe, as itself, without naming anyone', async () => {
    expect(await postChimmyCastawayLine('L', 'orphan-r9', { kind: 'vote', week: 5 })).toBe(true)
    expect(h.posted).toEqual([expect.objectContaining({
      channelId: 'tribe-t1', channelType: 'tribe', senderName: 'Bay Raiders (Chimmy)', senderIsHost: true, content: chimmyVoteLine(5),
    })])
    // Every vote line is generic: no line can carry a name, because none takes one.
    for (let w = 0; w < 8; w++) expect(chimmyVoteLine(w)).not.toMatch(/idol/i)
    expect(chimmyVoteLine(5)).toBe(chimmyVoteLine(5))
  })

  it('tells the Exile chat which team it took', async () => {
    await postChimmyCastawayLine('L', 'orphan-r9', { kind: 'exile', team: 'KC' })
    expect(h.posted[0]).toMatchObject({ channelId: 'exile-ch', channelType: 'exile', content: chimmyExileLine('KC') })
    expect(chimmyExileLine('KC')).toContain('KC')
  })

  it('posts nothing, and never throws, when there is no channel or castaway', async () => {
    h.channels = []
    expect(await postChimmyCastawayLine('L', 'orphan-r9', { kind: 'vote', week: 1 })).toBe(false)
    h.castaway = { displayName: 'x', tribeId: null }
    h.channels = [{ id: 'exile-ch', channelType: 'exile' }]
    expect(await postChimmyCastawayLine('L', 'orphan-r9', { kind: 'vote', week: 1 })).toBe(false)
    h.castaway = null
    expect(await postChimmyCastawayLine('L', 'orphan-r9', { kind: 'exile', team: 'KC' })).toBe(false)
    expect(h.posted).toEqual([])
  })
})

describe('the commissioner\'s weekly Chimmy report', () => {
  it('lists each Chimmy team: where it stands, whether it voted, its Exile team', () => {
    const body = chimmyWeeklyReportBody(6, [
      { name: 'Bay Raiders (Chimmy)', state: 'active', voted: 1, exileTeam: null },
      { name: 'Chimmy 2', state: 'exile', voted: 0, exileTeam: 'KC' },
    ])
    expect(body).toBe([
      'Here is what Chimmy did for its 2 teams in week 6.',
      'Bay Raiders (Chimmy): still in the game, voted at Tribal Council.',
      'Chimmy 2: on Exile Island, played KC on Exile.',
    ].join('\n'))
  })

  it('sends once a week, to the commissioner, spoiler-safe', async () => {
    expect(await sendChimmyWeeklyReport('L', 6)).toBe(true)
    expect(h.alerts).toHaveLength(1)
    const { kind, input } = h.alerts[0]
    expect(kind).toBe('chimmy_weekly_report')
    expect(input.title).toBe("Chimmy's week 6")
    expect(input.body).toContain('Bay Raiders (Chimmy): still in the game, voted at Tribal Council.')
    expect(input.body).toContain('Chimmy 2: on Exile Island, played KC on Exile.')
    expect(input.body).not.toMatch(/idol|voted for/i)
    // The same week again is a duplicate, not a second notice.
    expect(await sendChimmyWeeklyReport('L', 6)).toBe(false)
    expect(h.alerts).toHaveLength(1)
  })

  it('CONTROL: sends nothing when Chimmy runs no team, or a seat changed hands', async () => {
    h.settings = {}
    expect(await sendChimmyWeeklyReport('L', 6)).toBe(false)
    h.settings = { af_managed_lineups: { r9: chimmyEntry('someone-else') } }
    expect(await sendChimmyWeeklyReport('L', 6)).toBe(false)
    h.cast = []
    expect(await sendChimmyWeeklyReport('L', 6)).toBe(false)
    expect(h.alerts).toEqual([])
  })
})

describe('Chimmy\'s end-of-week lines', () => {
  beforeEach(() => {
    // Only castaways still in the game are asked; the active one voted at c1 and stayed.
    h.cast = [{ userId: 'orphan-r9', displayName: 'Bay Raiders (Chimmy)', playerState: 'active', redraftRosterId: 'r9' }]
  })

  it('says it survived each council it voted at, once, however often the week closes', async () => {
    expect(await postChimmyWeekLines('L', 6)).toBe(1)
    await postChimmyWeekLines('L', 6)
    expect([...h.upserts.keys()]).toEqual(['chimmy-survived-c1-orphan-r9'])
    expect(h.upserts.get('chimmy-survived-c1-orphan-r9')).toMatchObject({ channelId: 'tribe-t1', content: chimmySurvivedLine(6), senderName: 'Bay Raiders (Chimmy)' })
    expect(chimmySurvivedLine(6)).not.toMatch(/idol/i)
  })

  it('says nothing for the council that sent it home, or for a council not yet read', async () => {
    h.revealed = [{ id: 'c1', eliminatedUserId: 'orphan-r9' }]
    expect(await postChimmyWeekLines('L', 6)).toBe(0)
    h.revealed = []
    expect(await postChimmyWeekLines('L', 6)).toBe(0)
    expect(h.upserts.size).toBe(0)
  })

  it('marks the merge once, and never before it', async () => {
    h.revealed = []
    await postChimmyWeekLines('L', 6)
    expect(h.upserts.size).toBe(0)
    h.phase = 'merge'
    await postChimmyWeekLines('L', 7)
    h.phase = 'jury'
    await postChimmyWeekLines('L', 8)
    expect([...h.upserts.entries()].map(([id, row]) => [id, row.content])).toEqual([['chimmy-merged-L-orphan-r9', CHIMMY_MERGED_LINE]])
  })

  it('CONTROL: a seat Chimmy does not run says nothing', async () => {
    h.settings = {}
    h.phase = 'merge'
    expect(await postChimmyWeekLines('L', 7)).toBe(0)
    expect(h.upserts.size).toBe(0)
  })
})

describe('Chimmy speaks the league\'s language', () => {
  it('posts Spanish lines in a Spanish league, English otherwise', async () => {
    h.language = 'es'
    await postChimmyCastawayLine('L', 'orphan-r9', { kind: 'vote', week: 5 })
    await postChimmyCastawayLine('L', 'orphan-r9', { kind: 'exile', team: 'KC' })
    expect(h.posted.map((p) => p.content)).toEqual([chimmyVoteLine(5, 'es'), chimmyExileLine('KC', 'es')])
    expect(chimmyVoteLine(5, 'es')).not.toBe(chimmyVoteLine(5, 'en'))
    expect(chimmyExileLine('KC', 'es')).toContain('KC')
    h.language = null
    await postChimmyCastawayLine('L', 'orphan-r9', { kind: 'vote', week: 5 })
    expect(h.posted[2].content).toBe(chimmyVoteLine(5))
  })

  it('every Spanish line exists and stays spoiler-safe', () => {
    for (let w = 0; w < 6; w++) {
      for (const line of [chimmyVoteLine(w, 'es'), chimmySurvivedLine(w, 'es')]) {
        expect(line.length).toBeGreaterThan(10)
        expect(line).not.toMatch(/ídolo|idol/i)
      }
    }
  })

  it('sends the commissioner a Spanish report in a Spanish league', async () => {
    h.language = 'es'
    expect(await sendChimmyWeeklyReport('L', 6)).toBe(true)
    const { input } = h.alerts[0]
    expect(input.title).toBe(chimmyWeeklyReportTitle(6, 'es'))
    expect(input.body).toBe([
      'Esto es lo que hizo Chimmy por sus 2 equipos en la semana 6.',
      'Bay Raiders (Chimmy): sigue en el juego, votó en el Consejo Tribal.',
      'Chimmy 2: en la Isla del Exilio, jugó con KC en el Exilio.',
    ].join('\n'))
    expect(chimmyWeeklyReportBody(6, [{ name: 'X', state: 'jury', voted: 2, exileTeam: null }], 'es')).toContain('votó en 2 Consejos Tribales')
  })
})
