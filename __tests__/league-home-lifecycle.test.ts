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
  it('shows the pre-season phases instead of hiding the timeline entirely', () => {
    /*
     * ⚠ THIS TEST USED TO ASSERT THE OPPOSITE, and the old behaviour was the
     * weaker half of a real point. Withholding the timeline did stop the page
     * pointing at a week the league had not reached — but it also hid the
     * timeline at exactly the moment a manager most wants it, when the draft
     * and the preseason are the only things ahead of them.
     *
     * The guarantee that actually mattered is kept and strengthened: the
     * timeline no longer INVENTS anything. `buildSeasonTimeline` reads the
     * league's own settings, omits any phase whose setting is absent, and no
     * longer falls back to a hardcoded playoff week 15.
     */
    expect(SRC).toContain('buildSeasonTimeline')
    // The fabricated calendar is gone.
    expect(SRC).not.toContain('playoffStart ?? 15')
    expect(SRC).not.toContain('the season timeline starts once this league drafts')
  })

  it('explains empty standings by the calendar, not by ingestion', () => {
    expect(SRC).toContain('no standings until the season starts')
    // The in-season wording must survive for leagues that HAVE played.
    expect(SRC).toContain('every record is 0-0')
  })

  it('says there are no matchups yet rather than none ingested', () => {
    // Asserts the WORDING, not the expression shape: the matchup section was
    // later lifted into `resolvedMatchup`, which is the same behaviour written
    // differently, and a scan pinned to `matchup: preSeason` failed on a
    // refactor that changed nothing a user can see.
    expect(SRC).toContain('no matchups yet')
    // The preseason branch is what produces that wording.
    expect(SRC).toContain("preSeason")
    expect(SRC).toMatch(/reason: 'no matchups yet/)
  })

  it('says activity starts after the draft rather than blaming the platform', () => {
    expect(SRC).toContain('trades and waivers start after the draft')
    /*
     * And the in-season branch must no longer claim the platform's
     * transactions are unread. They ARE read — the trade-grade sweep resolves
     * both sides of every trade every 30 minutes — and `buzz` now renders
     * them. The only honest remaining gap is narrower.
     */
    expect(SRC).not.toMatch(/reason: 'league transactions are not ingested for this platform yet'/)
    expect(SRC).toContain('waivers and roster moves are not read')
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

/**
 * Both panels shipped as permanent blanks. Draft HQ told leagues with full rosters
 * on the same screen that "no draft has been set up for this league", and the
 * Commissioner Hub carried a reason claiming commissioner tasks are not ingested
 * for imported leagues — while league health and manager activity were sitting
 * there, working, read by nothing.
 */
describe('league home: Draft HQ says which draft, and stops calling a finished one absent', () => {
  it('names the season, because "Draft complete" says nothing on a dynasty league', () => {
    expect(SRC).toContain('draft has ended')
    expect(SRC).toContain('${league.season ?? \'\'}')
  })

  it('⚠ populated rosters are evidence a draft happened, even with no draft row', () => {
    /*
     * The old else-branch was a false statement about the LEAGUE rather than a
     * true one about our data — the same failure the buzz panel had. A league
     * whose rosters we are rendering has obviously drafted.
     */
    expect(SRC).toContain('const draftedAlready = rosterCountForDraft > 0')
    expect(SRC).not.toContain("reason: 'no draft has been set up for this league'")
    expect(SRC).toContain('we did not capture the board itself')
  })

  it('offers a link only when there is something behind it', () => {
    expect(SRC).toContain('href: string | null')
    expect(SRC).toContain('linkLabel: string | null')
    // The no-board branch must not fabricate a destination.
    const branch = SRC.slice(SRC.indexOf('const draftedAlready'), SRC.length)
    expect(branch).toContain('href: null')
  })
})

describe('league home: the Commissioner Hub is gated on the flags that include co-commissioners', () => {
  it('⚠ reads BOTH team flags, not League.userId', () => {
    /*
     * `lib/commissioner/permissions.ts` gates on `League.userId` alone, which
     * 403s every co-commissioner — exactly the people this panel exists for.
     * On an imported league `League.userId` is whoever ran the import, who is
     * frequently not the commissioner at all.
     */
    expect(SRC).toContain('yours?.isCommissioner || yours?.isCoCommissioner')
    expect(SRC).not.toContain("from '@/lib/commissioner/permissions'")
  })

  it('selects both flags — without them the gate reads undefined and hides the panel from everyone', () => {
    const start = SRC.indexOf('prisma.leagueTeam.findMany')
    const query = SRC.slice(start, SRC.indexOf('})', start))
    expect(query).toContain('isCommissioner: true')
    expect(query).toContain('isCoCommissioner: true')
  })

  it('does not read manager health for non-commissioners', () => {
    // Gating the render but not the READ would leak who is inactive to anyone
    // who opened devtools, and pay for the query on every page load.
    expect(SRC).toContain('viewerIsCommissioner\n    ? await getLeagueManagerHealth')
  })

  it('names inactive managers rather than only counting them', () => {
    expect(SRC).toContain('inactiveNames')
    expect(SRC).toContain(".filter((r) => r.status === 'inactive')")
  })

  it('withholds the panel when no managers were read, instead of reporting zero inactive', () => {
    // Zero inactive out of zero managers is a clean bill of health for a league
    // we know nothing about — the exact shape of the "C grade means no data" bug.
    expect(SRC).toContain('managerHealth && managerHealth.totalManagers > 0')
    expect(SRC).toContain('there is nothing to report on')
  })
})
