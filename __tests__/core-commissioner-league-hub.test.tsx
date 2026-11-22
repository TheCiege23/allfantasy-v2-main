import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/*
 * Commissioner Hub, one league — /core/commissioner?league= (five-doors restyle,
 * 2026-09-17). Every section stays; the header, key-art band and footer take the
 * format hubs' dress. Pinned: the tiles now live in the band (and an unmeasured one
 * still says why), the way back to all leagues, the league's own art, a send button
 * only where a send is accepted, and Commissioner OS offered only to the owner it
 * admits — opening on THIS league.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
const loadActivityCharts = vi.hoisted(() => vi.fn(() => Promise.resolve({ available: false, reason: 'n/a' })))
vi.mock('@/lib/core-app/commissioner/reports', () => ({
  loadAuditTimeline: () => Promise.resolve({ available: true, data: [] }),
  loadActivityCharts,
}))
// The streamed sections are async server components; their own suites cover them. The health
// breakdown's static half is synchronous and real, so the card's free bars are pinned here.
vi.mock('@/components/core-app/commissioner/HubReports', async (actual) => ({
  ...(await actual<typeof import('@/components/core-app/commissioner/HubReports')>()),
  OperationalCharts: () => null,
  ChartsFallback: () => null,
  HealthBreakdown: () => null,
  RecentChanges: () => null,
  RecentChangesFallback: () => null,
  AuditTimeline: () => null,
  AuditTimelineFallback: () => null,
}))
vi.mock('@/components/commish/BroadcastModal', () => ({ default: () => null }))
vi.mock('@/components/core-app/commissioner/GuidedWorkflows', () => ({ GuidedWorkflows: () => null }))
vi.mock('@/components/core-app/commissioner/AutomationRecipes', () => ({ AutomationRecipes: () => null }))
vi.mock('@/components/core-app/PublishStandingsToggle', () => ({ PublishStandingsToggle: () => null }))

import { CommissionerHub } from '@/components/core-app/screens/CommissionerHub'
import type { CommissionerHubData } from '@/lib/core-app/commissionerHub'
import { ACTIVE_LEAGUE_COOKIE_KEY } from '@/lib/commissioner-ui/activeLeague/constants'
import { decideCoreDepth } from '@/lib/core-app/coreDepthAccess'

function hub(over: Partial<CommissionerHubData> = {}): CommissionerHubData {
  return {
    allowed: true,
    formatCards: [],
    network: null,
    history: { tradeAvailable: true, draftAvailable: true, trades: [], drafts: [], tradeNote: 'No trade history', draftNote: 'No draft history' },
    grant: {} as CommissionerHubData['grant'],
    league: { id: 'L1', name: 'Dynasty Dragons', platform: 'sleeper', season: 2026, native: false },
    role: 'commissioner',
    viewerIsOwner: true,
    viewerCanBroadcast: false,
    tiles: [
      { key: 'health', label: 'League health', tone: 'good', state: { available: true, data: { value: '82', sub: 'Healthy · 90% confidence' } } },
      { key: 'needs-you', label: 'Needs you', tone: 'warn', state: { available: true, data: { value: '2', sub: 'task cards above' } } },
      { key: 'managers', label: 'Active managers', tone: 'neutral', state: { available: false, reason: 'last sync was 9 days ago' } },
    ],
    tasks: { cards: [], overflow: [] },
    tasksEmptyReason: 'Nothing in this league needs you right now.',
    health: { score: { available: false, reason: 'not enough data' }, flags: [] },
    members: {
      available: true,
      data: {
        rows: [
          { name: 'quiet-owl', status: 'inactive', detail: 'no moves in 14 days', lastActionAt: null },
          { name: 'lark', status: 'active', detail: '3 moves', lastActionAt: null },
        ],
        total: 2,
        active: 1,
        inactive: 1,
        basis: 'moves',
      },
    },
    calendar: { events: [], gaps: [], ics: null } as unknown as CommissionerHubData['calendar'],
    areas: [],
    workflows: [],
    communities: [],
    recipes: { values: {}, saved: false, updatedAt: null, sendEnabled: false, catalog: [] } as unknown as CommissionerHubData['recipes'],
    charts: { scoring: null, balance: null, engagement: null },
    settings: [],
    access: [],
    unread: false,
    disputes: { available: false, reason: 'not scanned' },
    publicStandings: { enabled: false, url: '/standings/L1' },
    waivers: { available: false, reason: 'no waivers' } as unknown as CommissionerHubData['waivers'],
    art: { label: 'Dynasty', video: '/league-type-dynasty.mp4', poster: '/league-type-dynasty.png' },
    chatHref: '/league/L1?view=league_chat',
    unclaimedTeams: 3,
    quietManagers: ['quiet-owl'],
    ...over,
  }
}

describe('<CommissionerHub /> in the hub dress', () => {
  // 2026-11-14: the headline is the answer — how many things need you — and the league is named above it.
  it('leads with the way back to every league you run, the league above the title, and the answer as the title', () => {
    render(<CommissionerHub data={hub()} />)
    expect(screen.getByRole('link', { name: '← All leagues you run' }).getAttribute('href')).toBe('/core/commissioner')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Nothing needs you right now')
    expect(screen.getByText('Core · Commissioner · Dynasty Dragons · Dynasty')).toBeTruthy()
  })

  it('carries the tiles in the key-art band, with an unmeasured one still saying why', () => {
    const { container } = render(<CommissionerHub data={hub()} />)
    const band = screen.getByRole('region', { name: 'Dynasty Dragons right now' })
    // "Needs you" is the headline now, so it is not a tile as well (2026-11-14).
    expect(band.querySelectorAll('.afh-tile')).toHaveLength(2)
    expect(band.querySelector('[data-key="needs-you"]')).toBeNull()
    expect(band.textContent).toContain('last sync was 9 days ago')
    expect(container.querySelector('.af-ch-tiles')).toBeNull()
    const video = band.querySelector('video')
    expect(video?.getAttribute('src')).toBe('/league-type-dynasty.mp4')
    expect(video?.getAttribute('poster')).toBe('/league-type-dynasty.png')
  })

  // The quiet managers are named once — on Member activity's fold — not in a line under the tiles too.
  it('counts who has gone quiet on Member activity, and prompts invites for unconnected teams', () => {
    render(<CommissionerHub data={hub()} />)
    expect(screen.queryByText(/Gone quiet:/)).toBeNull()
    expect(screen.getByTestId('hub-fold-ch-members').querySelector('summary')?.textContent).toBe('Member activity1 gone quiet')
    expect(screen.getByText(/3 teams aren’t connected/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Invite managers' }).getAttribute('href')).toBe('#ch-areas')
  })

  it('says nothing about quiet managers when there are none to name', () => {
    render(<CommissionerHub data={hub({ quietManagers: [], unclaimedTeams: 0 })} />)
    expect(screen.queryByText(/Gone quiet/)).toBeNull()
    expect(screen.queryByText(/connected to an/)).toBeNull()
  })

  it('shows the still, and no seal, for a league with no looping art', () => {
    render(<CommissionerHub data={hub({ art: { label: 'Redraft', video: null, poster: '/af-robot-king.png' } })} />)
    const band = screen.getByRole('region', { name: 'Dynasty Dragons right now' })
    expect(band.getAttribute('data-art')).toBe('still')
    expect(band.querySelector('video')).toBeNull()
    expect(band.querySelector('img')?.getAttribute('src')).toBe('/af-robot-king.png')
    expect(band.querySelector('.afh-seal')).toBeNull()
  })

  it('offers Send @everyone in the title row only where a send is accepted', () => {
    const { unmount } = render(<CommissionerHub data={hub()} />)
    expect(screen.queryByRole('button', { name: 'Send @everyone' })).toBeNull()
    unmount()
    render(<CommissionerHub data={hub({ viewerCanBroadcast: true })} />)
    expect(screen.getByRole('button', { name: 'Send @everyone' })).toBeTruthy()
  })

  it('opens Commissioner OS on this league for the owner and co-commissioner', () => {
    const { unmount } = render(<CommissionerHub data={hub()} />)
    const os = screen.getByRole('link', { name: 'Health trends in Commissioner OS →' })
    expect(os.getAttribute('href')).toBe('/commissioner-os/league-health')
    os.addEventListener('click', (e) => e.preventDefault())
    os.click()
    expect(document.cookie).toContain(`${ACTIVE_LEAGUE_COOKIE_KEY}=L1`)
    expect(screen.getByRole('link', { name: 'Open league chat →' }).getAttribute('href')).toBe('/league/L1?view=league_chat')
    unmount()

    render(<CommissionerHub data={hub({ viewerIsOwner: false, role: 'co_commissioner' })} />)
    expect(screen.getByRole('link', { name: 'Health trends in Commissioner OS →' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Open league chat →' })).toBeTruthy()
  })

  /*
   * An imported league has two authorities — AllFantasy's owner runs the hub, the platform publishes
   * its own commissioner. Seen 2026-10-01: the importer running this hub was missing from the panel.
   */
  it('names where each person runs an imported league, and explains the two authorities', () => {
    render(
      <CommissionerHub
        data={hub({
          access: [
            { handle: 'Layes23', initials: 'L', role: 'commissioner', isYou: true, basis: 'allfantasy' },
            { handle: 'Altoidman', initials: 'A', role: 'commissioner', isYou: false, basis: 'platform' },
          ],
        })}
      />,
    )
    expect(screen.getByText('Layes23')).toBeTruthy()
    expect(screen.getByText('Here on AllFantasy')).toBeTruthy()
    expect(screen.getByText('On Sleeper')).toBeTruthy()
    expect(screen.getByText(/Whoever imported this league runs it here on AllFantasy/)).toBeTruthy()
  })

  it('a native league has one authority: no per-row label and no explanation', () => {
    render(
      <CommissionerHub
        data={hub({
          league: { id: 'L1', name: 'Dynasty Dragons', platform: 'allfantasy', season: 2026, native: true } as CommissionerHubData['league'],
          access: [{ handle: 'Owner', initials: 'O', role: 'commissioner', isYou: true, basis: 'allfantasy' }],
        })}
      />,
    )
    expect(screen.getByText('Owner')).toBeTruthy()
    expect(screen.queryByText('Here on AllFantasy')).toBeNull()
    expect(screen.queryByText(/Whoever imported this league/)).toBeNull()
  })

  it('a native league\'s settings cards sit in one closed fold, not open between the folded rows', () => {
    render(
      <CommissionerHub
        data={hub({
          league: { id: 'L1', name: 'Dynasty Dragons', platform: 'allfantasy', season: 2026, native: true } as CommissionerHubData['league'],
        })}
      />,
    )
    const fold = screen.getByTestId('hub-fold-ch-native-settings') as HTMLDetailsElement
    expect(fold.open).toBe(false)
    expect(fold.querySelector('.af-ch-fold-title')?.textContent).toBe('Lineup and roster autopilot')
    const autoSubs = screen.getByText('Native AutoSubs policy')
    expect(autoSubs.closest('details')).toBe(fold)
    expect(screen.getByTestId('orphan-auction').closest('details')).toBe(fold)
  })

  it('an imported league has no native settings fold', () => {
    render(<CommissionerHub data={hub()} />)
    expect(screen.queryByTestId('hub-fold-ch-native-settings')).toBeNull()
    expect(screen.queryByText('Native AutoSubs policy')).toBeNull()
  })

  it('keeps the blocked state for someone who does not run the league, with the way back', () => {
    render(
      <CommissionerHub
        data={{ allowed: false, role: 'member', leagueName: 'Dynasty Dragons', reason: 'Commissioners and co-commissioners only.' }}
      />,
    )
    expect(screen.getByText('Commissioners and co-commissioners only')).toBeTruthy()
    expect(screen.getByRole('link', { name: '← All leagues you run' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: /right now/ })).toBeNull()
  })
})

