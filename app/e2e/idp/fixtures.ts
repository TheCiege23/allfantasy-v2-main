/**
 * IDP salary-cap fixtures for the DB-free harness, typed against the app's own response types with
 * `satisfies`, so a fixture that drifts from the real shape fails the typecheck instead of rendering a
 * screen the app never could. They are dumped to JSON for the capture script. Harness-only.
 */
import type { IdpCapSummaryJson, IdpSalaryRecordJson } from '@/app/idp/hooks/useIdpTeamCap'

export const HARNESS_USER_ID = 'e2e-idp-user'
export const HARNESS_ROSTER_ID = 'ckidproster00001'

export const season = {
  season: {
    season: 2026,
    currentWeek: 10,
    rosters: [
      { id: HARNESS_ROSTER_ID, ownerId: HARNESS_USER_ID, teamName: 'Blitz Package' },
      { id: 'ckidproster00002', ownerId: 'u2', teamName: 'Pick Six Syndicate' },
    ],
  },
}

export const summary = {
  season: 2026,
  totalCap: 200,
  activeSalary: 171.4,
  deadMoney: 8.5,
  totalCapUsed: 179.9,
  availableCap: 20.1,
  capFloorRequired: 150,
  isCapCompliant: true,
  holdbackReserved: 5,
  effectiveSpendableCap: 15.1,
} satisfies IdpCapSummaryJson

const c = (
  id: string, playerName: string, position: string, isDefensive: boolean, salary: number, contractYears: number,
  yearsRemaining: number, extra: Partial<IdpSalaryRecordJson> = {},
): IdpSalaryRecordJson => ({
  id, leagueId: 'e2e-idp', rosterId: HARNESS_ROSTER_ID, playerId: `p-${id}`, playerName, position, isDefensive, salary,
  contractYears, yearsRemaining, contractStartYear: 2026 - (contractYears - yearsRemaining), status: 'active',
  acquisitionMethod: 'auction', isFranchiseTagged: false, cutPenaltyCurrent: Math.round(salary * 0.25 * 10) / 10, ...extra,
})

export const contracts = {
  contracts: [
    c('1', 'Jayden Daniels', 'QB', false, 34.5, 4, 3),
    c('2', 'Bijan Robinson', 'RB', false, 28, 3, 2, { isFranchiseTagged: true }),
    c('3', "Ja'Marr Chase", 'WR', false, 31.2, 5, 4),
    c('4', 'Micah Parsons', 'EDGE', true, 18.6, 4, 1, { extensionBoostPct: 12 }),
    c('5', 'Fred Warner', 'LB', true, 14.2, 3, 2),
    c('6', 'Kyle Hamilton', 'S', true, 12.8, 3, 3, { acquisitionMethod: 'waiver' }),
    c('7', 'Sauce Gardner', 'CB', true, 11.5, 2, 1),
    c('8', 'Aidan Hutchinson', 'EDGE', true, 10.4, 4, 4, { acquisitionMethod: 'trade' }),
    c('9', 'Roquan Smith', 'LB', true, 10.2, 2, 1),
  ] satisfies IdpSalaryRecordJson[],
}

export const projections = {
  projections: [2026, 2027, 2028, 2029].map((projectionYear, i) => ({
    projectionYear,
    committedSalary: [171.4, 148.2, 101.7, 46.3][i]!,
    deadCapHits: [8.5, 4.2, 0, 0][i]!,
    availableCap: [20.1, 47.6, 98.3, 153.7][i]!,
  })),
}

export const deadMoney = {
  deadMoney: [
    { playerName: 'Darius Leonard', position: 'LB', currentYearDead: 6.3, reason: 'Released with 2 years left', season: 2026 },
    { playerName: 'Jamal Adams', position: 'S', currentYearDead: 2.2, reason: 'Released with 1 year left', season: 2026 },
  ],
}

/** /api/league/settings — only `hasAfCommissionerSub` is read here; false shows the upgrade note. */
export const settings = { hasAfCommissionerSub: false }
