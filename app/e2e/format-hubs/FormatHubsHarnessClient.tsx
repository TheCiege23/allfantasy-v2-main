'use client'

import AfCoreShell from '@/components/core-app/AfCoreShell'
import FormatHub from '@/components/core-app/screens/FormatHub'
// ⚠ TYPES ONLY. lib/core-app/formatHubs.ts is `server-only` (it reads Prisma), so a VALUE import from it
// in this client file is a build error. The list is restated here; `satisfies` keeps it in step.
import type { FormatHubData, HubFormat, HubLeagueCard } from '@/lib/core-app/formatHubs'

const HUB_FORMATS = ['zombie', 'tournament', 'survivor', 'c2c', 'guillotine', 'efl'] as const satisfies readonly HubFormat[]

/*
 * ⚠ NO REQUEST LEAVES THIS PAGE. Every same-origin /api/ call gets a 503, so the broadcast form shows its own
 * failure state and nothing reaches a route or a database. Harness-only: app/e2e is 404 in production.
 */
type HarnessWindow = Window & { __afHarnessFetch?: boolean }
if (typeof window !== 'undefined' && !(window as HarnessWindow).__afHarnessFetch) {
  ;(window as HarnessWindow).__afHarnessFetch = true
  const real = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const url = new URL(raw, window.location.origin)
    if (url.origin === window.location.origin && url.pathname.startsWith('/api/')) {
      return Promise.resolve(new Response('{"error":"harness: no API"}', { status: 503, headers: { 'Content-Type': 'application/json' } }))
    }
    return real(input, init)
  }
}

/** Per format: three leagues in that format's own vocabulary, so every card state is on screen at once. */
const CARDS: Record<HubFormat, Array<Omit<HubLeagueCard, 'leagueId' | 'href'>>> = {
  guillotine: [
    { name: 'The Chopping Block', platform: 'sleeper', sub: '12-team guillotine · week 9', meter: { pct: 58, value: '7 of 12 left', tone: 'warn' }, detail: '3.4 pts over the cut', status: 'Safe this week', statusTone: 'good', youCommission: true },
    { name: 'Guilly League 26', platform: 'sleeper', sub: '18-team guillotine · week 9', meter: { pct: 50, value: '9 of 18 left', tone: 'warn' }, detail: 'On the block — 1.2 pts under the cut', statusTone: 'bad', status: 'On the block', youCommission: false },
    { name: 'Last Team Standing', platform: 'espn', sub: '10-team guillotine · week 9', meter: { pct: 20, value: '2 of 10 left', tone: 'bad' }, detail: 'Final two — highest score takes it', status: 'Final week', statusTone: 'accent', youCommission: false },
  ],
  survivor: [
    { name: 'Island of Champions', platform: 'allfantasy', sub: '16 castaways · tribal council Tue', meter: { pct: 62, value: '10 of 16 remain', tone: 'good' }, detail: 'Idol held · immunity this week', status: 'Immune', statusTone: 'good', youCommission: true },
    { name: 'Outwit Outplay', platform: 'allfantasy', sub: '12 castaways · merge next week', meter: { pct: 75, value: '9 of 12 remain', tone: 'warn' }, detail: '2 votes against you at last tribal', status: 'At risk', statusTone: 'warn', youCommission: false },
    { name: 'Exile Beach', platform: 'allfantasy', sub: '14 castaways · jury phase', meter: { pct: 0, value: 'Voted out wk 6', tone: 'muted' }, detail: 'On the jury — you vote at the final', status: 'Jury', statusTone: 'muted', youCommission: false },
  ],
  zombie: [
    { name: 'Night of the Living Fantasy', platform: 'allfantasy', sub: '12 survivors · week 9', meter: { pct: 42, value: '5 human · 7 zombie', tone: 'bad' }, detail: 'You are human — 2 bites survived', status: 'Human', statusTone: 'good', youCommission: true },
    { name: 'The Horde', platform: 'allfantasy', sub: '10 teams · week 9', meter: { pct: 80, value: '8 zombie · 2 human', tone: 'bad' }, detail: 'Turned week 4 · 3 infections since', status: 'Zombie', statusTone: 'bad', youCommission: false },
    { name: 'Safe House', platform: 'allfantasy', sub: '14 teams · week 9', meter: { pct: 14, value: '2 zombie · 12 human', tone: 'good' }, detail: 'Outbreak contained', status: 'Human', statusTone: 'good', youCommission: false },
  ],
  c2c: [
    { name: 'Campus to Canton', platform: 'allfantasy', sub: 'C2C · 12 teams · 4 devy slots', meter: { pct: 75, value: '3 of 4 devy slots', tone: 'accent' }, detail: '2 prospects declare after this season', status: 'Contender', statusTone: 'good', youCommission: true },
    { name: 'Saturday to Sunday', platform: 'fantrax', sub: 'C2C · 14 teams · 6 devy slots', meter: { pct: 33, value: '2 of 6 devy slots', tone: 'warn' }, detail: 'Room for 4 more prospects', status: 'Rebuilding', statusTone: 'warn', youCommission: false },
    { name: 'Big Board Dynasty', platform: 'allfantasy', sub: 'C2C · 10 teams · 5 devy slots', meter: { pct: 100, value: '5 of 5 devy slots', tone: 'good' }, detail: 'Full pipeline', status: 'Contender', statusTone: 'good', youCommission: false },
  ],
  tournament: [
    { name: 'Fantasy March Madness', platform: 'allfantasy', sub: '64 teams · round of 16', meter: null, detail: 'Advance by beating Gridiron Ghosts', status: 'Alive', statusTone: 'good', youCommission: true },
    { name: 'The Gauntlet', platform: 'allfantasy', sub: '32 teams · quarterfinal', meter: null, detail: 'Eliminated in round 2', status: 'Out', statusTone: 'muted', youCommission: false },
    { name: 'Champions Cup', platform: 'allfantasy', sub: '16 teams · group stage', meter: null, detail: 'Top two of group B advance', status: 'Group B · 2nd', statusTone: 'warn', youCommission: false },
  ],
  efl: [
    { name: 'Empire of the Gridiron', platform: 'allfantasy', sub: 'EFL · Premier tier · 12 teams', meter: { pct: 83, value: '2nd of 12', tone: 'good' }, detail: 'On course for the title', status: 'Title race', statusTone: 'good', youCommission: true },
    { name: 'Second Division', platform: 'allfantasy', sub: 'EFL · Championship tier · 12 teams', meter: { pct: 25, value: '10th of 12', tone: 'bad' }, detail: 'Relegation zone — 2 points from safety', status: 'Relegation fight', statusTone: 'bad', youCommission: false },
    { name: 'Frozen Throne', platform: 'allfantasy', sub: 'EFL · roster freeze · 10 teams', meter: { pct: 50, value: '5th of 10', tone: 'warn' }, detail: 'Freeze lifts in week 11', status: 'Mid-table', statusTone: 'warn', youCommission: false },
  ],
}

