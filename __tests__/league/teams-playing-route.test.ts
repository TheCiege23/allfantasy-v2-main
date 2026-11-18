import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/telemetry/usage', () => ({ withApiUsage: () => (fn: unknown) => fn }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const kickoffs = vi.fn()
vi.mock('@/lib/redraft/lineupLock', () => ({
  buildWeekKickoffMap: (...args: unknown[]) => kickoffs(...args),
  easternDayKey: () => '2026-11-17',
}))
vi.mock('@/lib/season-week/dailySportSeasonStarts', () => ({ dailySportWeekForInstant: () => 5 }))

import { GET } from '@/app/api/sports/teams-playing/route'

const day = (keys: string[]) => new Map(keys.map((k) => [k, new Date('2026-11-18T00:30:00Z')]))
const call = async (qs: string) => {
  const res = await (GET as unknown as (r: NextRequest) => Promise<Response>)(new NextRequest(`http://x/api/sports/teams-playing?${qs}`))
  return res.json() as Promise<{ judged: boolean; playing: string[]; notPlaying: string[] }>
}

describe('/api/sports/teams-playing (NG on roster rows)', () => {
  beforeEach(() => kickoffs.mockReset())

  it('matches the schedule’s full names to the roster’s abbreviations', async () => {
    // The schedule plays the Knicks and the Celtics today; the Timberwolves played yesterday.
    kickoffs.mockResolvedValue({
      byTeamDay: new Map([
        ['NEW YORK KNICKS', day(['2026-11-17'])],
        ['BOSTON CELTICS', day(['2026-11-17'])],
        ['MINNESOTA TIMBERWOLVES', day(['2026-11-16'])],
      ]),
    })
    const body = await call('sport=NBA&season=2026&teams=NYK,MIN,BOS')
    expect(body.judged).toBe(true)
    expect(body.playing.sort()).toEqual(['BOS', 'NYK'])
    expect(body.notPlaying).toEqual(['MIN'])
  })

  it('says nothing when the day has no games on record, rather than marking everyone NG', async () => {
    kickoffs.mockResolvedValue({ byTeamDay: new Map([['NEW YORK KNICKS', day(['2026-11-16'])]]) })
    const body = await call('sport=NBA&season=2026&teams=NYK,MIN')
    expect(body).toMatchObject({ judged: false, notPlaying: [] })
  })

  it('does not judge sports whose names it cannot reconcile, or NFL', async () => {
    expect((await call('sport=NCAAB&season=2026&teams=DUKE')).judged).toBe(false)
    expect((await call('sport=NFL&season=2026&teams=KC')).judged).toBe(false)
    expect(kickoffs).not.toHaveBeenCalled()
  })

  it('leaves out a club it cannot name, instead of calling it off', async () => {
    kickoffs.mockResolvedValue({ byTeamDay: new Map([['NEW YORK KNICKS', day(['2026-11-17'])]]) })
    const body = await call('sport=NBA&season=2026&teams=NYK,ZZZ')
    expect(body.notPlaying).toEqual([])
    expect(body.playing).toEqual(['NYK'])
  })
})
