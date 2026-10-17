import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The player card's injury slot, read through the canonical injury port.
 *
 * 🛑 THIS SLOT USED TO RUN ITS OWN QUERY, AND IT SHOWED CLEARED PLAYERS AS HURT (2026-10-11). It read
 * 14 days of rows with no `expiresAt`, newest report first, and took the first row that was not
 * "Active" — so ESPN's "Active" for a cleared player was skipped and an older "Questionable" or "Out"
 * beneath it was shown, and a player who dropped off the reports kept his last "Out" for two weeks.
 * These tests pin the port's rules on this surface: live rows only, the newest claim wins (Active
 * included), and a namesake on another club is never this player.
 */

const findMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsInjury: { findMany: (...a: unknown[]) => findMany(...a) },
  },
}))

const HOUR = 3_600_000

function row(over: Record<string, unknown>) {
  const now = Date.now()
  return {
    playerName: 'Jahmyr Gibbs',
    status: 'Questionable',
    type: null,
    description: null,
    date: new Date(now - HOUR),
    week: null,
    source: 'espn',
    fetchedAt: new Date(now - HOUR / 2),
    team: 'DET',
    position: 'RB',
    ...over,
  }
}

async function subject() {
  const mod = await import('@/lib/core-app/playerCard')
  return mod.loadInjury
}

beforeEach(() => {
  findMany.mockReset()
  findMany.mockResolvedValue([])
})
afterEach(() => vi.restoreAllMocks())

describe('loadInjury — the current designation', () => {
  it('asks only for rows a feed still carries', async () => {
    const loadInjury = await subject()
    await loadInjury('Jahmyr Gibbs', 'NFL', 'DET', 'RB')
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(findMany.mock.calls[0][0].where)).toContain('expiresAt')
  })

  it("🛑 a newer Active from ESPN clears an older Questionable from another feed", async () => {
    const now = Date.now()
    findMany.mockResolvedValue([
      // Rolling Insights re-pulled Friday's report a minute ago...
      row({ status: 'Questionable', source: 'rolling_insights', date: new Date(now - 48 * HOUR), fetchedAt: new Date(now - 60_000) }),
      // ...ESPN cleared him this morning.
      row({ status: 'Active', source: 'espn', date: new Date(now - 3 * HOUR), fetchedAt: new Date(now - 20 * 60_000) }),
    ])
    const loadInjury = await subject()
    const res = await loadInjury('Jahmyr Gibbs', 'NFL', 'DET', 'RB')
    expect(res.available).toBe(false)
  })

  it('upper-cases the status and keeps the report date as the fact it is', async () => {
    const when = new Date(Date.now() - 3 * HOUR)
    findMany.mockResolvedValue([row({ status: 'out', type: 'Knee', date: when, source: 'rolling_insights' })])
    const loadInjury = await subject()
    const res = await loadInjury('Jahmyr Gibbs', 'NFL', 'DET', 'RB')
    expect(res.available).toBe(true)
    if (res.available) {
      expect(res.data.status).toBe('OUT')
      expect(res.data.bodyPart).toBe('Knee')
      expect(res.data.reportedAt).toBe(when.toISOString())
      expect(res.data.source).toBe('rolling_insights')
    }
  })

  it('is unavailable — with a reason — when no feed carries a designation', async () => {
    const loadInjury = await subject()
    const res = await loadInjury('Jahmyr Gibbs', 'NFL', 'DET', 'RB')
    expect(res.available).toBe(false)
    if (!res.available) expect(res.reason).toBe('No current injury designation on any injury report.')
  })

  /*
   * ⚠ FOUND AGAINST PRODUCTION, NOT AGAINST A FIXTURE. ESPN's `description` is usually a sentence but
   * is sometimes just the word "questionable", which rendered as "QUESTIONABLE questionable".
   */
  it('drops a note that only repeats the status', async () => {
    findMany.mockResolvedValue([row({ status: 'Questionable', description: 'questionable' })])
    const loadInjury = await subject()
    const res = await loadInjury('Jahmyr Gibbs', 'NFL', 'DET', 'RB')
    expect(res.available).toBe(true)
    if (res.available) {
      expect(res.data.status).toBe('QUESTIONABLE')
      expect(res.data.note).toBeNull()
    }
  })

  it('keeps a note that says something the status does not', async () => {
    findMany.mockResolvedValue([
      row({ playerName: 'Zach Charbonnet', team: 'SEA', status: 'Out', type: 'Knee', description: 'Charbonnet (knee) looks unlikely to play Sunday.' }),
    ])
    const loadInjury = await subject()
    const res = await loadInjury('Zach Charbonnet', 'NFL', 'SEA', 'RB')
    expect(res.available).toBe(true)
    if (res.available) expect(res.data.note).toContain('unlikely to play')
  })

  /* A query that throws must not take the card down with it. */
  it('degrades to unavailable when the query fails', async () => {
    findMany.mockRejectedValue(new Error('db down'))
    const loadInjury = await subject()
    const res = await loadInjury('Jahmyr Gibbs', 'NFL', 'DET', 'RB')
    expect(res.available).toBe(false)
  })

  it("🛑 never shows a namesake's designation — LB Justin Jefferson's row is not the WR's", async () => {
    findMany.mockResolvedValue([
      row({ playerName: 'Justin Jefferson', team: 'Cleveland Browns', position: 'LB', status: 'Out' }),
    ])
    const loadInjury = await subject()
    const res = await loadInjury('Justin Jefferson', 'NFL', 'MIN', 'WR')
    expect(res.available).toBe(false)
  })

  it('matches a suffixed feed name and takes his own club', async () => {
    findMany.mockResolvedValue([
      row({ playerName: 'Omar Cooper Jr.', team: 'New England Patriots', position: null, status: 'Out' }),
      row({ playerName: 'Omar Cooper Jr.', team: 'New York Jets', position: null, status: 'IR' }),
    ])
    const loadInjury = await subject()
    const res = await loadInjury('Omar Cooper', 'NFL', 'NYJ', 'WR')
    expect(res.available).toBe(true)
    if (res.available) expect(res.data.status).toBe('IR')
  })
})