function fixture(format: HubFormat, empty: boolean, partial: boolean): FormatHubData {
  const counts = Object.fromEntries(HUB_FORMATS.map((f) => [f, empty && f === format ? 0 : 3])) as Record<HubFormat, number>
  const leagues = empty ? [] : CARDS[format].map((c, i) => ({ ...c, leagueId: `e2e-${format}-${i}`, href: `/core?league=e2e-${format}-${i}` }))
  return {
    format,
    counts,
    leagues,
    totalLeagues: leagues.length,
    stats: empty ? [] : [
      { value: '3', label: 'Leagues', tone: 'plain' },
      { value: '2', label: 'Still alive', tone: 'good' },
      { value: '1', label: 'At risk this week', tone: 'bad' },
      { value: '1', label: 'You commission', tone: 'accent' },
    ],
    trades: empty ? null : {
      pending: [{ id: 't1', title: 'Gridiron Ghosts → you', detail: 'Jaxon Smith-Njigba for Rashee Rice + 2027 2nd · expires Sun 11:59 PM' }],
      completed: [
        { id: 't2', title: 'You → Bench Mob', detail: 'Bijan Robinson for Breece Hall + Jameson Williams · week 7' },
        { id: 't3', title: 'Waiver Wire Wizards → Late Round QBs', detail: 'Two 2027 firsts for CeeDee Lamb · week 6' },
      ],
    },
    mentions: empty ? null : [
      { id: 'm1', author: 'Morgan', leagueName: CARDS[format][0].name, at: new Date(Date.now() - 42 * 60_000).toISOString(), text: 'Whoever is under the line this week, it was nice knowing you.' },
      { id: 'm2', author: 'Lee', leagueName: CARDS[format][1].name, at: new Date(Date.now() - 5 * 3_600_000).toISOString(), text: 'Trade block is open — DM me before Sunday.' },
    ],
    broadcastLeagueIds: empty ? [] : [`e2e-${format}-0`],
    partial,
  }
}

const isFormat = (f: string): f is HubFormat => (HUB_FORMATS as readonly string[]).includes(f)

/** Harness only (app/e2e is 404 in production): the real shell, the real hub, fixture data. */
export default function FormatHubsHarnessClient({ format, empty, partial }: { format: string; empty: boolean; partial: boolean }) {
  const f: HubFormat = isFormat(format) ? format : 'guillotine'
  const league = { id: `e2e-${f}-0`, name: CARDS[f][0].name, platform: 'sleeper', mark: 'H', sport: 'NFL' }
  return (
    <AfCoreShell
      active="commissioner"
      leagues={[league]}
      syncAge={{ label: 'just now', stale: false }}
      syncEligibleCount={0}
      scope={{ value: 'all', label: 'All leagues', favoriteIds: [], leagues: [league] }}
      comms={{ leagues: [], chimmyTokenCost: null, dockable: false, supportEmail: null }}
    >
      <div data-testid="format-hubs-fixture" data-format-fixture={f}>
        <FormatHub data={fixture(f, empty, partial)} />
      </div>
    </AfCoreShell>
  )
}
