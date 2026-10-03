/**
 * War Room step-1 render fixes, asserted on the rendered markup.
 *
 *   - Game Plan's league chips open the screen that CHANGES a lineup, never /core/my-team
 *     (which reads one and has no control to change it).
 *   - Empty starting slots render, first, with their league's lineup link.
 *   - "Needs you first" rows on the War Room go where the issue is fixed (Sync, Draft HQ),
 *     and its all-clear stops claiming more than the queue checked. Every other screen that
 *     uses PickALeague keeps the old behaviour — asserted too.
 *   - The franchise block's sync time no longer depends on the server's zone or locale.
 */

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: unknown } & Record<string, unknown>) => {
    const { prefetch: _p, ...attrs } = rest as Record<string, unknown>
    return <a href={href} {...(attrs as Record<string, string>)}>{children as never}</a>
  },
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

import { GamePlan } from '@/components/core-app/screens/GamePlan'
import { PickALeague } from '@/components/core-app/PickALeague'
import { syncedAtLabel } from '@/components/core-app/screens/ConnectedFranchiseWarRoom'
import type { GameDayTriage, TriageRow } from '@/lib/core-app/gameDayTriage'
import type { CoreIssue } from '@/lib/core-app/outstandingIssues'
import { warRoomIssueHref } from '@/lib/core-app/warRoomIssueHref'

const NOW = '2026-09-27T15:40:00.000Z'

const row = (leagues: TriageRow['leagues']): TriageRow => ({
  player: { sport: 'NFL', externalId: 'x1', sleeperId: '1001', name: 'Gridiron Hurt', position: 'WR', team: 'NYG', imageUrl: null },
  status: { label: 'Out', tone: 'bad' },
  description: 'Ankle',
  reportedAt: null,
  leagues,
  kickoff: '2026-09-27T17:00:00.000Z',
  noGame: false,
  inactive: null,
  bye: false,
})

const sleeperLeague = { leagueId: 'L-SLP', leagueName: 'Sleeper Dynasty', platform: 'sleeper', platformLeagueId: '998877', season: 2026, teamId: '3' }
const nativeLeague = { leagueId: 'L-AF', leagueName: 'AF Native', platform: 'allfantasy', platformLeagueId: null, season: 2026, teamId: null }

function plan(data: Partial<GameDayTriage>): string {
  const full: GameDayTriage = { rows: [], week: { season: 2026, week: 3 }, leaguesRead: 2, startersRead: 18, ...data }
  return renderToStaticMarkup(<GamePlan data={full} nowIso={NOW} weekHref="/core/week" waiversHref="/core/waivers" showHead={false} />)
}

const hrefs = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))

describe('Game Plan league chips open a lineup that can be changed', () => {
  /*
   * Narrowed in step 4b, and narrowed to what it always guarded: the LINEUP buttons. My Team cannot
   * change a lineup, so a league chip must never go there. A separate, labelled "Who to start instead"
   * link to My Team is now correct (it holds the bench-swap answer) — so the check reads the chips
   * themselves, and the only My Team links allowed are those labelled ones.
   */
  it('never sends a lineup button to /core/my-team', () => {
    const html = plan({ rows: [row([sleeperLeague, nativeLeague])] })
    const chips = [...html.matchAll(/<a[^>]*class="af-gp-league"[^>]*href="([^"]+)"|<a[^>]*href="([^"]+)"[^>]*class="af-gp-league"/g)].map((m) => m[1] ?? m[2])
    expect(chips.length).toBe(2)
    expect(chips.filter((h) => h!.startsWith('/core/my-team'))).toEqual([])
    const toMyTeam = [...html.matchAll(/<a[^>]*href="(\/core\/my-team[^"]*)"[^>]*>([^<]*)/g)].map((m) => m[2])
    expect(toMyTeam.every((label) => /Who to start instead/.test(label))).toBe(true)
  })

  it('sends a native league to its in-app team tab', () => {
    const html = plan({ rows: [row([nativeLeague])] })
    expect(hrefs(html)).toContain('/league/L-AF?view=team')
  })

  it('sends a Sleeper league to the provider, in a new tab', () => {
    const html = plan({ rows: [row([sleeperLeague])] })
    const external = hrefs(html).filter((h) => h.includes('sleeper'))
    expect(external.length).toBe(1)
    expect(external[0]).toContain('998877')
    expect(html).toContain('target="_blank"')
  })
})

