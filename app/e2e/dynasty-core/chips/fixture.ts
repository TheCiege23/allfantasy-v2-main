/**
 * Fixtures for the dynasty chips harness (/e2e/dynasty-core/chips/[surface]). Every value is invented
 * for the screenshot. Markers are built by the REAL builder (lib/core-app/dynastyRosterMarkers.ts) from
 * SportsPlayer-shaped rows — the same id-AND-name matching, agreement and tone rules the loaders run.
 */
import type { LineupPlayer, MyTeamData } from '@/lib/core-app/myTeam'
import type { PlayerCardData } from '@/lib/core-app/playerCard'
import type { PlayerMatch } from '@/lib/core-app/playerFinder'
import type { WaiverBoard } from '@/lib/waivers/waiverBoard'
import { buildDynastyRosterMarkers, markerKeyFor, type MarkerRow } from '@/lib/core-app/dynastyRosterMarkers'
import { dynastyMyTeamFixture } from '../myteam/fixture'

export const CHIP_SURFACES = ['card', 'waivers', 'finder', 'devy'] as const
export type ChipSurface = (typeof CHIP_SURFACES)[number]

const NO = (reason: string) => ({ available: false as const, reason })

/* ── the player card ─────────────────────────────────────────────────────── */

export function playerCardFixture(opts: { markers: boolean; prospect: boolean }): PlayerCardData {
  const name = opts.prospect ? 'Tre Prospect' : 'Jalen Rookie'
  const position = opts.prospect ? 'RB' : 'WR'
  const rows: MarkerRow[] = [{ sleeperId: 'fx-card', name, position, age: opts.prospect ? 20 : 21, yearsExp: opts.prospect ? null : 0 }]
  const marker = buildDynastyRosterMarkers([{ sleeperId: 'fx-card', name, position }], rows, 'NFL', {
    prospectIds: opts.prospect ? new Set(['fx-card']) : null,
  })['fx-card']
  return {
    context: 'league',
    player: { externalId: 'fx-card', sleeperId: 'fx-card', sport: 'NFL', name, position, team: opts.prospect ? null : 'LAR', number: opts.prospect ? null : 15, imageUrl: null },
    bio: { age: opts.prospect ? 20 : 21, height: '6\'1"', weight: '204', yearsExp: opts.prospect ? null : 0, college: opts.prospect ? 'Texas' : 'Ohio State' },
    market: NO('No price on file for this player yet.'),
    ownership: NO('Only 3 leagues imported — too few for an ownership rate to mean anything yet.'),
    schedule: NO('No fixtures on file for his team.'),
    byeWeek: null,
    trades: NO('No trades involving this player in leagues AllFantasy has imported.'),
    comps: NO('No price for this player, so there is nothing to compare against.'),
    news: NO('No recent item mentions this player.'),
    injury: NO('No injury designation reported in the last 14 days.'),
    injuryFeed: NO('No record of when this sport was last checked.'),
    insight: null,
    league: {
      leagueId: 'e2e-dynasty-core-myteam',
      leagueName: 'The Deep!',
      platform: 'sleeper',
      slot: 'BENCH',
      isYours: true,
      owner: { teamName: 'Ciege Squad', ownerName: 'ciege' },
      price: NO('not priced'),
      yourRoster: [],
      trades: [],
      playoffSchedule: NO('no playoff start week on file'),
      watched: false,
      ...(opts.prospect ? { devy: true as const } : {}),
    },
    ...(opts.markers && marker ? { dynastyMarker: marker } : {}),
  } as PlayerCardData
}

/* ── Waivers: the "Worth adding" board ───────────────────────────────────── */

const WIRE: Array<[string, string, string, string, number, number, number, number]> = [
  // sleeperId, name, pos, team, proj, gain, age, yearsExp
  ['fx-w1', 'Jaxon Smith-Njigba Jr.', 'WR', 'SEA', 14.2, 5.8, 23, 2],
  ['fx-w2', 'Bucky Irving', 'RB', 'TB', 12.6, 4.1, 22, 0],
  ['fx-w3', 'Tyler Lockett', 'WR', 'TEN', 9.8, 2.7, 33, 11],
  ['fx-w4', 'Zach Ertz', 'TE', 'WAS', 8.9, 1.9, 35, 13],
  ['fx-w5', 'Jaylen Warren', 'RB', 'PIT', 9.1, 1.2, 26, 4],
]

