import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'

import { Dash3ATriage, type TriageBookRow } from '@/components/core-app/screens/Dash3ATriage'
import { DashTradeBand } from '@/components/core-app/screens/DashTradeBand'
import { DashScheduleBand } from '@/components/core-app/screens/DashScheduleBand'
import { DashGameDayBand } from '@/components/core-app/screens/DashGameDayBand'
import { DashDraftsBand } from '@/components/core-app/screens/DashDraftsBand'

vi.mock('@/components/decision-os/UserOsCard', () => ({ default: () => <div /> }))

const NOW = new Date('2026-09-06T17:05:00Z')

/*
 * Engine vocabulary that must never reach a reader. "favors A" is how the trade
 * grader talks about sides internally; it shipped to the dashboard once, where
 * it named a winner nobody could identify. The rest are the same class of
 * mistake waiting to happen — an internal word, or a missing value that
 * stringified instead of being handled.
 */
const JARGON: RegExp[] = [
  /\bfavou?rs [AB]\b/i,
  /\brosterId\b/,
  /\bplatformLeagueId\b/,
  /\bnull\b/,
  /\bundefined\b/,
  /\bNaN\b/,
  /\[object Object\]/,
]

const SEEN: Array<{ label: string; text: string }> = []

function show(label: string, ui: React.ReactElement) {
  const { container } = render(ui)
  const text = (container.textContent ?? '').replace(/\s+/g, ' ').trim()
  SEEN.push({ label, text })
  // Printed so a copy pass can read the whole dashboard in one place.
  // eslint-disable-next-line no-console
  console.log(`\n──── ${label}\n${text || '(renders nothing)'}`)
}

describe('what a reader actually sees', () => {
  it('renders every band and lets no engine vocabulary through', () => {
    show(
      'STARTERS IN DOUBT',
      <Dash3ATriage
        now={NOW}
        valueBasis={{ format: 'DYNASTY', qbFormat: 'ONE_QB' }}
        book={
          [
            {
              initials: 'AJ',
              name: 'Ashton Jeanty',
              imageUrl: null,
              leagues: [
                { id: 'l1', name: 'Bla bla bla', platform: 'sleeper', imageUrl: null, slot: 'starter', bench: [{ name: 'Tyjae Spears', position: 'RB' }] },
                { id: 'l2', name: 'Guillotine League 26', platform: 'sleeper', imageUrl: null, slot: 'bench' },
              ],
              note: 'RB · Out',
              position: 'RB',
              team: 'LV',
              sport: 'NFL',
              status: 'Out',
              exposure: '7 of 61',
              exposureCount: 7,
              exposureTotal: 61,
              startingIn: 3,
              benchIn: 3,
              irIn: 1,
              taxiIn: 0,
              description: 'Ruled out — ankle. Did not practice Friday.',
              value: { value: 6400, overallRank: 14, positionRank: 4 },
              reportedAt: NOW.toISOString(),
              reportedAgo: '3h ago',
              nextKickoffAt: new Date(NOW.getTime() + 2 * 3_600_000).toISOString(),
              tone: 'bad',
            },
          ] as TriageBookRow[]
        }
      />,
    )

    show(
      'TRADES',
      <DashTradeBand
        now={NOW}
        trades={[
          {
            id: 't1',
            leagueId: 'l1',
            leagueName: 'Bla bla bla',
            platformLeagueId: '99',
            acceptedAt: new Date(NOW.getTime() - 3 * 3_600_000).toISOString(),
            partial: false,
            sides: [
              { rosterId: 1, managerName: 'chxnk', teamName: null, received: [{ kind: 'player', name: 'Darren Waller', position: 'TE' }] },
              { rosterId: 2, managerName: 'Hustead', teamName: null, received: [{ kind: 'pick', name: '2027 4th', position: null }] },
            ],
            verdict: { verdict: 'Slightly favors A', fairness: 58, confidence: 72, favoursRosterId: 1 },
          },
        ]}
      />,
    )

    show(
      'WHO YOU PLAY',
      <DashScheduleBand
        syncLabel="synced 4m ago"
        board={{
          season: 2026,
          week: 1,
          coinFlips: [],
          leaning: [],
          unprojected: [
            { leagueId: 'l1', leagueName: 'Bla bla bla', platform: 'sleeper', season: 2026, week: 1, opponent: { rosterId: 7, name: 'DynastyDan' }, elimination: false, projection: null, yourSampleWeeks: 0, href: '/core/matchup?league=l1' },
            { leagueId: 'l2', leagueName: 'Guillotine League 26', platform: 'sleeper', season: 2026, week: 1, opponent: { rosterId: 4, name: null }, elimination: true, projection: null, yourSampleWeeks: 0, href: '/core/matchup?league=l2' },
          ],
          model: { basis: 'x', sampleSize: 0 },
          withoutSchedule: 55,
          firstKickoffAt: new Date(NOW.getTime() + 3 * 3_600_000).toISOString(),
        }}
      />,
    )

    show(
      'GAME DAY',
      <DashGameDayBand
        now={NOW}
        regularSeasonUnderway
        plays={[
          { id: 'p1', gameId: 'g1', type: 'TOUCHDOWN', playerName: 'Bijan Robinson', team: 'ATL', imageUrl: null, position: 'RB', headline: 'Bijan Robinson ran for a touchdown', yards: 12, detectedAt: new Date(NOW.getTime() - 4 * 60_000).toISOString() },
        ]}
        strip={
          {
            record: { available: false, reason: 'x' },
            health: { available: false, reason: 'x' },
            next24: [{ kind: 'game', text: 'Bills at Ravens', sub: 'NFL · Week 1', time: new Date(NOW.getTime() + 3 * 3_600_000).toISOString(), tone: null }],
          } as never
        }
      />,
    )

    show(
      'DRAFTS',
      <DashDraftsBand
        now={NOW}
        data={
          {
            rows: [
              { leagueId: 'l3', leagueName: 'Survivor All-Stars', platform: 'sleeper', imageUrl: null, phase: 'live', rawStatus: 'drafting', draftType: 'snake', rounds: 15, teamCount: 18, yourSlot: 4, picksMade: 22, pickExpiresAt: new Date(NOW.getTime() + 40 * 60_000).toISOString() },
            ],
          } as never
        }
      />,
    )

    /*
     * ⚠ THE BUG THIS EXISTS FOR. The trade card printed "Slightly favors A".
     * The grader's own verdict string says "A"; the card passed it through
     * untouched, so the one sentence telling you who won a trade named a side
     * the screen never defined. The card must resolve the roster to its
     * manager before printing.
     */
    for (const { label, text } of SEEN) {
      for (const pattern of JARGON) {
        expect(`${label}: ${text}`).not.toMatch(pattern)
      }
    }

    // And the trade card specifically must say the name it resolved.
    const trades = SEEN.find((s) => s.label === 'TRADES')!
    expect(trades.text).toContain('chxnk')
  })
})
