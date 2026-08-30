'use client'

import { useState } from 'react'
import DevyCore, { type DevyCoreProps, type DevyViewState } from '@/components/core-app/screens/DevyCore'
import DevyLeagueTab, { type DevyLeagueTabProps } from '@/components/core-app/screens/DevyLeagueTab'

/**
 * Preview harness for the two devy screens.
 *
 * ⚠ THE STATE SWITCHER LIVES HERE, NOT IN THE SCREENS. The handoff draws it inside each
 * mock and its README says it is a QA control that must not ship. Keeping it in the
 * preview gets the reviewer what the mock was for — all three states side by side —
 * without putting a fake control on a production surface.
 *
 * Fixture data is the handoff's own placeholder set: fictional players standing in for
 * feed data, which is what the README says to carry over (layout and data SHAPE, not the
 * values).
 */

const CORE: Omit<DevyCoreProps, 'viewState'> = {
  prospects: [
    {
      id: '1',
      rank: 1,
      name: 'Jayden Caldwell',
      position: 'QB',
      school: 'Ohio State',
      classYear: 'Soph',
      grade: 96,
      trend: 'up',
      headshotUrl: null,
      teamColor: '#BB0000',
      teamAbbrev: 'OSU',
      stats: [
        { label: 'Yds', value: '3,412' },
        { label: 'TD', value: '31' },
        { label: 'ADOT', value: '9.4' },
      ],
      blurb: 'Full-field reader with the arm to punish single-high; the deep-left rate is the tell.',
    },
    {
      id: '2',
      rank: 2,
      name: 'Marcus Rell',
      position: 'RB',
      school: 'Texas',
      classYear: 'Fr',
      grade: 91,
      trend: 'up',
      headshotUrl: null,
      teamColor: '#BF5700',
      teamAbbrev: 'TEX',
      stats: [
        { label: 'Yds', value: '1,188' },
        { label: 'YPC', value: '6.1' },
        { label: 'Rec', value: '34' },
      ],
      blurb: 'Three-down back already; the receiving usage is what separates him from the tier.',
    },
    {
      id: '3',
      rank: 3,
      name: 'Trey Vance',
      position: 'WR',
      school: 'Georgia',
      classYear: 'Soph',
      grade: 89,
      trend: 'flat',
      headshotUrl: null,
      teamColor: '#BA0C2F',
      teamAbbrev: 'UGA',
      stats: [
        { label: 'Rec', value: '61' },
        { label: 'Yds', value: '944' },
        { label: 'YAC', value: '5.8' },
      ],
      blurb: 'Wins early against press. Breakout age is the case; the target share is not there yet.',
    },
    {
      id: '4',
      rank: 4,
      name: 'Dorian Pike',
      position: 'WR',
      school: 'Oregon',
      classYear: 'Jr',
      grade: 87,
      trend: 'down',
      headshotUrl: null,
      teamColor: '#154733',
      teamAbbrev: 'ORE',
      stats: [
        { label: 'Rec', value: '48' },
        { label: 'Yds', value: '702' },
        { label: 'YAC', value: '4.1' },
      ],
      blurb: 'Slid as the offence went run-first. Grade reflects the role, not the player.',
    },
    {
      id: '5',
      rank: 5,
      name: 'Eli Brandt',
      position: 'TE',
      school: 'LSU',
      classYear: 'Soph',
      grade: null,
      trend: 'flat',
      headshotUrl: null,
      teamColor: '#461D7C',
      teamAbbrev: 'LSU',
      stats: [
        { label: 'Rec', value: '22' },
        { label: 'Yds', value: '301' },
        { label: 'TD', value: '4' },
      ],
      blurb: 'Not enough snaps to score yet — shown ungraded rather than guessed at.',
    },
  ],
  exposure: [
    { player: 'Jayden Caldwell', rosteredIn: 4, leagueCount: 6, platforms: ['Sleeper', 'Fantrax'], exposurePct: 67 },
    { player: 'Marcus Rell', rosteredIn: 3, leagueCount: 6, platforms: ['Sleeper'], exposurePct: 50 },
    { player: 'Trey Vance', rosteredIn: 2, leagueCount: 6, platforms: ['Fantrax', 'MFL'], exposurePct: 33 },
    { player: 'Dorian Pike', rosteredIn: 1, leagueCount: 6, platforms: ['Sleeper'], exposurePct: 17 },
  ],
  rankingsByPosition: {
    QB: [
      { rank: 1, name: 'Jayden Caldwell', school: 'Ohio State', classYear: 'Soph', grade: 96 },
      { rank: 2, name: 'Cole Ashby', school: 'Alabama', classYear: 'Fr', grade: 90 },
      { rank: 3, name: 'Rhett Nolan', school: 'Michigan', classYear: 'Jr', grade: 86 },
    ],
    RB: [
      { rank: 1, name: 'Marcus Rell', school: 'Texas', classYear: 'Fr', grade: 91 },
      { rank: 2, name: 'Tavien Cross', school: 'Colorado', classYear: 'Soph', grade: 88 },
      { rank: 3, name: 'Isiah Munn', school: 'LSU', classYear: 'Jr', grade: 84 },
    ],
    WR: [
      { rank: 1, name: 'Trey Vance', school: 'Georgia', classYear: 'Soph', grade: 89 },
      { rank: 2, name: 'Dorian Pike', school: 'Oregon', classYear: 'Jr', grade: 87 },
      { rank: 3, name: 'Kai Weatherly', school: 'Michigan', classYear: 'Fr', grade: 85 },
    ],
    TE: [],
  },
  watchlist: [
    { id: 'w1', name: 'Cole Ashby', position: 'QB', school: 'Alabama', headshotUrl: null },
    { id: 'w2', name: 'Tavien Cross', position: 'RB', school: 'Colorado', headshotUrl: null },
    { id: 'w3', name: 'Kai Weatherly', position: 'WR', school: 'Michigan', headshotUrl: null },
    { id: 'w4', name: 'Eli Brandt', position: 'TE', school: 'LSU', headshotUrl: null },
  ],
  colleges: [
    { school: 'Ohio State', conference: 'Big Ten', prospectCount: 9, teamColor: '#BB0000' },
    { school: 'Texas', conference: 'SEC', prospectCount: 7, teamColor: '#BF5700' },
    { school: 'Georgia', conference: 'SEC', prospectCount: 8, teamColor: '#BA0C2F' },
    { school: 'Oregon', conference: 'Big Ten', prospectCount: 5, teamColor: '#154733' },
    { school: 'Colorado', conference: 'Big 12', prospectCount: 4, teamColor: '#CFB87C' },
    { school: 'LSU', conference: 'SEC', prospectCount: 6, teamColor: '#461D7C' },
    { school: 'Alabama', conference: 'SEC', prospectCount: 7, teamColor: '#9E1B32' },
    { school: 'Michigan', conference: 'Big Ten', prospectCount: 5, teamColor: '#00274C' },
  ],
  news: [
    { id: 'n1', kind: 'breakout', player: 'Marcus Rell', blurb: '212 scrimmage yards and two scores against a top-10 front.', age: '2h ago' },
    { id: 'n2', kind: 'injury', player: 'Dorian Pike', blurb: 'Left in the third with an ankle; no designation published.', age: '6h ago' },
    { id: 'n3', kind: 'transfer', player: 'Rhett Nolan', blurb: 'Entered the portal after the coaching change.', age: '1d ago' },
    { id: 'n4', kind: 'combine', player: 'Cole Ashby', blurb: 'Invited to the spring showcase; measurements pending.', age: '2d ago' },
  ],
}

