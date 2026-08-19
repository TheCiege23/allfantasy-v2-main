import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The resolver is a server component that redirects, so it cannot be rendered in a unit
 * test. What CAN be pinned is the pair of properties that would each fail silently:
 *
 *   1. The league query must select `platform` and `platformLeagueId`. Without them the
 *      Sleeper branch reads undefined, takes the false path, and the board stays empty
 *      forever with no error anywhere. This exact omission was present when the branch
 *      was first written.
 *
 *   2. `autoMaterializeDraftForLeague` must NOT run for a mirrored draft. It fills empty
 *      slots with AI-managed orphan rosters, which is right for a draft we run and wrong
 *      for one Sleeper runs — those slots belong to real people who simply have no Roster
 *      row here yet. Inventing AI teams inside somebody's real league is not a failure any
 *      type checker catches.
 */
const SRC = readFileSync(resolve(process.cwd(), 'app/league/[leagueId]/draft/page.tsx'), 'utf8')

describe('league draft resolver: the Sleeper-hosted path', () => {
  it('selects the fields the Sleeper branch depends on', () => {
    // Narrow the search to the league query so an unrelated mention cannot satisfy this.
    const start = SRC.indexOf('prisma.league.findFirst')
    const query = SRC.slice(start, SRC.indexOf('})', start))
    expect(query).toContain('platform: true')
    expect(query).toContain('platformLeagueId: true')
  })

  it('falls back to Sleeper when settings carry no draft id', () => {
    expect(SRC).toContain('fetchDraftIdForLeague')
    // Guarded on the platform, so a manual league never triggers a provider call.
    expect(SRC).toMatch(/sleeperHosted[\s\S]{0,200}fetchDraftIdForLeague/)
  })

  it('does not let a failed lookup break the page', () => {
    // The CALL, not the import — searching for the bare name finds the import first and
    // proves nothing about the call site.
    const idx = SRC.indexOf('fetchDraftIdForLeague(')
    expect(idx).toBeGreaterThan(-1)
    expect(SRC.slice(idx, idx + 400)).toContain('.catch(')
  })

  it('skips slot materialization for a mirrored draft', () => {
    expect(SRC).toContain('!mirrorsSleeperDraft')
    const idx = SRC.indexOf('autoMaterializeDraftForLeague(leagueId)')
    const guard = SRC.slice(Math.max(0, idx - 400), idx)
    expect(guard).toContain('mirrorsSleeperDraft')
  })

  it('treats a league as mirrored only when it is Sleeper AND a draft id resolved', () => {
    expect(SRC).toContain('sleeperHosted && Boolean(sleeperDraftId)')
  })

  it('persists the resolved id so the lookup is once per league, not once per visit', () => {
    const idx = SRC.indexOf('prisma.draftSession.update')
    expect(SRC.slice(idx, idx + 600)).toContain('sleeperDraftId')
  })
})
