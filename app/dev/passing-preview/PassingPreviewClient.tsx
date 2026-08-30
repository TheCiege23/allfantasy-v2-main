'use client'

import { DevyPassingProfileCard, type PassingProfile } from '@/components/devy/DevyPassingProfileCard'

/**
 * Synthetic fixtures chosen to exercise the states that matter, not to look good.
 *
 * ⚠ THE FIRST ONE IS THE REAL MEASUREMENT. Gunner Stockton, Georgia 2025: 385 attempts and
 * `airYardsAttemptsAvailable` 153, observed against `/passing/players/season` on 2026-08-30.
 * His ADOT of 7.2 covers 40% of his throws, and `totalAirYards / attempts` would give 2.88 —
 * a 2.5x deflation that still reads as a plausible ADOT. If the coverage line under ADOT ever
 * stops rendering, this row is where it shows.
 */
const FIXTURES: PassingProfile[] = [
  {
    name: 'Gunner Stockton',
    school: 'GEORGIA',
    position: 'QB',
    season: 2025,
    attempts: 385,
    completions: 251,
    airYards: 1101.6,
    adot: 7.2,
    airYardsAttempts: 153,
    yardsAfterCatch: 1372,
    yacCompletions: 208,
    teamPassAdot: 8.1,
    teamPassYacPerComp: 6.2,
    locations: {
      season: 2025,
      attempts: 385,
      located: 214,
      grid: {
        short: {
          left: { attempts: 61, completions: 47, completionsMeasured: 61, yards: 402, yardsMeasured: 61, touchdowns: 3, touchdownsMeasured: 61, interceptions: 0, interceptionsMeasured: 61 },
          middle: { attempts: 48, completions: 39, completionsMeasured: 48, yards: 371, yardsMeasured: 48, touchdowns: 4, touchdownsMeasured: 48, interceptions: 1, interceptionsMeasured: 48 },
          right: { attempts: 55, completions: 41, completionsMeasured: 55, yards: 358, yardsMeasured: 55, touchdowns: 2, touchdownsMeasured: 55, interceptions: 1, interceptionsMeasured: 55 },
        },
        deep: {
          left: { attempts: 26, completions: 11, completionsMeasured: 26, yards: 341, yardsMeasured: 26, touchdowns: 3, touchdownsMeasured: 26, interceptions: 2, interceptionsMeasured: 26 },
          right: { attempts: 24, completions: 9, completionsMeasured: 24, yards: 288, yardsMeasured: 24, touchdowns: 2, touchdownsMeasured: 24, interceptions: 1, interceptionsMeasured: 24 },
        },
      },
    },
  },
  {
    /* Thin coverage: the amber path on both the stats and the grid header. */
    name: 'Thin Sample',
    school: 'ALABAMA',
    position: 'QB',
    season: 2025,
    attempts: 402,
    completions: 260,
    airYards: 288,
    adot: 8.0,
    airYardsAttempts: 36,
    yardsAfterCatch: 190,
    yacCompletions: 31,
    teamPassAdot: 7.4,
    teamPassYacPerComp: 5.9,
    locations: {
      season: 2025,
      attempts: 402,
      located: 41,
      grid: {
        short: {
          middle: { attempts: 22, completions: 18, completionsMeasured: 22, yards: 141, yardsMeasured: 22, touchdowns: 1, touchdownsMeasured: 22, interceptions: 0, interceptionsMeasured: 22 },
        },
        deep: {
          left: { attempts: 19, completions: 6, completionsMeasured: 19, yards: 203, yardsMeasured: 19, touchdowns: 1, touchdownsMeasured: 19, interceptions: 2, interceptionsMeasured: 19 },
        },
      },
    },
  },
  {
    /* Attempts recorded, none tagged — must read "not recorded", never six empty boxes. */
    name: 'Untagged Plays',
    school: 'OHIO STATE',
    position: 'QB',
    season: 2025,
    attempts: 298,
    completions: 195,
    airYards: null,
    adot: null,
    airYardsAttempts: null,
    yardsAfterCatch: null,
    yacCompletions: null,
    teamPassAdot: 7.9,
    teamPassYacPerComp: 6.0,
    locations: { season: 2025, attempts: 298, located: 0, grid: {} },
  },
  {
    /* School not yet swept by the rotating plays fold — distinct from "no location". */
    name: 'Not Yet Swept',
    school: 'OREGON',
    position: 'QB',
    season: 2025,
    attempts: 341,
    completions: 224,
    airYards: 2317,
    adot: 9.4,
    airYardsAttempts: 246,
    yardsAfterCatch: 1544,
    yacCompletions: 201,
    teamPassAdot: 8.8,
    teamPassYacPerComp: 6.8,
    locations: null,
  },
]

export function PassingPreviewClient() {
  return (
    <main className="mx-auto max-w-4xl space-y-6 bg-slate-950 p-6">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-white">CFBD passing profile</h1>
        <p className="text-sm text-white/60">
          Air yards, ADOT, YAC and the short/deep × left/middle/right grid, from the five passing
          endpoints CollegeFootballData published 2026-08-30. Every figure renders the sample it was
          computed over — coverage is partial and an uncaveated ADOT is a different claim, not a
          rounder one.
        </p>
      </header>

      <div className="space-y-4">
        {FIXTURES.map((p) => (
          <DevyPassingProfileCard key={p.name} profile={p} />
        ))}
      </div>

      <footer className="border-t border-white/10 pt-4 text-xs text-white/40">
        Four states, in order: real measured coverage (40%), thin coverage (9% — amber), attempts
        recorded with no location tagged, and a school the rotating plays fold has not reached yet.
        The last two look identical in a naive render and mean different things.
      </footer>
    </main>
  )
}
