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

const SLEEPER_TEAMS = [
  ['8', '(F) SF TEP', 'TheCiege24'], ['5', 'Connor0488', 'Connor0488'], ['6', 'Georgia Bulldogs', 'unclerayrayy'],
  ['11', 'GrindingFFB', 'GrindingFFB'], ['12', 'It hurts to puka', 'yourdyinggranpa'], ['1', 'JMasc', 'JMasc'],
  ['2', 'KingGustov', 'KingGustov'], ['3', 'Lou Holtz & Company', 'loganhall17'], ['10', 'Scoresscotty', 'Scoresscotty'],
  ['9', 'TQ Trojans', 'TQ34'], ['4', 'jws452', 'jws452'], ['7', 'rfasti', 'rfasti'],
].map(([rosterId, teamName, ownerName]) => ({ rosterId: rosterId!, teamName: teamName!, ownerName: ownerName! }))
const FANTRAX_TEAMS = [
  ['scot', 'Scorescotty'], ['gran', 'Yourdyinggrandpa'], ['conn', 'Connor0488'], ['uga', 'Georgia Bulldogs'], ['jws', 'Jws452'],
  ['ciege', 'Ciege82'], ['logan', 'loganhall'], ['jmasc', 'Team JMasc'], ['king', 'king gustov'], ['tq', 'TQ Trojans'],
  ['grind', 'Grindingffb'], ['rf', 'rfasti'],
].map(([teamId, name]) => ({ teamId: teamId!, name: name! }))
const SUGGESTED: Record<string, string> = { '8': 'ciege', '5': 'conn', '6': 'uga', '11': 'grind', '12': 'gran', '1': 'jmasc', '2': 'king', '3': 'logan', '10': 'scot', '9': 'tq', '4': 'jws', '7': 'rf' }

/* ?sport=nba: an NBA league on Fantrax paired with a college basketball league on Fantrax (Road To Glory). */
const NBA_PRO: CollegeProSide = {
  role: 'pro', sport: 'NBA', platform: 'fantrax', leagueName: 'Road To Glory NBA', teamLabel: 'Golden State Warriors', leagueHref: '/league/harness',
  starters: [
    { slot: 'PG', playerId: 'n1' }, { slot: 'SG', playerId: 'n2' }, { slot: 'SF', playerId: 'n3' },
    { slot: 'PF', playerId: 'n4' }, { slot: 'C', playerId: 'n5' }, { slot: 'UTIL', playerId: 'n6' },
  ],
  bench: ['n7', 'n8'], taxi: ['n9'], ir: [],
  players: Object.fromEntries([
    p('n1', 'Stephen Curry', 'PG', 'GSW'), p('n2', 'Brandin Podziemski', 'SG', 'GSW'), p('n3', 'Jimmy Butler', 'SF', 'GSW'),
    p('n4', 'Draymond Green', 'PF', 'GSW'), p('n5', 'Kevon Looney', 'C', 'GSW'), p('n6', 'Jonathan Kuminga', 'SF', 'GSW'),
    p('n7', 'Buddy Hield', 'SG', 'GSW'), p('n8', 'Moses Moody', 'SG', 'GSW'), p('n9', 'Quinten Post', 'C', 'GSW'),
  ].map((x) => [x.id, x])),
  unavailable: null,
  points: { n1: 98.5, n2: 61.2, n3: 74.0, n4: 55.3, n5: 40.1, n6: 66.8, n7: 38.2 },
  score: { week: 5, total: 395.9, opponent: { name: 'Boston Celtics', total: 381.4 }, note: 'NBA points use standard scoring, so Fantrax may show slightly different numbers.' },
}
const NBA_COLLEGE: CollegeProSide = {
  role: 'college', sport: 'NCAAB', platform: 'fantrax', leagueName: 'Road To Glory NCAA Basketball', teamLabel: '#51 Butler Bulldogs', leagueHref: '/league/harness-college',
  starters: [{ slot: 'G', playerId: 'b1' }, { slot: 'G', playerId: 'b2' }, { slot: 'F', playerId: 'b3' }, { slot: 'F', playerId: 'b4' }, { slot: 'C', playerId: 'b5' }],
  bench: ['b6'], taxi: [], ir: [],
  players: Object.fromEntries([
    p('b1', 'Guard One', 'G', 'Butler'), p('b2', 'Guard Two', 'G', 'Butler'), p('b3', 'Forward One', 'F', 'Butler'),
    p('b4', 'Forward Two', 'F', 'Butler'), p('b5', 'Center One', 'C', 'Butler'), p('b6', 'Bench Wing', 'F', 'Butler'),
  ].map((x) => [x.id, x])),
  unavailable: null,
  points: { b1: 44.0, b2: 31.5, b3: 28.0, b4: 19.5, b5: 36.2 },
  score: { week: 5, total: 159.2, opponent: null, note: 'College points use standard scoring, so Fantrax may show slightly different numbers.' },
}

