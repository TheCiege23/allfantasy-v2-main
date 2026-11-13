/**
 * Snake Draft Salary Scale Engine.
 *
 * Instead of auction bidding, salaries are auto-assigned based on draft position.
 * Mimics real rookie-scale contracts where pick 1 = highest salary, declining per pick.
 *
 * Commissioner can configure:
 * - Salary curve: flat, steep, exponential, linear
 * - Minimum salary floor
 * - Rookie-scale tiers by round
 * - Default contract length per round
 * - Total cap for scale calculation
 */

type SalaryCurveType = 'linear' | 'steep' | 'exponential' | 'flat' | 'custom'

export type SnakeSalaryScaleConfig = {
  /** Total salary cap */
  totalCap: number
  /** Number of teams in the league */
  teamCount: number
  /** Number of draft rounds */
  draftRounds: number
  /** Curve type */
  curveType: SalaryCurveType
  /** Minimum salary floor */
  minSalary: number
  /** Maximum salary for pick 1 */
  maxSalary: number
  /** Default contract years by round (e.g., { 1: 4, 2: 3, 3: 3, 4: 2, ... }) */
  contractYearsByRound: Record<number, number>
  /** Custom scale overrides (pick number → salary) */
  customScale?: Record<number, number>
}

function calculateSalary(
  overall: number,
  totalPicks: number,
  config: SnakeSalaryScaleConfig,
): number {
  const { minSalary, maxSalary, curveType } = config
  const range = maxSalary - minSalary
  const position = (overall - 1) / Math.max(1, totalPicks - 1) // 0 to 1

  switch (curveType) {
    case 'linear':
      return maxSalary - range * position

    case 'steep':
      // Top picks drop fast, later picks compress near minimum
      return minSalary + range * Math.pow(1 - position, 2)

    case 'exponential':
      // Aggressive curve: pick 1 is very expensive, rapid decline
      return minSalary + range * Math.pow(1 - position, 3)

    case 'flat':
      // All picks get similar salary (slight decline)
      return minSalary + range * 0.6 * (1 - position * 0.3)

    default:
      return maxSalary - range * position
  }
}

function getDefaultContractYears(round: number, totalRounds: number): number {
  if (round <= 2) return 4
  if (round <= 4) return 3
  if (round <= Math.ceil(totalRounds * 0.6)) return 2
  return 1
}

/**
 * Get salary for a specific draft pick.
 */
export function getSalaryForPick(
  overall: number,
  config: SnakeSalaryScaleConfig,
): { salary: number; contractYears: number } {
  const totalPicks = config.teamCount * config.draftRounds
  const round = Math.ceil(overall / config.teamCount)

  let salary: number
  if (config.customScale && config.customScale[overall] != null) {
    salary = config.customScale[overall]
  } else {
    salary = calculateSalary(overall, totalPicks, config)
  }
  salary = Math.max(config.minSalary, Math.round(salary * 100) / 100)

  const contractYears = config.contractYearsByRound[round] ?? getDefaultContractYears(round, config.draftRounds)

  return { salary, contractYears }
}

/**
 * Default salary scale configs by sport.
 */
export function getDefaultSnakeSalaryConfig(sport: string, teamCount: number, draftRounds: number): SnakeSalaryScaleConfig {
  const sportKey = sport.toLowerCase()

  const defaults: Record<string, { totalCap: number; maxSalary: number; minSalary: number; curve: SalaryCurveType }> = {
    nfl: { totalCap: 250, maxSalary: 45, minSalary: 1, curve: 'steep' },
    nba: { totalCap: 200, maxSalary: 40, minSalary: 1, curve: 'steep' },
    mlb: { totalCap: 300, maxSalary: 50, minSalary: 1, curve: 'linear' },
    nhl: { totalCap: 200, maxSalary: 35, minSalary: 1, curve: 'steep' },
    ncaaf: { totalCap: 200, maxSalary: 35, minSalary: 1, curve: 'linear' },
    ncaab: { totalCap: 150, maxSalary: 30, minSalary: 1, curve: 'linear' },
    soccer: { totalCap: 250, maxSalary: 45, minSalary: 1, curve: 'steep' },
  }

  const d = defaults[sportKey] ?? defaults.nfl

  return {
    totalCap: d.totalCap,
    teamCount,
    draftRounds,
    curveType: d.curve,
    minSalary: d.minSalary,
    maxSalary: d.maxSalary,
    contractYearsByRound: {
      1: 4,
      2: 3,
      3: 3,
      4: 2,
      5: 2,
    },
  }
}