export function waiverBoardFixture(opts: { markers: boolean }): WaiverBoard {
  const candidates = WIRE.map(([sleeperId, name, position, team, projectedPoints, gain]) => ({
    sleeperId,
    name,
    position,
    team,
    projectedPoints,
    gain,
    displaces: null,
    basis: 'projection' as const,
  }))
  const rows: MarkerRow[] = WIRE.map(([sleeperId, name, position, , , , age, yearsExp]) => ({ sleeperId, name, position, age, yearsExp }))
  return {
    state: 'ok',
    season: '2026',
    week: 10,
    currentLineupPoints: 118.4,
    candidates,
    notes: [],
    ...(opts.markers ? { dynastyMarkers: buildDynastyRosterMarkers(candidates, rows, 'NFL') } : {}),
  }
}

/* ── Player Finder results ───────────────────────────────────────────────── */

const FINDS: Array<[string | null, string, string, string, string, number, number | null]> = [
  // sleeperId, externalId, name, pos, team/sport, age, yearsExp
  ['fx-f1', 'x1', 'Jaxon Smith-Njigba Jr.', 'WR', 'SEA', 23, 2],
  ['fx-f2', 'x2', 'DeVonta Smith', 'WR', 'PHI', 27, 5],
  ['fx-f3', 'x3', 'Geno Smith', 'QB', 'LV', 36, 12],
  ['fx-f4', 'x4', 'Tyler Smith Rookie', 'TE', 'NYG', 22, 0],
  [null, 'c77', 'Jeremiah Smith', 'WR', 'OSU', 20, null],
]

export function finderFixture(opts: { markers: boolean }): { query: string; matches: PlayerMatch[]; markers: ReturnType<typeof buildDynastyRosterMarkers> | null } {
  const matches = FINDS.map(([sleeperId, externalId, name, position, team]) => ({
    externalId,
    sleeperId,
    name,
    position,
    team,
    imageUrl: null,
    number: null,
    rosteredIn: null,
    platforms: [],
    sport: sleeperId ? 'NFL' : 'NCAAF',
    source: null,
  })) as PlayerMatch[]
  const rows: MarkerRow[] = FINDS.map(([sleeperId, externalId, name, position, , age, yearsExp]) => ({
    sleeperId: markerKeyFor({ sleeperId, sport: sleeperId ? 'NFL' : 'NCAAF', externalId }),
    name,
    position,
    age,
    yearsExp,
  }))
  const players = matches.map((m) => ({ sleeperId: markerKeyFor(m), name: m.name, position: m.position }))
  // A devy league: the NCAAF match is a prospect (lib/core-app/dynastyMarkerRead.ts `readFinderDynastyMarkers`).
  const markers = opts.markers ? buildDynastyRosterMarkers(players, rows, 'NFL', { prospectIds: new Set(['NCAAF:c77']) }) : null
  return { query: 'smith', matches, markers }
}

/* ── Devy / C2C: My Team with two college prospects in the devy section ── */

const PROSPECTS: Array<[string, string, string, number]> = [
  ['fx-devy-0', 'Arch Manning', 'QB', 20],
  ['fx-devy-1', 'Jeremiah Smith', 'WR', 19],
]

export function devyMyTeamFixture(opts: { markers: boolean }): MyTeamData {
  const base = dynastyMyTeamFixture({ markers: opts.markers })
  const bench = base.bench.available ? base.bench.data : []
  const devyPlayers: LineupPlayer[] = PROSPECTS.map(([sleeperId, name, position], k) => ({
    ...(bench[k] as LineupPlayer),
    sleeperId,
    name,
    position,
    team: k === 0 ? 'TEX' : 'OSU',
    gameContext: null,
    projectedPoints: null,
  }))
  const all = [...bench, ...devyPlayers]
  const rows: MarkerRow[] = PROSPECTS.map(([sleeperId, name, position, age]) => ({ sleeperId, name, position, age, yearsExp: null }))
  const devyMarkers = buildDynastyRosterMarkers(devyPlayers, rows, 'NFL', { prospectIds: new Set(PROSPECTS.map((p) => p[0])) })
  return {
    ...base,
    league: { ...base.league, id: 'e2e-dynasty-core-devy', name: 'Campus to Canton', format: 'c2c' },
    bench: { available: true, data: all },
    dynastyMarkers: opts.markers ? { ...(base.dynastyMarkers ?? {}), ...devyMarkers } : null,
  } as MyTeamData
}
