export const afcTeams = {
  2: 'Cleveland Browns',
  4: 'Kansas City Chiefs',
  5: 'Baltimore Ravens',
  6: 'Jacksonville Jaguars',
  7: 'Cincinnati Bengals',
  8: 'Tennessee Titans',
  9: 'New York Jets',
  11: 'Buffalo Bills',
  12: 'Indianapolis Colts',
  15: 'Los Angeles Chargers',
  17: 'Pittsburgh Steelers',
  18: 'Miami Dolphins',
  23: 'Houston Texans',
  24: 'New England Patriots',
  27: 'Houston Oilers',
  33: 'Denver Broncos',
  34: 'Las Vegas Raiders',
} as const

export type AfcSeed = keyof typeof afcTeams
export type AfcPairing = { away: AfcSeed; home: AfcSeed }
export type AfcScore = { week: number; seed: AfcSeed; points: number; final: boolean }
export type AfcOverrides = Partial<Record<number, AfcPairing[]>>
type Slot = AfcSeed | string

// Strings point to a game in the previous round, such as "2.3".
const plan: readonly (readonly (readonly [Slot, Slot])[])[] = [
  [[34, 33]],
  [['1.1', 4], [27, 2], [23, 5], [17, 6], [18, 9], [24, 7], [15, 8], [12, 11]],
  [['2.1', '2.3'], ['2.8', '2.2'], ['2.7', '2.6'], ['2.5', '2.4']],
  [['3.1', '3.2'], ['3.3', '3.4']],
  [['4.1', '4.2']],
]

export function isAfcSeed(value: number): value is AfcSeed {
  return Object.hasOwn(afcTeams, value)
}

export function afcRosterId(seed: AfcSeed) {
  return `a21afc00-1aa4-4040-a001-${String(seed).padStart(12, '0')}`
}

export type AfcGame = {
  id: string
  away: AfcSeed | null
  home: AfcSeed | null
  awayPoints: number | null
  homePoints: number | null
  winner: AfcSeed | null
  status: 'pending' | 'scheduled' | 'scoring' | 'tied' | 'final'
}

export function validAfcPairings(defaults: readonly (readonly [AfcSeed | null, AfcSeed | null])[], pairings: readonly AfcPairing[]) {
  const expected = defaults.flat()
  const supplied = pairings.flatMap(({ away, home }) => [away, home])
  return supplied.length === expected.length && new Set(supplied).size === supplied.length &&
    supplied.every(seed => expected.includes(seed))
}

export function resolveAfcChampionships(scores: readonly AfcScore[], overrides: AfcOverrides = {}) {
  const byTeamWeek = new Map(scores.filter(score => Number.isFinite(score.points)).map(score => [`${score.week}:${score.seed}`, score]))
  const winners = new Map<string, AfcSeed>()
  const resolve = (slot: Slot) => typeof slot === 'number' ? slot : winners.get(slot) ?? null
  return plan.map((round, index) => {
    const number = index + 1
    const week = 9 + index
    const defaults = round.map(([away, home]) => [resolve(away), resolve(home)] as const)
    const override = overrides[number]
    const overridden = Boolean(override && validAfcPairings(defaults, override))
    const games = defaults.map(([defaultAway, defaultHome], slot): AfcGame => {
      const id = `${number}.${slot + 1}`
      const away = overridden && override ? override[slot].away : defaultAway
      const home = overridden && override ? override[slot].home : defaultHome
      const awayScore = byTeamWeek.get(`${week}:${away}`)
      const homeScore = byTeamWeek.get(`${week}:${home}`)
      const ready = away != null && home != null
      const final = ready && awayScore?.final && homeScore?.final
      const winner = final && awayScore.points !== homeScore.points
        ? (awayScore.points > homeScore.points ? away : home) : null
      if (winner != null) winners.set(id, winner)
      return {
        id, away, home, winner,
        awayPoints: ready ? awayScore?.points ?? null : null,
        homePoints: ready ? homeScore?.points ?? null : null,
        status: !ready ? 'pending' : final ? (winner == null ? 'tied' : 'final')
          : awayScore || homeScore ? 'scoring' : 'scheduled',
      }
    })
    return {
      number, week, games, defaults, overridden, overrideNeedsReview: Boolean(override && !overridden),
      canOverride: games.every(game => game.status === 'scheduled'),
    }
  })
}

export const afcStatus = {
  pending: 'Awaiting advancement',
  scheduled: 'Scheduled',
  scoring: 'In progress',
  tied: 'Tie · review',
  final: 'Final',
} satisfies Record<AfcGame['status'], string>

export type AfcRound = ReturnType<typeof resolveAfcChampionships>[number]
