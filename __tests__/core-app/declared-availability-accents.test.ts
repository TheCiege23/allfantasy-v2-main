// @vitest-environment node
/**
 * The accent gap in `declaredAvailability().hides` (2026-11-28).
 *
 * A pasted player nobody matched keeps a `yahoo-paste:<name>|<pos>|<team>` id. Its name used to be built
 * with `normalizePlayerName` alone, which DROPS a non-ASCII letter ("José Ramírez" → "jos ramrez"). With
 * no `player_metadata` stored for him, that lossy name was all `hides` had, so an unaccented wire
 * spelling ("Jose Ramirez") could not meet it and a rostered player read as a free agent.
 *
 * The fix is at the source: the paste id is now built from the accent-folded name (NFD, combining marks
 * stripped) through the SAME `normalizePlayerName` — no second normalizer. These tests build the id with
 * the REAL importer (`buildYahooSnapshotPayload`), never a hand-typed string, so a change to how the id
 * is made is a change these tests see.
 */
import { describe, expect, it } from 'vitest'

import { declaredAvailability } from '@/lib/core-app/declaredAvailability'
import { buildYahooSnapshotPayload, mergeYahooSnapshotPage } from '@/lib/league-import/yahoo/snapshot/yahooSnapshotModel'
import { emptyYahooSnapshot, type YahooSnapshotRoster } from '@/lib/league-import/yahoo/snapshot/yahooSnapshotTypes'

const declared = (n: number) => Array.from({ length: n }, (_, i) => `sleeper:${100 + i}`)

/** The paste id the importer writes for one pasted player. */
function pasteIdFor(playerName: string, position = 'RB', nflTeam = 'NYJ'): string {
  const roster: YahooSnapshotRoster = {
    kind: 'roster',
    teamName: 'Turf Toe',
    managerName: 'Alex',
    players: [{ slot: 'BN', playerName, position, nflTeam }],
  }
  let s = emptyYahooSnapshot('987654')
  s = mergeYahooSnapshotPage(s, {
    kind: 'settings',
    leagueName: 'L',
    numTeams: 1,
    season: 2026,
    scoringType: null,
    draftType: null,
    usesFaab: null,
    playoffStartWeek: null,
    playoffTeams: null,
    rosterPositions: [{ position: 'BN', count: 1 }],
    scoring: [],
  } as never)
  s = mergeYahooSnapshotPage(s, { kind: 'standings', teams: [{ rank: 1, teamName: 'Turf Toe', managerName: 'Alex', wins: 0, losses: 0, ties: 0, pointsFor: 0 }] } as never)
  s = mergeYahooSnapshotPage(s, roster)
  const ids = buildYahooSnapshotPayload(s, new Date('2026-11-28T00:00:00Z')).teams[0]!.rosterPlayerIds
  expect(ids).toHaveLength(1)
  return ids[0]!
}

/** A league above the coverage bar whose one unmatched player has NO stored player_metadata. */
const leagueWith = (pasteId: string) => declaredAvailability('yahoo', [{ players: [...declared(20), pasteId] }])!

const SPELLINGS = ['José Ramírez', 'Jose Ramirez', 'José Ramirez', 'Jose Ramírez', 'JOSÉ RAMÍREZ', 'jose ramirez']

describe('paste id → hides, with no player_metadata', () => {
  it('the paste id keeps the letters an accent sat on', () => {
    expect(pasteIdFor('José Ramírez')).toBe('yahoo-paste:jose ramirez|RB|NYJ')
    // An unaccented name builds exactly the id it always did.
    expect(pasteIdFor('Jose Ramirez')).toBe('yahoo-paste:jose ramirez|RB|NYJ')
    expect(pasteIdFor("Ja'Marr Chase", 'WR', 'CIN')).toBe("yahoo-paste:ja'marr chase|WR|CIN")
    expect(pasteIdFor('Marvin Harrison Jr.', 'WR', 'ARI')).toBe('yahoo-paste:marvin harrison|WR|ARI')
  })

  for (const pasted of ['José Ramírez', 'Jose Ramirez', 'José Ramirez']) {
    for (const wire of SPELLINGS) {
      it(`pasted "${pasted}" hides wire "${wire}"`, () => {
        expect(leagueWith(pasteIdFor(pasted)).hides({ name: wire, position: 'RB', team: 'NYJ' })).toBe(true)
      })
    }
  }

  it('control: a DIFFERENT player is not hidden, nor the same name on the other side of the ball', () => {
    const v = leagueWith(pasteIdFor('José Ramírez'))
    expect(v.hides({ name: 'José Ramos', position: 'RB', team: 'NYJ' })).toBe(false)
    expect(v.hides({ name: 'Jose Ramirez', position: 'LB', team: 'NYJ' })).toBe(false)
    expect(v.hides({ name: 'Joseph Ramirez', position: 'RB', team: 'NYJ' })).toBe(true) // nickname rule: same surname, a given-name prefix
    expect(v.hides({ name: 'Jorge Ramirez', position: 'RB', team: 'NYJ' })).toBe(false)
  })

  it('an OLD paste id (built before the fold, letters already lost) still hides every accented spelling it hid', () => {
    const v = leagueWith('yahoo-paste:jos ramrez|RB|NYJ')
    expect(v.hides({ name: 'José Ramírez', position: 'RB', team: 'NYJ' })).toBe(true)
    expect(v.hides({ name: 'JOSÉ RAMÍREZ', position: 'RB', team: 'NYJ' })).toBe(true)
    // An accented surname meets it through the nickname pass (given "jose" extends the lost "jos").
    expect(v.hides({ name: 'Jose Ramírez', position: 'RB', team: 'NYJ' })).toBe(true)
    expect(v.hides({ name: 'José Ramos', position: 'RB', team: 'NYJ' })).toBe(false)
  })

  it('⚠ the one gap left, pinned so it is a fact and not a claim: an OLD id, no metadata, unaccented surname', () => {
    // The surname's letter is gone from the stored id ("ramrez") and absent from the wire's accent
    // marks, so nothing can restore it. Every import writes player_metadata, which closes it.
    const v = leagueWith('yahoo-paste:jos ramrez|RB|NYJ')
    expect(v.hides({ name: 'Jose Ramirez', position: 'RB', team: 'NYJ' })).toBe(false)
    const withMeta = declaredAvailability('yahoo', [
      { players: [...declared(20), 'yahoo-paste:jos ramrez|RB|NYJ'], player_metadata: { 'yahoo-paste:jos ramrez|RB|NYJ': { name: 'José Ramírez', position: 'RB', team: 'NYJ' } } },
    ])!
    expect(withMeta.hides({ name: 'Jose Ramirez', position: 'RB', team: 'NYJ' })).toBe(true)
  })
})