describe('Game Plan shows empty starting slots', () => {
  it('renders each league with an empty slot, before the flagged starters, with its lineup link', () => {
    const html = plan({ rows: [row([sleeperLeague])], emptySlots: [{ ...nativeLeague, count: 2 }] })
    expect(html).toContain('2 empty starting slots')
    expect(html.indexOf('empty starting slots')).toBeLessThan(html.indexOf('Gridiron Hurt'))
    expect(hrefs(html)).toContain('/league/L-AF?view=team')
  })

  it('does not print the all-clear when the only problem is an empty slot', () => {
    const html = plan({ rows: [], emptySlots: [{ ...nativeLeague, count: 1 }] })
    expect(html).toContain('1 empty starting slot')
    expect(html).not.toContain('No starter in any of your leagues is flagged')
  })
})

const issue = (id: string, leagueId: string): CoreIssue => ({
  id,
  severity: 'warn',
  glyph: '!',
  title: `Issue ${id}`,
  meta: 'meta',
  leagueId,
  leagueName: `League ${leagueId}`,
  platform: 'sleeper',
  deadline: null,
  action: null,
})

const leagues = [{ id: 'L1', name: 'League L1', platform: 'sleeper' }]

describe('War Room "Needs you first"', () => {
  it('routes a stale sync to Sync and a draft to Draft HQ', () => {
    expect(warRoomIssueHref({ id: 'L1:stale', leagueId: 'L1' })).toBe('/core/sync?league=L1')
    expect(warRoomIssueHref({ id: 'L1:draft', leagueId: 'L1' })).toBe('/core/draft-hq?league=L1')
    expect(warRoomIssueHref({ id: 'L1:other', leagueId: 'L1' })).toBe('/core/war-room?league=L1')
  })

  it('uses the destination it is handed', () => {
    const html = renderToStaticMarkup(
      <PickALeague tabKey="war-room" title="War Room" blurb="b" issues={[issue('L1:stale', 'L1'), issue('L1:draft', 'L1')]} leagues={leagues} issueHref={warRoomIssueHref} />,
    )
    expect(hrefs(html)).toEqual(expect.arrayContaining(['/core/sync?league=L1', '/core/draft-hq?league=L1']))
    // The picker tiles still open the War Room in that league — only the issue rows moved.
    expect(hrefs(html)).toContain('/core/war-room?league=L1')
  })

  it('prints the all-clear it is given instead of the overclaiming default', () => {
    const html = renderToStaticMarkup(
      <PickALeague tabKey="war-room" title="War Room" blurb="b" issues={[]} leagues={leagues} queueClearText="No stale syncs or upcoming drafts." />,
    )
    expect(html).toContain('No stale syncs or upcoming drafts.')
    expect(html).not.toContain('waiting on a decision')
  })

  it('leaves every other screen as it was: rows open the same tab, default all-clear', () => {
    const rows = renderToStaticMarkup(<PickALeague tabKey="waivers" title="Waivers" blurb="b" issues={[issue('L1:stale', 'L1')]} leagues={leagues} />)
    expect(hrefs(rows).filter((h) => h.startsWith('/core/waivers?league=L1')).length).toBe(2)
    const clear = renderToStaticMarkup(<PickALeague tabKey="waivers" title="Waivers" blurb="b" issues={[]} leagues={leagues} />)
    expect(clear).toContain('Nothing in your leagues is waiting on a decision right now.')
  })
})

describe('franchise sync time', () => {
  it('is pinned to Eastern and labelled, whatever zone the process runs in', () => {
    expect(syncedAtLabel('2026-09-27T17:05:00.000Z')).toBe('Sep 27, 1:05 PM ET')
    expect(syncedAtLabel(new Date('2026-01-05T03:30:00.000Z'))).toBe('Jan 4, 10:30 PM ET')
  })
  it('does not print "Invalid Date"', () => {
    expect(syncedAtLabel('not a date')).toBe('at an unknown time')
  })
})