const LEAGUE: Omit<DevyLeagueTabProps, 'viewState'> = {
  leagueName: 'Last League Left',
  isCommissioner: true,
  slots: [
    { id: 's1', player: { name: 'Jayden Caldwell', position: 'QB', school: 'Ohio State', headshotUrl: null, teamColor: '#BB0000' } },
    { id: 's2', player: { name: 'Trey Vance', position: 'WR', school: 'Georgia', headshotUrl: null, teamColor: '#BA0C2F' } },
    { id: 's3', player: null },
  ],
  freeAgents: [
    { id: 'f1', name: 'Tavien Cross', position: 'RB', school: 'Colorado', grade: 88, headshotUrl: null },
    { id: 'f2', name: 'Kai Weatherly', position: 'WR', school: 'Michigan', grade: 85, headshotUrl: null },
    { id: 'f3', name: 'Isiah Munn', position: 'RB', school: 'LSU', grade: 84, headshotUrl: null },
    { id: 'f4', name: 'Eli Brandt', position: 'TE', school: 'LSU', grade: null, headshotUrl: null },
  ],
  draftRoundLabel: 'Round 1',
  draftCountdown: 'Pick due in 18h',
  draftBoard: [
    { id: 'p1', label: 'R1 · P1', team: 'Route 66', status: 'drafted', selection: 'Jayden Caldwell' },
    { id: 'p2', label: 'R1 · P2', team: 'Bear Down', status: 'on-the-clock', selection: null },
    { id: 'p3', label: 'R1 · P3', team: 'Gridiron Gang', status: 'upcoming', selection: null },
    { id: 'p4', label: 'R1 · P4', team: 'Play Action', status: 'upcoming', selection: null },
  ],
  news: [
    { id: 'ln1', kind: 'breakout', player: 'Trey Vance', blurb: 'Rostered · You — season-high 9 targets.', age: '3h ago' },
    { id: 'ln2', kind: 'transfer', player: 'Tavien Cross', blurb: 'Free agent — portal entry makes him addable here.', age: '1d ago' },
  ],
  tradeValues: [
    { player: 'Jayden Caldwell', value: 4120, trend: 'up', status: 'Rostered · You' },
    { player: 'Trey Vance', value: 2380, trend: 'flat', status: 'Rostered · You' },
    { player: 'Tavien Cross', value: 1960, trend: 'up', status: 'Free agent' },
    { player: 'Eli Brandt', value: null, trend: 'flat', status: 'Free agent' },
  ],
}

