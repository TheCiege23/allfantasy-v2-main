/**
 * @vitest-environment node
 *
 * The injury fan-out: one message per injured player covering every league he starts in, the
 * league-scored backup to bring in there, and a verified place to fix it.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { fanOutCopy, groupAlertsByPlayer, playerKeyOf, type FanOutAlert, type FanOutLeague } from '@/lib/chimmy-alerts/injuryFanOutCopy'
import { fixLinkFor } from '@/lib/chimmy-alerts/injuryFanOut'
import { renderInjuryEmail } from '@/lib/notifications/injuryEmail'

const alert = (leagueId: string, player: string, urgency: number, extra: Record<string, unknown> = {}): FanOutAlert => ({
  title: `${player} is Out and still starting`,
  message: `${player} is listed Out in ${leagueId}.`,
  leagueId,
  urgencySignal: urgency,
  metadata: { playerName: player, designation: 'Out', minutesToLock: 45, ...extra },
})

const league = (leagueId: string, startName: string | null, fixHref: string | null = null): FanOutLeague => ({
  leagueId,
  leagueName: `League ${leagueId}`,
  startName,
  fixHref,
  fixLabel: fixHref ? 'Open in Sleeper' : null,
})

describe('groupAlertsByPlayer', () => {
  it('one group per player, ordered by his most urgent league; the same player in 3 leagues is ONE group', () => {
    const groups = groupAlertsByPlayer([
      alert('L1', 'Tank Dell', 70),
      alert('L2', 'Jayden Reed', 88),
      alert('L3', 'Tank Dell', 95),
      alert('L4', 'Jayden Reed', 60),
    ])
    expect(groups.map((g) => g.map((a) => a.leagueId))).toEqual([['L3', 'L1'], ['L2', 'L4']])
  })

  it('keys on the Sleeper id when present, so two players with one name never merge', () => {
    expect(playerKeyOf(alert('L1', 'Mike Williams', 90, { sleeperId: '4000' }))).not.toBe(
      playerKeyOf(alert('L2', 'Mike Williams', 90, { sleeperId: '5000' })),
    )
  })
})

describe('fanOutCopy', () => {
  it('one league: the detector title stands, and the body names the backup', () => {
    const c = fanOutCopy([alert('L1', 'Tank Dell', 90)], [league('L1', 'Nico Collins')])
    expect(c.title).toBe('Tank Dell is Out and still starting')
    expect(c.body).toBe('Tank Dell is listed Out, 45 minutes to lock. League L1: start Nico Collins.')
  })

  it('several leagues: the title says how many, and every league gets its own line', () => {
    const group = [alert('L1', 'Tank Dell', 95), alert('L2', 'Tank Dell', 90), alert('L3', 'Tank Dell', 80)]
    const c = fanOutCopy(group, [league('L1', 'Nico Collins'), league('L2', null), league('L3', 'Joe Mixon')])
    expect(c.title).toBe('Tank Dell is Out — still starting in 3 of your leagues')
    expect(c.body).toContain('League L1: start Nico Collins.')
    expect(c.body).toContain('League L2: no bench player can come in for him.')
    expect(c.body).toContain('League L3: start Joe Mixon.')
  })

  it('🛑 a Doubtful player is "listed Doubtful" — never called ruled out', () => {
    const c = fanOutCopy([alert('L1', 'Tank Dell', 80, { designation: 'Doubtful' })], [league('L1', 'Nico Collins')])
    expect(c.body).toContain('listed Doubtful')
    expect(c.body).not.toMatch(/ruled out/i)
  })

  it('with no per-league facts, it says what the detector said and how many other leagues he touches', () => {
    const c = fanOutCopy([alert('L1', 'Tank Dell', 95), alert('L2', 'Tank Dell', 90)], [])
    expect(c.body).toBe('Tank Dell is listed Out in L1. He also starts for you in 1 other league.')
  })
})

describe('fixLinkFor', () => {
  it('a Sleeper league links to its verified lineup screen', () => {
    const link = fixLinkFor({ id: 'L1', platform: 'sleeper', platformLeagueId: '1180000000000000000', season: 2026, name: 'KBFL', teamId: '3' })
    expect(link?.href).toContain('sleeper.com/leagues/1180000000000000000')
  })

  it('a native league links to the in-app team tab', () => {
    expect(fixLinkFor({ id: 'nat1', platform: 'allfantasy', name: 'Home League' })?.href).toBe('/league/nat1?view=team')
  })

  it('🛑 a platform that cannot be deep-linked gets NO link — never its homepage', () => {
    expect(fixLinkFor({ id: 'F1', platform: 'fleaflicker', platformLeagueId: '206154', season: 2026, name: 'Flea' })).toBeNull()
  })
})

describe('the email carries the per-league fix links', () => {
  it('one link per league with a destination, relative links made absolute', () => {
    const out = renderInjuryEmail({
      alerts: [
        {
          title: 'Tank Dell is Out — still starting in 2 of your leagues',
          message: 'Tank Dell is listed Out.',
          fixLinks: [
            { leagueName: 'KBFL', href: 'https://sleeper.com/leagues/1/team' },
            { leagueName: 'Home League', href: '/league/nat1?view=team' },
          ],
        },
      ],
      baseUrl: 'https://allfantasy.ai',
    })
    expect(out?.html).toContain('href="https://sleeper.com/leagues/1/team"')
    expect(out?.html).toContain('href="https://allfantasy.ai/league/nat1?view=team"')
    expect(out?.html).toContain('Fix your lineup in KBFL')
  })
})