let installed = false
function installFetch(lead: 'pro' | 'college', format: 'c2c' | 'devy', initialScoring: 'separate' | 'combined', commish: boolean, showPipeline: boolean, mapped: boolean, nba: boolean, startUnlinked: boolean) {
  let linked = !startUnlinked
  const proSide = nba ? NBA_PRO : PRO
  const collegeSide = nba ? NBA_COLLEGE : COLLEGE
  let scoring = initialScoring
  let saved: Record<string, string> = mapped ? { ...SUGGESTED } : {}
  if (installed || typeof window === 'undefined') return
  installed = true
  const real = window.fetch.bind(window)
  window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/api/league/college-pro-roster/link') && init?.method === 'POST') {
      linked = true
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }
    if (url.includes('/api/league/college-pro-roster') && !linked) {
      const body = { applies: false, link: { needRole: 'college', candidates: [{ leagueId: 'cbb', name: 'Road To Glory NCAA Basketball', platform: 'fantrax', sport: 'NCAAB', season: 2026 }] } }
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }
    if (url.includes('/api/league/college-pro-roster') && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { scoring?: 'separate' | 'combined'; teamMap?: Record<string, string> }
      if (body.teamMap) saved = body.teamMap
      else if (body.scoring) scoring = body.scoring
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }
    if (url.includes('/api/league/college-pro-roster')) {
      const body: CollegeProRosterPayload = {
        applies: true,
        format,
        lead,
        leadReason: lead === 'college' ? 'live' : 'today',
        sides: lead === 'college' ? [collegeSide, proSide] : [proSide, collegeSide],
        scoring,
        combinedTotal: scoring === 'combined' ? Math.round(((proSide.score.total ?? 0) + (collegeSide.score.total ?? 0)) * 100) / 100 : null,
        canEditScoring: commish,
        proLeagueId: 'harness',
        headToHead:
          scoring !== 'combined'
            ? null
            : saved['5']
              ? { me: 205.36, opponent: { name: 'Connor0488', total: 198.1 }, missing: null }
              : { me: 205.36, opponent: null, missing: 'Match each pro team to its college team to compare combined scores.' },
        teamMap: scoring === 'combined' && commish ? { sleeperTeams: SLEEPER_TEAMS, fantraxTeams: FANTRAX_TEAMS, saved, suggested: SUGGESTED } : null,
        drafts: [
          { role: 'pro', platform: 'sleeper', season: 2027, phase: 'upcoming', status: 'Not started', detail: '4 rounds · linear', startsAt: null },
          { role: 'pro', platform: 'sleeper', season: 2026, phase: 'done', status: 'Done', detail: '4 rounds · linear', startsAt: null },
          { role: 'college', platform: 'fantrax', season: 2026, phase: 'done', status: 'Done', detail: '156 of 192 picks made', startsAt: null },
        ],
        pipeline: showPipeline ? {
          year: 2026,
          movingUp: [
            { playerId: 'c-x1', name: 'Travis Hunter', position: 'WR', nflTeam: 'JAX', round: 1, pick: 2 },
            { playerId: 'c-x2', name: 'Tetairoa McMillan', position: 'WR', nflTeam: 'CAR', round: 1, pick: 8 },
          ],
          rookiePool: { drafted: 257, heldInCollege: 41, unheld: 216 },
        } : null,
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
  const scoring = params.get('scoring') === 'combined' ? 'combined' : 'separate'
  installFetch(lead, format, scoring, params.get('commish') === '1', params.get('pipeline') !== '0' && params.get('sport') !== 'nba', params.get('mapped') === '1', params.get('sport') === 'nba', params.get('link') === '1')
  return (
    <div className="min-h-screen bg-[#07101a] text-white" data-league-skin={format}>
      <div className="mx-auto max-w-5xl">
        <CollegeProRoster leagueId="harness" onPlayerClick={() => {}} fallback={<p className="p-4 text-sm">fallback</p>} />
      </div>
    </div>
  )
}
