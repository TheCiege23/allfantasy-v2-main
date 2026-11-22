/**
 * HARNESS FIXTURES ONLY (app/e2e is 404 in production). A fictional league per sport, shaped like the
 * real props and route responses the League Settings page reads, so LeagueSettingsHome /
 * CommissionerCenter render through their own code paths with no database. Nothing here is imported by
 * product code. Values are per sport so a capture shows seven real configurations, not seven NFLs.
 */
export type HarnessSport = 'NFL' | 'NBA' | 'NHL' | 'MLB' | 'NCAAF' | 'NCAAB' | 'SOCCER'

type SportCfg = {
  week: number
  totalWeeks: number
  playoffStart: number
  deadline: number | null
  waiverType: 'faab' | 'rolling'
  rounds: number
  timerSeconds: number
  slots: Record<string, number>
}

export const SPORTS: Record<HarnessSport, SportCfg> = {
  NFL: { week: 9, totalWeeks: 17, playoffStart: 15, deadline: 12, waiverType: 'faab', rounds: 15, timerSeconds: 90, slots: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DEF: 1, BN: 6, IR: 1 } },
  NCAAF: { week: 6, totalWeeks: 15, playoffStart: 13, deadline: 9, waiverType: 'faab', rounds: 15, timerSeconds: 90, slots: { QB: 1, RB: 2, WR: 3, TE: 1, FLEX: 1, K: 1, BN: 5 } },
  NBA: { week: 4, totalWeeks: 21, playoffStart: 19, deadline: 16, waiverType: 'faab', rounds: 13, timerSeconds: 60, slots: { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 1, UTIL: 2, BN: 3, IL: 1 } },
  NCAAB: { week: 8, totalWeeks: 18, playoffStart: 16, deadline: 12, waiverType: 'rolling', rounds: 10, timerSeconds: 60, slots: { G: 2, F: 2, C: 1, UTIL: 1, BN: 3 } },
  NHL: { week: 5, totalWeeks: 22, playoffStart: 20, deadline: 17, waiverType: 'faab', rounds: 16, timerSeconds: 60, slots: { C: 2, LW: 2, RW: 2, D: 3, G: 2, BN: 3, IR: 1 } },
  MLB: { week: 7, totalWeeks: 26, playoffStart: 24, deadline: null, waiverType: 'faab', rounds: 23, timerSeconds: 60, slots: { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, OF: 3, UTIL: 1, SP: 2, RP: 2, BN: 3, IL: 2 } },
  SOCCER: { week: 11, totalWeeks: 38, playoffStart: 35, deadline: 26, waiverType: 'rolling', rounds: 15, timerSeconds: 60, slots: { GKP: 1, DEF: 4, MID: 4, FWD: 2, BN: 4 } },
}

export const MANAGERS = ['Gridiron Ghosts', 'Second Half Surge', 'Bench Mob', 'Late Round Legends', 'Trade Deadline Thieves', 'Sunday Scaries', 'The Comeback Kids', 'Fourth & Forever', 'Bye Week Blues', 'Commissioner’s Pick', 'Draft Day Darlings', 'Last Pick Heroes']

/** GET /api/commissioner/leagues/:id/roster-settings */
export function rosterSettingsResponse(sport: HarnessSport) {
  return { config: { slots: SPORTS[sport].slots } }
}

/** GET /api/leagues/:id/draft/settings — the draft already ran (the league is in season). */
export function draftSettingsResponse(sport: HarnessSport) {
  const cfg = SPORTS[sport]
  return {
    draftDate: '2026-09-02T00:00:00.000Z',
    autostartEnabled: true,
    computedRounds: cfg.rounds,
    hasAfCommissionerSub: false,
    config: { draft_type: 'snake', rounds: cfg.rounds, timer_seconds: cfg.timerSeconds },
  }
}
