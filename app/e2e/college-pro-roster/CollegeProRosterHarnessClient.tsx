'use client'

import { useSearchParams } from 'next/navigation'
import { CollegeProRoster } from '@/components/league/college-pro/CollegeProRoster'
import type { CollegeProRosterPayload, CollegeProSide } from '@/lib/league/collegePro/loadCollegeProRoster'

/**
 * Fixture only: names echo Peach Bowl's real roster from the owner's screenshot so the page reads like the
 * league it is built for. `?lead=college` shows a college game day, `?format=devy` the Devy variant.
 */

const p = (id: string, name: string, position: string, team: string) => ({ id, name, position, team, imageUrl: null, logoUrl: null })

const PRO: CollegeProSide = {
  role: 'pro',
  sport: 'NFL',
  platform: 'sleeper',
  leagueName: 'Peach Bowl (C2C)',
  teamLabel: '(F) SF TEP',
  leagueHref: '/league/harness',
  starters: [
    { slot: 'QB', playerId: 'hurts' },
    { slot: 'RB', playerId: 'crod' },
    { slot: 'RB', playerId: 'giddens' },
    { slot: 'WR', playerId: 'mclaurin' },
    { slot: 'WR', playerId: 'teslaa' },
    { slot: 'TE', playerId: 'kelce' },
    { slot: 'FLEX', playerId: 'qj' },
    { slot: 'FLEX', playerId: 'barner' },
    { slot: 'FLEX', playerId: null },
    { slot: 'SUPER_FLEX', playerId: 'daniels' },
  ],
  bench: ['young', 'winston', 'juszczyk', 'kolar', 'higbee', 'nailor'],
  taxi: ['cowing', 'douglas'],
  ir: [],
  players: Object.fromEntries(
    [
      p('hurts', 'Jalen Hurts', 'QB', 'PHI'),
      p('crod', 'Chris Rodriguez Jr.', 'RB', 'JAX'),
      p('giddens', 'DJ Giddens', 'RB', 'IND'),
      p('mclaurin', 'Terry McLaurin', 'WR', 'WAS'),
      p('teslaa', 'Isaac TeSlaa', 'WR', 'DET'),
      p('kelce', 'Travis Kelce', 'TE', 'KC'),
      p('qj', 'Quentin Johnston', 'WR', 'LAC'),
      p('barner', 'AJ Barner', 'TE', 'SEA'),
      p('daniels', 'Jayden Daniels', 'QB', 'WAS'),
      p('young', 'Bryce Young', 'QB', 'CAR'),
      p('winston', 'Jameis Winston', 'QB', 'NYG'),
      p('juszczyk', 'Kyle Juszczyk', 'FB', 'SF'),
      p('kolar', 'Charlie Kolar', 'TE', 'LAC'),
      p('higbee', 'Tyler Higbee', 'TE', 'LAR'),
      p('nailor', 'Jalen Nailor', 'WR', 'LV'),
      p('cowing', 'Jacob Cowing', 'WR', 'SF'),
      p('douglas', 'Caleb Douglas', 'WR', 'MIA'),
    ].map((x) => [x.id, x]),
  ),
  unavailable: null,
  points: { hurts: 21.36, crod: 8.4, giddens: 12.1, mclaurin: 14.7, teslaa: 3.2, kelce: 9.8, qj: 16.5, barner: 6.0, daniels: 0, young: 11.2, juszczyk: 1.5 },
  score: { week: 11, total: 93.56, opponent: { name: 'Connor0488', total: 101.2 }, note: null },
}

const COLLEGE: CollegeProSide = {
  role: 'college',
  sport: 'NCAAF',
  platform: 'fantrax',
  leagueName: 'Cream Bowl',
  teamLabel: '(F) SF TEP',
  leagueHref: '/league/harness-college',
  starters: [
    { slot: 'QB', playerId: 'c-qb1' },
    { slot: 'QB', playerId: 'c-qb2' },
    { slot: 'RB', playerId: 'c-rb1' },
    { slot: 'WR', playerId: 'c-wr1' },
    { slot: 'WR', playerId: 'c-wr2' },
    { slot: 'TE', playerId: 'c-te1' },
    { slot: 'FLEX', playerId: 'c-wr3' },
    { slot: 'SUPER_FLEX', playerId: 'c-rb2' },
  ],
  bench: ['c-wr4', 'c-rb3', 'c-te2'],
  taxi: [],
  ir: [],
  players: Object.fromEntries(
    [
      p('c-qb1', 'Arch Manning', 'QB', 'Texas'),
      p('c-qb2', 'Dylan Raiola', 'QB', 'Nebraska'),
      p('c-rb1', 'Jeremiah Smith', 'WR', 'Ohio State'),
      p('c-wr1', 'Ryan Williams', 'WR', 'Alabama'),
      p('c-wr2', 'Cam Coleman', 'WR', 'Auburn'),
      p('c-te1', 'Duce Robinson', 'TE', 'Florida State'),
      p('c-wr3', 'Dakorien Moore', 'WR', 'Oregon'),
      p('c-rb2', 'Jerrick Gibson', 'RB', 'Texas'),
      p('c-wr4', 'Jordan Seaton', 'WR', 'Colorado'),
      p('c-rb3', 'Isaac Brown', 'RB', 'Louisville'),
      p('c-te2', 'Luke Hasz', 'TE', 'Ole Miss'),
    ].map((x) => [x.id, x]),
  ),
  unavailable: null,
  points: { 'c-qb1': 24.9, 'c-qb2': 18.3, 'c-rb1': 22.4, 'c-wr1': 11.0, 'c-wr2': 7.6, 'c-te1': 5.3, 'c-wr3': 13.1, 'c-rb2': 9.2, 'c-wr4': 4.4 },
  score: { week: 11, total: 111.8, opponent: null, note: 'College points use standard college scoring, so Fantrax may show slightly different numbers.' },
}

let installed = false
function installFetch(lead: 'pro' | 'college', format: 'c2c' | 'devy') {
  if (installed || typeof window === 'undefined') return
  installed = true
  const real = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/api/league/college-pro-roster')) {
      const body: CollegeProRosterPayload = {
        applies: true,
        format,
        lead,
        leadReason: lead === 'college' ? 'live' : 'today',
        sides: lead === 'college' ? [COLLEGE, PRO] : [PRO, COLLEGE],
        fetchedAt: new Date().toISOString(),
      }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }
    return real(input, init)
  }
}

export function CollegeProRosterHarnessClient() {
  const params = useSearchParams()
  const lead = params.get('lead') === 'college' ? 'college' : 'pro'
  const format = params.get('format') === 'devy' ? 'devy' : 'c2c'
  installFetch(lead, format)
  return (
    <div className="min-h-screen bg-[#07101a] text-white" data-league-skin={format}>
      <div className="mx-auto max-w-5xl">
        <CollegeProRoster leagueId="harness" onPlayerClick={() => {}} fallback={<p className="p-4 text-sm">fallback</p>} />
      </div>
    </div>
  )
}