/*
 * Commissioner depth (AF Commissioner, from Oct 15). The loader already skipped the waiver read and
 * the calendar export for a locked viewer; the screen draws locks over member activity, the charts,
 * automations, waivers and the audit log — and does not START the charts read at all.
 */
describe('<CommissionerHub /> — commissioner depth paywall', () => {
  const START = new Date('2026-10-15T04:00:00.000Z')
  const LOCKED = decideCoreDepth('commissioner_depth', { live: true, startsAt: START, hasPlan: false })
  const PRELAUNCH = decideCoreDepth('commissioner_depth', { live: false, startsAt: START, hasPlan: false })
  const PAID = decideCoreDepth('commissioner_depth', { live: true, startsAt: START, hasPlan: true })
  const LOCKS = ['Member activity', 'Waiver oversight', 'League charts', 'Automations', 'The full audit log']

  it('locked: each depth section is a lock to AF Commissioner, holding its jump-link id', () => {
    render(<CommissionerHub data={hub({ depth: LOCKED })} />)
    for (const what of LOCKS) {
      const lock = screen.getByRole('region', { name: `${what} — AF Commissioner` })
      // `back=` is the page the lock sits on (lib/monetization/lockReturn.ts, 2026-11-17) — jsdom's `/` here.
      expect(lock.querySelector('a')?.getAttribute('href')).toBe('/upgrade?plan=commissioner&offer=monthly&from=lock_commissioner_depth&back=%2F')
    }
    for (const id of ['ch-members', 'ch-waivers', 'ch-reports', 'ch-recipes', 'ch-timeline']) {
      expect(document.getElementById(id)?.className).toBe('af-ch-depth-lock')
    }
    // The member list itself is not drawn — its basis line is the tell.
    expect(document.body.textContent).not.toContain('Judged by moves.')
  })

  it('this week’s lineups, AF beside API: a free section with its jump link, drawn only when handed lineups', () => {
    const lineups = {
      season: 2026,
      week: 4,
      rows: [{ rosterId: '7', name: 'lark', isYou: false, af: 120.5, afFrom: 7, api: 118.9, apiFrom: 9, starterCount: 9 }],
    }
    render(<CommissionerHub data={hub({ depth: LOCKED })} lineups={lineups} />)
    const section = document.getElementById('ch-lineups')!
    expect(section.className).toContain('af-ch-section')
    expect(section.textContent).toContain('week 4')
    expect(section.textContent).toContain('nothing here changes a standing or a ruling')
    expect(section.querySelector('tbody tr')!.textContent).toBe('lark120.5 7/9118.9')
    expect(screen.getByRole('link', { name: 'Lineups' }).getAttribute('href')).toBe('#ch-lineups')
    document.body.innerHTML = ''
    render(<CommissionerHub data={hub({ depth: LOCKED })} />)
    expect(document.getElementById('ch-lineups')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Lineups' })).toBeNull()
  })

  it('locked: the health card still breaks the score into its five parts — lineups and dues from the hub, the activity three named as the plan', () => {
    const flags = [
      { key: 'lineups', label: 'Missing lineups', measured: true, severity: 'warn', count: 2, headline: '', detail: '', names: [], action: null },
      { key: 'dues', label: 'Unpaid dues', measured: false, reason: 'Dues aren’t tracked here.', action: null },
    ] as unknown as CommissionerHubData['health']['flags']
    const teams = Array.from({ length: 12 }, (_, i) => ({ name: `T${i}`, platformUserId: null }))
    render(
      <CommissionerHub
        data={hub({ depth: LOCKED, health: { score: { available: false, reason: 'x' }, flags }, grant: { teams } as unknown as CommissionerHubData['grant'] })}
      />,
    )
    const card = screen.getByTestId('health-breakdown')
    expect(document.getElementById('ch-health')!.contains(card)).toBe(true)
    const rows = [...card.querySelectorAll('li')]
    expect(rows.map((li) => li.querySelector('.af-ch-hb-name')!.textContent)).toEqual([
      'Lineups set', 'Waiver activity', 'Trade activity', 'Dues paid', 'Chat engagement',
    ])
    // 10 of 12 lineups full → 83, with the counts it came from.
    expect(rows[0].querySelector('.af-ch-hb-value')!.textContent).toBe('83')
    expect(rows[0].textContent).toContain('10 of 12 teams have a full lineup')
    // Not measured is never drawn as zero.
    expect(rows[3].getAttribute('data-measured')).toBe('false')
    expect(rows[3].textContent).toContain('Dues aren’t tracked here.')
    for (const i of [1, 2, 4]) expect(rows[i].textContent).toContain('Part of AF Commissioner.')
  })

  it('locked: the charts read is never started', () => {
    loadActivityCharts.mockClear()
    render(<CommissionerHub data={hub({ depth: LOCKED })} />)
    expect(loadActivityCharts).not.toHaveBeenCalled()
  })

  it('locked: running the league stays free — tasks, health, calendar, guides, areas and the rules', () => {
    render(<CommissionerHub data={hub({ depth: LOCKED })} />)
    for (const id of ['ch-tasks', 'ch-health', 'ch-calendar', 'ch-workflows', 'ch-areas', 'ch-rules']) {
      expect(document.getElementById(id), id).not.toBeNull()
      expect(document.getElementById(id)?.className, id).not.toBe('af-ch-depth-lock')
    }
  })

  it('before launch it all renders, each depth section marked "Free until Oct 15 — then AF Commissioner"', () => {
    loadActivityCharts.mockClear()
    render(<CommissionerHub data={hub({ depth: PRELAUNCH })} />)
    expect(screen.queryByTestId('core-lock-commissioner_depth')).toBeNull()
    expect(document.body.textContent).toContain('Judged by moves.')
    const notes = screen.getAllByTestId('core-free-until-commissioner_depth')
    expect(notes).toHaveLength(LOCKS.length)
    expect(notes[0]).toHaveTextContent('Free until Oct 15 — then AF Commissioner')
    expect(loadActivityCharts).toHaveBeenCalledTimes(1)
  })

  it('a plan holder sees it all with no lock and no note; no depth at all renders as before', () => {
    render(<CommissionerHub data={hub({ depth: PAID })} />)
    expect(screen.queryByTestId('core-lock-commissioner_depth')).toBeNull()
    expect(screen.queryByTestId('core-free-until-commissioner_depth')).toBeNull()
    expect(document.body.textContent).toContain('Judged by moves.')
  })
})

/*
 * The hub, said once and folded (2026-11-14). The headline is the answer — how many things need you —
 * the tiles drop what it and the lines under them already say, and every section below "Needs you now"
 * is one folded row that opens in place. Nothing inside a section changed.
 */
describe('<CommissionerHub /> — the answer up top, everything else folded', () => {
  const card = (id: string) => ({ id, severity: 'warn' as const, source: 'health' as const, title: `Task ${id}`, detail: 'detail', due: null, action: null })

  it('the headline counts the task cards, and says so when there are none or the league never synced', () => {
    const h1 = () => screen.getByRole('heading', { level: 1 }).textContent
    const one = render(<CommissionerHub data={hub({ tasks: { cards: [card('a')], overflow: [] } as never })} />)
    expect(h1()).toBe('1 thing needs you')
    one.unmount()
    const many = render(<CommissionerHub data={hub({ tasks: { cards: [card('a'), card('b')], overflow: [card('c')] } as never })} />)
    expect(h1()).toBe('3 things need you')
    many.unmount()
    render(<CommissionerHub data={hub({ unread: true })} />)
    expect(h1()).toBe('This league hasn’t synced yet')
  })

  it('in Spanish too', () => {
    render(<CommissionerHub data={hub({ tasks: { cards: [card('a'), card('b')], overflow: [] } as never })} language="es" />)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('2 cosas necesitan de ti')
    expect(screen.getByTestId('hub-fold-ch-members').querySelector('summary')?.textContent).toBe('Actividad de los miembros1 sin actividad')
  })

  it('no "Everything it takes…" paragraph, no Claimed teams tile, and the tournaments link sits by the way back', () => {
    const { container } = render(
      <CommissionerHub
        data={hub({
          tiles: [
            ...hub().tiles,
            { key: 'claimed', label: 'Claimed teams', tone: 'neutral', state: { available: true, data: { value: '1', sub: 'of 14' } } },
          ] as never,
        })}
      />,
    )
    expect(container.textContent).not.toContain('Everything it takes to run this league')
    expect(container.querySelector('[data-key="claimed"]')).toBeNull()
    const more = screen.getByRole('link', { name: 'Multi-league tournaments and weekly reports →' })
    expect(more.closest('.af-ch-back-row')).not.toBeNull()
    expect(more.className).not.toContain('afh-btn')
  })

  it('"Needs you now" stays open; every section below it is a closed fold whose summary names it', () => {
    const { container } = render(<CommissionerHub data={hub()} />)
    expect(screen.getByText('Needs you now').closest('details')).toBeNull()
    const folds = [...container.querySelectorAll('details.af-ch-fold')] as HTMLDetailsElement[]
    expect(folds.length).toBeGreaterThanOrEqual(15)
    expect(folds.every((d) => !d.open)).toBe(true)
    const titles = folds.map((d) => d.querySelector('.af-ch-fold-title')?.textContent)
    for (const title of ['Commissioner intelligence', 'Member activity', 'League health', 'League calendar', 'How this league runs', 'Who can run this league', 'Public standings', 'Audit log']) {
      expect(titles, title).toContain(title)
    }
    // The jump chips still land on the section inside its fold.
    expect(screen.getByTestId('hub-fold-ch-health').querySelector('#ch-health')).not.toBeNull()
  })

  it('the health fold carries the score; Recent changes sits in the audit log fold, not beside Member activity', () => {
    const { container } = render(
      <CommissionerHub data={hub({ health: { score: { available: true, data: { score: 74.6, status: 'healthy', summary: 'ok', confidencePct: 80 } }, flags: [] } as never })} />,
    )
    expect(screen.getByTestId('hub-fold-ch-health').querySelector('.af-ch-fold-note')?.textContent).toBe('75/100')
    expect(container.querySelector('.af-ch-split')).toBeNull()
  })
})

describe('the fold a jump link points into opens', () => {
  it('opens the closed fold holding the target, and only that one', async () => {
    const { openFoldFor } = await import('@/components/core-app/commissioner/HubFoldOpener')
    document.body.innerHTML =
      '<details class="af-ch-fold" id="f1"><summary>A</summary><section id="ch-a"></section></details>' +
      '<details class="af-ch-fold" id="f2"><summary>B</summary><section id="ch-b"></section></details>'
    expect(openFoldFor('#ch-b')).toBe(true)
    expect((document.getElementById('f2') as HTMLDetailsElement).open).toBe(true)
    expect((document.getElementById('f1') as HTMLDetailsElement).open).toBe(false)
    expect(openFoldFor('#nowhere')).toBe(false)
    document.body.innerHTML = ''
  })
})

describe('said once', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
  it('the action queue intro is one line, in both languages', () => {
    const q = read('components/core-app/CommissionerActionQueue.tsx')
    expect(q).toContain("t('Each task clears itself when the problem is fixed. Reviewing one never changes a roster.','Cada tarea se cierra sola")
    expect(q).not.toContain('Everything waiting on you: lineup gaps')
  })
  it('no second "Commissioner OS" heading inside the intelligence fold', () => {
    expect(read('components/league-hub/CommissionerOsActionsSummary.tsx')).not.toContain('<h2 className="af-ch-os-title">Commissioner OS</h2>')
  })
})
