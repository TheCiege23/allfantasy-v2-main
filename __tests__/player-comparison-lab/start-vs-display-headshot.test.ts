/**
 * Start A vs B headshots. Measured 2026-10-11: the engine says team "BUF", the catalog says
 * "Buffalo Bills", so a literal team match never fired and the newest "Josh Allen" row — retired
 * G Josh Allen, Sleeper 2212 — supplied QB Josh Allen's photo.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ sportsPlayer: { findMany: vi.fn(), findFirst: vi.fn() } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { resolveStartVsDisplayMedia } from '@/lib/player-comparison-lab/resolve-start-vs-display'

const at = (iso: string) => new Date(iso)
const THUMB = 'https://sleepercdn.com/content/nfl/players/thumb'

/** The production rows answering to "Josh Allen", newest first. */
const JOSH_ALLENS = [
  { sleeperId: '2212', source: 'sleeper', name: 'Josh Allen', position: 'G', team: null, imageUrl: `${THUMB}/2212.jpg`, fetchedAt: at('2026-10-11T12:07:28Z') },
  { sleeperId: '4984', source: 'thesportsdb', name: 'Josh Allen', position: 'QB', team: 'Buffalo Bills', imageUrl: 'https://r2.thesportsdb.com/images/media/player/cutout/agso4z', fetchedAt: at('2026-10-11T08:42:36Z') },
  { sleeperId: null, source: 'rolling_insights', name: 'Josh Allen', position: 'QB', team: 'Buffalo Bills', imageUrl: null, fetchedAt: at('2026-10-10T09:15:02Z') },
  { sleeperId: '4984', source: 'sleeper', name: 'Josh Allen', position: 'QB', team: 'Buffalo Bills', imageUrl: `${THUMB}/4984.jpg`, fetchedAt: at('2026-10-10T06:05:37Z') },
  { sleeperId: null, source: 'backfill', name: 'Josh Allen', position: 'QB', team: 'Buffalo Bills', imageUrl: 'https://r2.thesportsdb.com/images/media/player/cutout/2036qe', fetchedAt: at('2026-04-25T23:49:36Z') },
]

function serve(rows: typeof JOSH_ALLENS) {
  db.sportsPlayer.findMany.mockImplementation(async (args: any) => {
    const sid = args.where?.sleeperId?.equals
    if (sid) return rows.filter((r) => r.sleeperId?.toLowerCase() === String(sid).toLowerCase())
    const name = String(args.where?.name?.equals ?? '').toLowerCase()
    return rows.filter((r) => r.name.toLowerCase() === name)
  })
  // What Postgres answers a name(+team) findFirst ordered by fetchedAt desc — the read the
  // pre-fix resolver made, kept so these tests also fail against it.
  db.sportsPlayer.findFirst.mockImplementation(async (args: any) => {
    const name = String(args.where?.name?.equals ?? '').toLowerCase()
    const team = args.where?.team?.equals
    return rows.find((r) => r.name.toLowerCase() === name && (team == null || (r.team ?? '').toLowerCase() === String(team).toLowerCase())) ?? null
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  serve(JOSH_ALLENS)
})

describe('resolveStartVsDisplayMedia', () => {
  it("shows QB Josh Allen's photo, not retired G Josh Allen's, when the engine team is the code BUF", async () => {
    const out = await resolveStartVsDisplayMedia({
      sport: 'NFL',
      playerA: { name: 'Josh Allen', team: 'BUF', position: 'QB' },
      playerB: { name: 'Josh Allen', team: 'BUF', position: null },
    })
    expect(out.playerA.headshotUrl).toBe(`${THUMB}/4984.jpg`)
    // Team alone, folded through normalizeTeamAbbrev, also tells them apart.
    expect(out.playerB.headshotUrl).toBe(`${THUMB}/4984.jpg`)
  })

  it('refuses rather than guesses when nothing tells the namesakes apart', async () => {
    const out = await resolveStartVsDisplayMedia({
      sport: 'NFL',
      playerA: { name: 'Josh Allen', team: null, position: null },
      playerB: { name: 'Josh Allen', team: null },
    })
    expect(out.playerA.headshotUrl).toBeNull()
    expect(out.playerB.headshotUrl).toBeNull()
  })

  it('refuses a lone namesake from another position group', async () => {
    serve(JOSH_ALLENS.filter((r) => r.sleeperId === '2212'))
    const out = await resolveStartVsDisplayMedia({
      sport: 'NFL',
      playerA: { name: 'Josh Allen', team: 'BUF', position: 'QB' },
      playerB: { name: 'Josh Allen', team: 'BUF', position: 'QB' },
    })
    expect(out.playerA.headshotUrl).toBeNull()
  })

  it('resolves by Sleeper id through the authoritative Sleeper row when one is given', async () => {
    const out = await resolveStartVsDisplayMedia({
      sport: 'NFL',
      playerA: { name: 'Josh Allen', team: null, sleeperId: '4984' },
      playerB: { name: 'Josh Allen', team: null, sleeperId: '2212' },
    })
    expect(out.playerA.headshotUrl).toBe(`${THUMB}/4984.jpg`)
    expect(out.playerB.headshotUrl).toBe(`${THUMB}/2212.jpg`)
  })
})
