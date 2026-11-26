/**
 * A pasted Yahoo league's players → our own ids, at import time, and the readers honouring them.
 *
 * Production 2026-11-25: one pasted league, 10 rosters, every player a `yahoo-paste:<name>|<pos>|<team>`
 * string, so every screen keyed on Sleeper ids (My Team, values, projections, Chimmy) saw nobody. These
 * tests run the REAL model → resolver plan → YahooAdapter → id-space readers chain on a fictional league
 * (team and manager names invented; NFL players are real).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ findMany: vi.fn(), loose: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { playerIdentityMap: { findMany: h.findMany } } }))
vi.mock('@/lib/player-identity/linkNflFantraxIdentities', () => ({ readRowsByLooseName: h.loose }))

import { YahooAdapter } from '@/lib/league-import/adapters/yahoo/YahooAdapter'
import { buildYahooSnapshotPayload, mergeYahooSnapshotPage } from '@/lib/league-import/yahoo/snapshot/yahooSnapshotModel'
import {
  applyYahooSnapshotPlayerIds,
  collectYahooPastePlayerRefs,
  planYahooSnapshotPlayerIds,
  type YahooPasteIdentityRow,
} from '@/lib/league-import/yahoo/snapshot/yahooSnapshotPlayerIds'
import { resolveYahooSnapshotPlayerIds } from '@/lib/league-import/yahoo/snapshot/yahooSnapshotPlayerIdResolver'
import { emptyYahooSnapshot, type YahooLeagueSnapshot } from '@/lib/league-import/yahoo/snapshot/yahooSnapshotTypes'
import { sleeperReadablePlayerData, translateRostersToSleeperIds } from '@/lib/core-app/rosterIdSpace'
import { declaredSleeperId } from '@/lib/core-app/declaredSleeperId'
import { crosswalkToSleeperIds } from '@/lib/core-app/rosterIdCrosswalk'

function snapshot(): YahooLeagueSnapshot {
  let s = emptyYahooSnapshot('424242')
  s = mergeYahooSnapshotPage(s, {
    kind: 'settings',
    leagueName: 'Moonbase Fantasy',
    numTeams: 2,
    season: 2026,
    scoringType: 'Head-to-Head - Points',
    draftType: null,
    usesFaab: true,
    playoffStartWeek: 15,
    playoffTeams: 2,
    rosterPositions: [{ position: 'QB', count: 1 }, { position: 'DEF', count: 1 }, { position: 'BN', count: 3 }],
    scoring: [{ group: 'offense', name: 'Receptions', points: 1 }],
  })
  s = mergeYahooSnapshotPage(s, {
    kind: 'standings',
    teams: [
      { rank: 1, teamName: 'Lunar Landers', managerName: 'Quill', wins: 11, losses: 0, ties: 0, pointsFor: 1500 },
      { rank: 2, teamName: 'Crater Kings', managerName: 'Bex', wins: 0, losses: 11, ties: 0, pointsFor: 900 },
    ],
  })
  s = mergeYahooSnapshotPage(s, {
    kind: 'roster',
    teamName: 'Lunar Landers',
    managerName: 'Quill',
    players: [
      { slot: 'QB', playerName: 'Jayden Daniels', position: 'QB', nflTeam: 'Was' },
      { slot: 'BN', playerName: "Ja'Marr Chase", position: 'WR', nflTeam: 'Cin' },
      { slot: 'DEF', playerName: 'Philadelphia', position: 'DEF', nflTeam: 'Phi' },
      { slot: 'BN', playerName: 'Justin Jefferson', position: 'WR', nflTeam: 'Min' },
      { slot: 'BN', playerName: 'Made Up Guy', position: 'RB', nflTeam: 'NYJ' },
    ],
  })
  return s
}

/** The registry rows the read returns: one per real player, plus two Justin Jeffersons on one club. */
const ROWS: YahooPasteIdentityRow[] = [
  { canonicalName: 'Jayden Daniels', currentTeam: 'WAS', position: 'QB', sleeperId: '11566' },
  // Stored with the apostrophe; the paste may or may not keep it — matched punctuation aside.
  { canonicalName: "Ja'Marr Chase", currentTeam: 'CIN', position: 'WR', sleeperId: '7564' },
  // The same person filed twice is ONE person: same Sleeper id, so it still resolves.
  { canonicalName: 'Jayden Daniels', currentTeam: 'WAS', position: 'QB', sleeperId: '11566' },
  // Two different people with one name, one club and a compatible position → refused, not guessed.
  { canonicalName: 'Justin Jefferson', currentTeam: 'MIN', position: 'WR', sleeperId: '6794' },
  { canonicalName: 'Justin Jefferson', currentTeam: 'MIN', position: 'WR', sleeperId: '99999' },
]