const STATES: DevyViewState[] = ['populated', 'empty', 'loading']

export function DevyPreviewClient() {
  const [screen, setScreen] = useState<'core' | 'league'>('core')
  const [state, setState] = useState<DevyViewState>('populated')

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg, #06070f)', padding: '24px 0 100px' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 40px' }}>
        <div className="af-core af-devy" style={{ marginBottom: 18 }}>
          <div className="af-devy-head">
            <div>
              <div className="af-devy-eyebrow">Dev preview</div>
              <h2 className="af-devy-title" style={{ fontSize: 18 }}>
                Devy screens
              </h2>
            </div>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
              <div className="af-devy-chips" role="group" aria-label="Screen">
                <button type="button" className="af-devy-chip" aria-pressed={screen === 'core'} onClick={() => setScreen('core')}>
                  Core
                </button>
                <button type="button" className="af-devy-chip" aria-pressed={screen === 'league'} onClick={() => setScreen('league')}>
                  League tab
                </button>
              </div>
              <div className="af-devy-chips" role="group" aria-label="View state">
                {STATES.map((s) => (
                  <button key={s} type="button" className="af-devy-chip" aria-pressed={state === s} onClick={() => setState(s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {screen === 'core' ? (
          <DevyCore viewState={state} {...CORE} />
        ) : (
          <DevyLeagueTab viewState={state} {...LEAGUE} onAddFreeAgent={() => {}} />
        )}
      </div>
    </div>
  )
}
