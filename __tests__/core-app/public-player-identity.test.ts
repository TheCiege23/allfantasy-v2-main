/**
 * `/players/{slug}` resolves a Sleeper id to the row the page renders. Measured 2026-10-11: the
 * newest row won, and TheSportsDB's rows carry Sleeper ids matched by NAME, so the Vikings CB
 * Byron Murphy (5864) rendered as "Byron Murphy (DT · Seattle Seahawks)".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ sportsPlayer: { findMany: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { getRelatedPlayers, resolvePublicPlayer } from '@/lib/core-app/playerFinder'

const at = (iso: string) => new Date(iso)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('resolvePublicPlayer', () => {
  it('renders CB Byron Murphy (MIN), not the newer Seahawks DT row that carries his Sleeper id', async () => {
    db.sportsPlayer.findMany.mockResolvedValue([
      { externalId: 'tsdb_34249738', source: 'thesportsdb', sleeperId: '5864', sport: 'NFL', name: 'Byron Murphy', position: 'DT', team: 'Seattle Seahawks', fetchedAt: at('2026-10-11T08:42:36Z') },
      { externalId: 'sleeper:5864', source: 'sleeper', sleeperId: '5864', sport: 'NFL', name: 'Byron Murphy', position: 'CB', team: 'Minnesota Vikings', fetchedAt: at('2026-10-10T12:06:58Z') },
    ])
    const resolved = await resolvePublicPlayer('NFL', '5864')
    expect(resolved).toEqual({ playerReference: 'NFL:sleeper:5864', name: 'Byron Murphy', sport: 'NFL', sleeperId: '5864' })
    expect(db.sportsPlayer.findMany.mock.calls[0][0].select).toMatchObject({ source: true })
  })

  it('names TE E.J. Jenkins, never the Elgton Jenkins row stamped with 11304', async () => {
    db.sportsPlayer.findMany.mockResolvedValue([
      { externalId: 'tsdb_34201216', source: 'thesportsdb', sleeperId: '11304', sport: 'NFL', name: 'Elgton Jenkins', position: 'G', team: 'Cleveland Browns', fetchedAt: at('2026-10-11T08:42:36Z') },
      { externalId: 'sleeper:11304', source: 'sleeper', sleeperId: '11304', sport: 'NFL', name: 'E.J. Jenkins', position: 'TE', team: 'Philadelphia Eagles', fetchedAt: at('2026-10-10T18:07:45Z') },
    ])
    const resolved = await resolvePublicPlayer('NFL', '11304')
    expect(resolved?.name).toBe('E.J. Jenkins')
    expect(resolved?.playerReference).toBe('NFL:sleeper:11304')
  })

  it('returns null when no row carries the id', async () => {
    db.sportsPlayer.findMany.mockResolvedValue([])
    expect(await resolvePublicPlayer('NFL', '0')).toBeNull()
  })
})

describe('getRelatedPlayers', () => {
  it('lists teammates from Sleeper rows only, so a namesake row cannot link under another club', async () => {
    db.sportsPlayer.findMany.mockResolvedValue([])
    await getRelatedPlayers('NFL', 'Cleveland Browns', 'G', '999')
    expect(db.sportsPlayer.findMany.mock.calls[0][0].where).toMatchObject({ source: 'sleeper', team: 'Cleveland Browns', position: 'G' })
  })
})