describe('planYahooSnapshotPlayerIds', () => {
  it('resolves by name + club + position, maps D/ST to the club code, and counts what it refuses', () => {
    const payload = buildYahooSnapshotPayload(snapshot())
    const refs = collectYahooPastePlayerRefs(payload)
    expect(refs).toHaveLength(5)
    const { ids, coverage } = planYahooSnapshotPlayerIds(refs, ROWS)

    expect(ids.get('yahoo-paste:jayden daniels|QB|WAS')).toBe('sleeper:11566')
    expect(ids.get("yahoo-paste:ja'marr chase|WR|CIN")).toBe('sleeper:7564')
    expect(ids.get('yahoo-paste:philadelphia|DEF|PHI')).toBe('sleeper:PHI')
    expect(ids.has('yahoo-paste:justin jefferson|WR|MIN')).toBe(false)
    expect(ids.has('yahoo-paste:made up guy|RB|NYJ')).toBe(false)
    expect(coverage).toEqual({ provided: 5, resolved: 2, defenses: 1, unmatched: 1, ambiguous: 1 })
  })

  it('refuses a club or position mismatch rather than linking a namesake', () => {
    const refs = [{ id: 'yahoo-paste:jayden daniels|QB|DAL', name: 'Jayden Daniels', position: 'QB', team: 'DAL' }]
    expect(planYahooSnapshotPlayerIds(refs, ROWS).ids.size).toBe(0)
    const wrongPos = [{ id: 'yahoo-paste:jayden daniels|K|WAS', name: 'Jayden Daniels', position: 'K', team: 'WAS' }]
    expect(planYahooSnapshotPlayerIds(wrongPos, ROWS).ids.size).toBe(0)
  })

  it('refuses both when two pasted players land on one id', () => {
    const refs = [
      { id: 'yahoo-paste:jayden daniels|QB|WAS', name: 'Jayden Daniels', position: 'QB', team: 'WAS' },
      { id: 'yahoo-paste:jayden  daniels|QB|WAS', name: 'Jayden  Daniels', position: 'QB', team: 'WAS' },
    ]
    const { ids, coverage } = planYahooSnapshotPlayerIds(refs, ROWS)
    expect(ids.size).toBe(0)
    expect(coverage.ambiguous).toBe(2)
  })
})

