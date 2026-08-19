import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveLeagueStage, isPreDraftOrDrafting } from '@/lib/league-stage/leagueStage'

/**
 * The screen this guards, measured on a real league:
 *
 *   $20 12 man tree keeper — status=drafting, lifecycleState=in_season,
 *   synced hours earlier, 12 teams all with avatars, 13 rosters, 0 games played.
 *
 * It rendered a season timeline reading "YOU ARE HERE · WEEK 2", standings saying
 * "every record is 0-0", and matchup/buzz saying "not ingested". Every message was
 * literally true. Together they said the pipeline was broken, when the league simply had
 * not drafted yet.
 *
 * `leagueHome` is a server-only module that reads Prisma, so these assert the two things
 * that would each silently revert: the stage is derived from the right field, and the
 * pre-season branch is actually consulted by every section that needs it.
 */
const SRC = readFileSync(resolve(process.cwd(), 'lib/core-app/leagueHome.ts'), 'utf8')

describe('league home: the stage comes from the field that tracks reality', () => {
  it('a drafting league with the in_season default resolves as drafting', () => {
    const league = { status: 'drafting', lifecycleState: 'in_season' }
    expect(resolveLeagueStage(league)).toBe('drafting')
    expect(isPreDraftOrDrafting(league)).toBe(true)
  })

  it('a genuinely in-season league is not treated as pre-season', () => {
    expect(isPreDraftOrDrafting({ status: 'in_season', lifecycleState: 'in_season' })).toBe(false)
  })

  it('selects status and lifecycleState — without them the branch reads undefined', () => {
    const start = SRC.indexOf('prisma.league.findUnique')
    const query = SRC.slice(start, SRC.indexOf('})', start))
    expect(query).toContain('status: true')
    expect(query).toContain('lifecycleState: true')
  })

  it('uses the shared rule rather than a fourth copy of it', () => {
    expect(SRC).toContain("from '@/lib/league-stage/leagueStage'")
    expect(SRC).toContain('resolveLeagueStage(league)')
    expect(SRC).toContain('isPreDraftOrDrafting(league)')
  })
})

describe('league home: a pre-season league is not a broken one', () => {
  it('withholds the timeline instead of pointing at a week the league has not reached', () => {
    expect(SRC).toMatch(/timeline: preSeason/)
    expect(SRC).toContain('the season timeline starts once this league drafts')
  })

  it('explains empty standings by the calendar, not by ingestion', () => {
    expect(SRC).toContain('no standings until the season starts')
    // The in-season wording must survive for leagues that HAVE played.
    expect(SRC).toContain('every record is 0-0')
  })

  it('says there are no matchups yet rather than none ingested', () => {
    expect(SRC).toMatch(/matchup: preSeason/)
    expect(SRC).toContain('no matchups yet')
  })

  it('says activity starts after the draft rather than blaming the platform', () => {
    expect(SRC).toMatch(/buzz: preSeason/)
    expect(SRC).toContain('trades and waivers start after the draft')
  })

  it('exposes the stage so the screen can compose, not just re-word', () => {
    expect(SRC).toContain('stage: string | null')
    expect(SRC).toContain('preSeason: boolean')
  })

  it('computes the stage before the sections that read it', () => {
    const decl = SRC.indexOf('const preSeason =')
    const firstUse = SRC.indexOf('preSeason\n', decl + 1)
    expect(decl).toBeGreaterThan(-1)
    // Every usage must come after the declaration — an earlier one would not compile,
    // and this is the mistake that had to be corrected while writing it.
    expect(SRC.indexOf('? preSeason')).toBeGreaterThan(decl)
    expect(firstUse === -1 || firstUse > decl).toBe(true)
  })
})
