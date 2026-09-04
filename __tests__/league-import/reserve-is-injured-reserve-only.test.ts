/**
 * `reserve_ids` means INJURED RESERVE. It does not mean "not starting".
 *
 * 🛑 WHY THIS EXISTS. A user reported healthy players — Lamar Jackson among them —
 * showing on IR. There is no `bench_ids` in the import contract: the bench is
 * DERIVED wherever it is rendered, as `players − starters − reserve − taxi`
 * (`SleeperLeagueCreationBootstrapService`, `lib/core-app/myTeam.ts`,
 * `lib/data/league-home.ts`). `reserve_ids` is the "Injured Reserve" section.
 *
 * So every adapter that filed its non-starters as `reserve` did two things at
 * once: it emptied the bench, and it told managers their healthy players were
 * hurt. Measured on production 2026-09-04, before the fix:
 *
 *   platform   avg players   avg starters   avg reserve
 *   sleeper       22.3           9.5            0.4      <- real IR
 *   espn           9.3           5.1            4.2      <- the whole bench
 *   fantrax       39             10            29        <- the whole bench
 *
 * and every sampled ESPN roster carried `lineup_sections.bench = []` with the
 * bench sitting under `ir`.
 *
 * These tests pin the boundary per provider. They are pure parser tests — no
 * network, no database — because the classification is the whole bug.
 */

import { describe, expect, it } from 'vitest'

import { parseEspnRosterEntriesForTest } from '@/lib/league-import/espn/EspnLeagueFetchService'
import { parseYahooRosterForTest } from '@/lib/league-import/yahoo/YahooLeagueFetchService'
import { parseMflRostersForTest } from '@/lib/league-import/mfl/MflLeagueFetchService'

describe('ESPN roster slots', () => {
  const entries = [
    { playerId: 1, lineupSlotId: 0, playerPoolEntry: { player: { fullName: 'Starting QB' } } },
    { playerId: 2, lineupSlotId: 2, playerPoolEntry: { player: { fullName: 'Starting RB' } } },
    { playerId: 3, lineupSlotId: 20, playerPoolEntry: { player: { fullName: 'Bench WR' } } },
    { playerId: 4, lineupSlotId: 21, playerPoolEntry: { player: { fullName: 'Hurt TE' } } },
  ]

  /**
   * 🛑 THE HEADLINE. Slot 20 is the bench and slot 21 is injured reserve —
   * `ESPN_SLOT_LABELS` in that same file has always said so. They shared one
   * `ESPN_RESERVE_SLOTS` set, so the bench arrived as IR.
   */
  it('files only slot 21 as reserve, never the bench', () => {
    const out = parseEspnRosterEntriesForTest(entries)
    expect(out.reserveIds).toEqual(['4'])
  })

  /**
   * 🛑 AND THE ONE THAT NAMES A QUARTERBACK. ESPN's QB slot id is `0`, which
   * `toPositiveInt(entry.lineupSlotId, 20)` rejected as non-positive and replaced
   * with the bench slot. Every ESPN starting QB was imported as a non-starter.
   */
  it('keeps slot 0 (QB) as a starter rather than defaulting it to the bench', () => {
    const out = parseEspnRosterEntriesForTest(entries)
    expect(out.starterIds).toContain('1')
    expect(out.reserveIds).not.toContain('1')
  })

  it('leaves the bench out of both lists so it derives downstream', () => {
    const out = parseEspnRosterEntriesForTest(entries)
    expect(out.starterIds).not.toContain('3')
    expect(out.reserveIds).not.toContain('3')
    expect(out.playerIds).toContain('3')
  })

  /** A missing slot id is unknowable, and the safe unknown is bench — not IR. */
  it('treats a missing lineupSlotId as bench, not as injured reserve', () => {
    const out = parseEspnRosterEntriesForTest([
      { playerId: 9, playerPoolEntry: { player: { fullName: 'No Slot' } } },
    ])
    expect(out.reserveIds).toEqual([])
    expect(out.starterIds).toEqual([])
    expect(out.playerIds).toEqual(['9'])
  })
})