describe('the resolved league, as stored and as read', () => {
  it('stores declared ids through the real adapter, keeps the unresolved as pasted, and readers see the Sleeper ids', async () => {
    const payload = buildYahooSnapshotPayload(snapshot())
    const { ids } = planYahooSnapshotPlayerIds(collectYahooPastePlayerRefs(payload), ROWS)
    const normalized = await YahooAdapter.normalize(applyYahooSnapshotPlayerIds(payload, ids))
    const mine = normalized.rosters.find((r) => r.team_name === 'Lunar Landers')!

    expect(mine.player_ids).toEqual([
      'sleeper:11566',
      'sleeper:7564',
      'sleeper:PHI',
      'yahoo-paste:justin jefferson|WR|MIN',
      'yahoo-paste:made up guy|RB|NYJ',
    ])
    expect(mine.starter_ids).toEqual(['sleeper:11566', 'sleeper:PHI'])
    // The name the paste gave stays attached to every id, resolved or not.
    expect(normalized.player_map?.['sleeper:11566']).toMatchObject({ name: 'Jayden Daniels', position: 'QB' })
    expect(normalized.player_map?.['yahoo-paste:made up guy|RB|NYJ']).toMatchObject({ name: 'Made Up Guy' })

    // A Yahoo league is a foreign id space: only the declared ids survive, unwrapped.
    const playerData = { players: mine.player_ids, starters: mine.starter_ids, lineup_sections: { starters: mine.starter_ids, bench: [] } }
    const readable = sleeperReadablePlayerData('yahoo', playerData, 'NFL') as Record<string, unknown>
    expect(readable.players).toEqual(['11566', '7564', 'PHI'])
    expect(readable.starters).toEqual(['11566', 'PHI'])
    expect((readable.lineup_sections as Record<string, unknown>).starters).toEqual(['11566', 'PHI'])

    const translated = await translateRostersToSleeperIds('yahoo', [{ playerData }], 'NFL')
    expect(translated.total).toBe(5)
    expect(translated.translated).toBe(3)
  })

  it('the shared crosswalk (My Team, matchup, Chimmy names) translates a declared id with no read', async () => {
    h.findMany.mockReset()
    const map = await crosswalkToSleeperIds('yahoo', 'NFL', ['sleeper:11566', 'sleeper:PHI', 'yahoo-paste:made up guy|RB|NYJ'])
    expect([...map]).toEqual([
      ['sleeper:11566', '11566'],
      ['sleeper:PHI', 'PHI'],
    ])
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it('a foreign roster with no declared ids is still stripped to nothing', () => {
    const readable = sleeperReadablePlayerData('fleaflicker', { players: ['2343', '4046'], starters: [null, '2343'] }) as Record<string, unknown>
    expect(readable.players).toEqual([])
    expect(readable.starters).toEqual([])
    expect(declaredSleeperId('4046')).toBeNull()
    expect(declaredSleeperId('sleeper:')).toBeNull()
  })
})

describe('resolveYahooSnapshotPlayerIds (the import-time read)', () => {
  beforeEach(() => {
    h.findMany.mockReset()
    h.loose.mockReset()
  })

  it('reads the registry by name, falls back to the loose read for names it did not find, and rewrites the payload', async () => {
    h.findMany.mockResolvedValue(ROWS.filter((r) => r.canonicalName === 'Jayden Daniels'))
    h.loose.mockResolvedValue([{ id: 'x', fantraxId: null, ...ROWS[1]! }])
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})

    const { payload, coverage } = await resolveYahooSnapshotPlayerIds(buildYahooSnapshotPayload(snapshot()))

    expect(h.findMany.mock.calls[0]![0].where.sport).toBe('NFL')
    expect(h.findMany.mock.calls[0]![0].where.normalizedName.in).toContain('jayden daniels')
    // Not asked loosely for a name the exact read already found.
    expect(h.loose.mock.calls[0]![0]).not.toContain('jayden daniels')
    expect(h.loose.mock.calls[0]![0]).toContain('jamarr chase')
    expect(coverage).toMatchObject({ provided: 5, resolved: 2, defenses: 1 })
    const ids = payload.teams.find((t) => t.teamName === 'Lunar Landers')!.rosterPlayerIds
    expect(ids.slice(0, 3)).toEqual(['sleeper:11566', 'sleeper:7564', 'sleeper:PHI'])
    infoSpy.mockRestore()
  })

  it('never fails the import: a failed read leaves every player as pasted', async () => {
    h.findMany.mockRejectedValue(new Error('db down'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const before = buildYahooSnapshotPayload(snapshot())
    const { payload, coverage } = await resolveYahooSnapshotPlayerIds(before)
    expect(coverage).toBeNull()
    expect(payload).toBe(before)
    warnSpy.mockRestore()
  })
})
