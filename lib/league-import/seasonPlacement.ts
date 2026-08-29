/**
 * Who won a season is a FACT ABOUT A FINISHED SEASON. It is not "whoever is top of
 * the table right now", and the two must never be written to the same column.
 *
 * WHAT WENT WRONG. Both the import-time writer (ImportedLeagueCommitService) and the
 * daily Sleeper sync (applySleeperLeagueSync) built a LeagueSeason row by sorting
 * current standings and crowning rank 1:
 *
 *     championName: nameForTeamId(topStanding?.source_team_id)
 *
 * unconditionally, in BOTH the create and the update branch. Measured in production
 * on 2026-08-28, one day before the college season and thirteen days before the NFL
 * one: all 73 `league_seasons` rows were season 2026, and all 73 carried BOTH a
 * champion and a runner-up — for a season with zero games played
 * (`select sum(wins+losses) from season_results where season = 2026` → 0). Not one
 * league in the table had status `complete`; the distribution was in_season 60,
 * null 29, setup 13, pre_draft 8, drafting 5.
 *
 * So every imported league was showing its members a champion who had won nothing,
 * on the History tab, with a trophy — and the value was also being fed into AI
 * prompts as established fact.
 *
 * ⚠ IT REGENERATED DAILY, WHICH IS WHY A BACKFILL ALONE COULD NOT FIX IT. The sync's
 * `update` branch rewrote championName on every run, so any repair would have been
 * undone by the next cron tick. That same property is what makes this fix
 * self-healing: because the update branch always writes the field, gating it to
 * `null` means the next sync CLEARS all 73 fabricated rows with no migration and no
 * manual backfill.
 *
 * WHAT IS DELIBERATELY NOT CHANGED. `app/api/commissioner/leagues/[leagueId]/renew`
 * also writes a champion, and it is correct to: it is an explicit commissioner action
 * that closes out a season, and it sets `status: 'complete'` in the same write. A
 * commissioner rolling their league into next year IS the completion signal. Leave it.
 */

/**
 * Sleeper's `status` vocabulary is `pre_draft` | `drafting` | `in_season` |
 * `complete`. Only the last means the season is over. `complete` is the spelling
 * Sleeper uses; `completed` is accepted because other importers normalise to it and
 * a placement that silently depends on a suffix is the kind of thing that rots.
 */
const COMPLETE_LEAGUE_STATUSES = new Set(['complete', 'completed'])

/** True only when the source platform says this season has actually finished. */
export function seasonIsComplete(leagueStatus: string | null | undefined): boolean {
  return COMPLETE_LEAGUE_STATUSES.has(String(leagueStatus ?? '').trim().toLowerCase())
}

export interface SeasonPlacementInput {
  /** The league's status as reported by the source platform. */
  leagueStatus: string | null | undefined
  /** Rank-1 team's display name, as the caller derived it from current standings. */
  championName: string | null
  /** Rank-2 team's display name. */
  runnerUpName: string | null
}

export interface SeasonPlacement {
  championName: string | null
  runnerUpName: string | null
}

/**
 * Resolve the placement fields to write for a season row.
 *
 * Returns explicit `null`s rather than omitting the keys, and callers must spread the
 * result into BOTH the create and the update branch of their upsert. Omitting the
 * keys on update would leave a previously-fabricated champion in place forever —
 * writing null is what heals the rows already in the table.
 */
export function resolveSeasonPlacement(input: SeasonPlacementInput): SeasonPlacement {
  if (seasonIsComplete(input.leagueStatus)) {
    return {
      championName: input.championName,
      runnerUpName: input.runnerUpName,
    }
  }
  return { championName: null, runnerUpName: null }
}