describe('Yahoo roster slots', () => {
  /**
   * The FLAT fragment list is what `mergeYahooEntityFragments` folds into one
   * object — it keeps `entity[0]` when the first element is itself an array, so a
   * nested payload only ever contributes its first sub-array. These fixtures use
   * the flat shape so the classification below is what is under test.
   */
  const roster = (rows: Array<{ id: string; slot: string; starting?: number }>) => ({
    fantasy_content: {
      team: [
        {},
        {
          roster: {
            players: rows.reduce<Record<string, unknown>>(
                (acc, row, index) => {
                  acc[String(index)] = {
                    player: [
                      { player_key: row.id },
                      { name: { full: row.id } },
                      { display_position: 'WR' },
                      { editorial_team_abbr: 'BAL' },
                      { selected_position: [{ position: row.slot }] },
                      ...(row.starting != null
                        ? [{ starting_status: [{ is_starting: row.starting }] }]
                        : []),
                    ],
                  }
                  return acc
                },
                { count: rows.length },
            ),
          },
        },
      ],
    },
  })

  it('files BN as bench and IR as reserve', () => {
    const out = parseYahooRosterForTest(
      roster([
        { id: 'starter', slot: 'WR' },
        { id: 'benched', slot: 'BN' },
        { id: 'hurt', slot: 'IR' },
      ]),
    )
    expect(out.reserveIds).toEqual(['hurt'])
    expect(out.starterIds).toEqual(['starter'])
    expect(out.playerIds).toEqual(['starter', 'benched', 'hurt'])
  })

  /** Yahoo spells injured reserve several ways; a bare set membership test misses the suffixed ones. */
  it('recognises the suffixed IR/IL spellings', () => {
    const out = parseYahooRosterForTest(
      roster([
        { id: 'a', slot: 'WR' },
        { id: 'irr', slot: 'IR-R' },
        { id: 'il60', slot: 'IL60' },
      ]),
    )
    expect(out.reserveIds).toEqual(['irr', 'il60'])
  })

  /**
   * Yahoo cannot start a player from an IR slot, so a row carrying both an IR
   * slot and `is_starting` is an IR row.
   */
  it('lets the IR slot win over a stale is_starting flag', () => {
    const out = parseYahooRosterForTest(roster([{ id: 'hurt', slot: 'IR', starting: 1 }]))
    expect(out.reserveIds).toEqual(['hurt'])
    expect(out.starterIds).toEqual([])
  })
})

describe('MFL roster slots', () => {
  const rosters = (players: Array<{ id: string; status?: string }>) => ({
    rosters: {
      franchise: [
        {
          id: '0001',
          player: players.map((p) => ({ id: p.id, ...(p.status ? { status: p.status } : {}) })),
        },
      ],
    },
  })

  it('separates injured reserve from the bench and the taxi squad', () => {
    const [out] = parseMflRostersForTest(
      rosters([
        { id: 'start', status: 'STARTER' },
        { id: 'bench', status: 'ROSTER' },
        { id: 'taxi', status: 'TAXI_SQUAD' },
        { id: 'hurt', status: 'INJURED_RESERVE' },
      ]),
    )
    expect(out!.starterIds).toEqual(['start'])
    expect(out!.reserveIds).toEqual(['hurt'])
    expect(out!.taxiIds).toEqual(['taxi'])
  })

  /**
   * 🛑 THE OLD FALLBACK PUT THE WHOLE ROSTER ON IR when MFL returned no statuses.
   * Not knowing the lineup is honestly "everyone is on the bench", which an empty
   * starters/reserve/taxi set derives to; `lineupBreakdownAvailable` already
   * reports the gap.
   */
  it('does not file an unknown lineup as an entirely injured squad', () => {
    const [out] = parseMflRostersForTest(rosters([{ id: 'a' }, { id: 'b' }, { id: 'c' }]))
    expect(out!.reserveIds).toEqual([])
    expect(out!.lineupBreakdownAvailable).toBe(false)
    expect(out!.playerIds).toEqual(['a', 'b', 'c'])
  })
})
