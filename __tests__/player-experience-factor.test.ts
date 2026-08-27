/**
 * Experience was never missing from the feed, only from the write.
 *
 * Sleeper sends `years_exp` and `SleeperPlayerSeedService` has always parsed it
 * into its `SeededPlayer` type — there was no column on `SportsPlayer`, so it
 * was dropped at the `createMany`. The value ledger recorded that honestly:
 * "experience / rookie year" sat at 🛑 with the reason named in `trajectory.ts`
 * rather than guessed at.
 *
 * The whole factor turns on one distinction: 0 is a rookie, null is unknown.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { experienceNote, EXPERIENCE_GAP } from '@/lib/trade-intel/trajectory'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8').replace(/\r\n/g, '\n')

const TRAJECTORY = read('lib/trade-intel/trajectory.ts')
const SEED = read('lib/sleeper/SleeperPlayerSeedService.ts')
const SCHEMA = read('prisma/schema.prisma')
const MIGRATION = read('prisma/migrations/20260826140000_sports_player_years_exp/migration.sql')
const NOTES = read('lib/trade-intel/tradeContextNotes.ts')
const LEDGER = read('lib/trade-intel/LEDGER-FACTORS.md')

describe('⚠ 0 is a rookie and null is unknown', () => {
  it('speaks for a player with no NFL snaps', () => {
    const note = experienceNote('Travis Hunter', { yearsExp: 0, rookie: true })
    expect(note).toContain('Travis Hunter')
    expect(note).toContain('projection of what he might become')
  })

  it('says nothing at all when experience is unknown', () => {
    /*
     * Reading null as 0 would label every player we failed to match a rookie —
     * the most confident possible wrong answer about the class of asset dynasty
     * managers pay the biggest premium for.
     */
    expect(experienceNote('Nobody We Matched', null)).toBeNull()
  })

  it('says nothing for a veteran, because it changes nothing a manager would do', () => {
    // A panel that lists every non-finding is one people stop reading — the same
    // rule the depth-role and leverage notes follow.
    expect(experienceNote('Josh Allen', { yearsExp: 7, rookie: false })).toBeNull()
    expect(experienceNote('Second Year Guy', { yearsExp: 1, rookie: false })).toBeNull()
  })

  it('keeps a gap constant for the case that is still a gap', () => {
    // A player with no row, or a row the seed has not refreshed.
    expect(EXPERIENCE_GAP).toContain('not on file')
  })
})

describe('⚠ the column, the write, and the migration all agree', () => {
  it('stores it nullable, with no default', () => {
    // A default of 0 makes "rookie" and "unknown" indistinguishable in exactly
    // the direction that does damage.
    expect(SCHEMA).toContain('yearsExp   Int?')
    const alter = MIGRATION.split('\n').find((l) => l.trim().startsWith('ALTER TABLE'))
    expect(alter).toBe('ALTER TABLE "SportsPlayer" ADD COLUMN IF NOT EXISTS "yearsExp" INTEGER;')
    /* Asserted on the statement, not the file — the comment above it explains
       precisely why there is no default, so the word appears in the prose. */
    expect(alter).not.toContain('DEFAULT')
  })

  it('is replayable, because production got it by hand first', () => {
    expect(MIGRATION).toContain('IF NOT EXISTS')
  })

  it('the seed finally passes through what it has always parsed', () => {
    expect(SEED).toContain('yearsExp: player.yearsExp')
    // Still parsed the same way — toFiniteNumber returns null for a missing field.
    expect(SEED).toContain('yearsExp: toFiniteNumber(player.years_exp)')
  })
})

describe('⚠ two sources disagreeing is a reason to say nothing', () => {
  it('resolves ambiguity on the value rather than the row count', () => {
    /*
     * SportsPlayer is unique on (sport, externalId, source), so one player
     * legitimately appears once per source. What matters is whether those rows
     * AGREE — averaging two different answers would invent a third.
     */
    expect(TRAJECTORY).toContain('if (values.size !== 1) continue')
    expect(TRAJECTORY).toContain('AMBIGUITY IS RESOLVED ON THE VALUE, NOT THE ROW COUNT')
  })

  it('leaves a name absent when its only rows carry null', () => {
    expect(TRAJECTORY).toContain('unknown, not zero')
  })
})

describe('⚠ wired, and reporting rather than repricing', () => {
  it('is reachable from the notes aggregator', () => {
    // This repo has a documented history of built-and-never-called modules.
    expect(NOTES).toContain("import { experienceNote, loadExperience } from './trajectory'")
    expect(NOTES).toContain('experienceNote(g.name, experience.get(')
  })

  it('reads once for the whole side, not once per player', () => {
    expect(NOTES).toContain('names: get.map((g) => g.name)')
  })

  it('does not fold experience into any price', () => {
    /*
     * FantasyCalc's dynasty price already carries rookie hype. An adjustment on
     * top would double-count it, exactly as an age curve would — the trap this
     * layer was built to avoid.
     */
    expect(TRAJECTORY).toContain('IT REPORTS, IT DOES NOT REPRICE')
  })

  it('is ticked in the ledger with the blocker marked cleared', () => {
    expect(LEDGER).toContain('| Experience / rookie year | ✅ |')
    expect(LEDGER).toContain('~~Experience~~ **CLEARED.**')
  })
})
