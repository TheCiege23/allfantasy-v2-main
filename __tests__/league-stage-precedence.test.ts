import { describe, it, expect } from 'vitest'
import { resolveLeagueStage, isPreDraftOrDrafting } from '@/lib/league-stage/leagueStage'
import { shouldUseMatchupInsteadOfDraft, applyMatchupPrimaryTab } from '@/lib/matchup-center/tabTransition'

describe('league stage: the platform’s word beats our unrun state machine', () => {
  it('prefers status over lifecycleState', () => {
    expect(resolveLeagueStage({ status: 'drafting', lifecycleState: 'in_season' })).toBe('drafting')
  })

  it('falls back to lifecycleState when status is absent', () => {
    expect(resolveLeagueStage({ status: null, lifecycleState: 'playoffs' })).toBe('playoffs')
  })

  it('is null when neither field says anything', () => {
    expect(resolveLeagueStage({ status: null, lifecycleState: null })).toBeNull()
    expect(resolveLeagueStage(null)).toBeNull()
  })

  it('normalises case and whitespace', () => {
    expect(resolveLeagueStage({ status: '  PRE_DRAFT ' })).toBe('pre_draft')
  })
})

describe('the draft tab must survive an imported league’s default lifecycleState', () => {
  /*
    The production shape this regression-tests: an imported league mid-draft.
    `status` says drafting; `lifecycleState` is the @default(in_season) our state
    machine never overwrote. 55 of 62 production leagues sat on that default.
  */
  const draftingImportedLeague = { status: 'drafting', lifecycleState: 'in_season' }
  const preDraftImportedLeague = { status: 'pre_draft', lifecycleState: 'in_season' }

  it('keeps Draft primary for a league that is drafting', () => {
    expect(shouldUseMatchupInsteadOfDraft(draftingImportedLeague)).toBe(false)
  })

  it('keeps Draft primary for a league that has not drafted yet', () => {
    expect(shouldUseMatchupInsteadOfDraft(preDraftImportedLeague)).toBe(false)
  })

  it('does NOT replace the Draft tab for a drafting league', () => {
    const tabs = [{ id: 'draft', label: 'Draft' }, { id: 'roster', label: 'Roster' }]
    const out = applyMatchupPrimaryTab(tabs, shouldUseMatchupInsteadOfDraft(draftingImportedLeague))
    expect(out.map((t) => t.id)).toEqual(['draft', 'roster'])
  })

  it('still shows Matchup once the league is genuinely in season', () => {
    const inSeason = { status: 'in_season', lifecycleState: 'in_season' }
    expect(shouldUseMatchupInsteadOfDraft(inSeason)).toBe(true)
    const tabs = [{ id: 'draft', label: 'Draft' }, { id: 'roster', label: 'Roster' }]
    const out = applyMatchupPrimaryTab(tabs, shouldUseMatchupInsteadOfDraft(inSeason))
    expect(out.map((t) => t.id)).toEqual(['matchup', 'roster'])
  })

  it('still shows Matchup for completed and archived seasons', () => {
    expect(shouldUseMatchupInsteadOfDraft({ status: 'completed' })).toBe(true)
    expect(shouldUseMatchupInsteadOfDraft({ status: 'archived' })).toBe(true)
  })

  it('a league with no stage at all leaves the tabs untouched', () => {
    expect(shouldUseMatchupInsteadOfDraft({ status: null, lifecycleState: null })).toBe(false)
  })
})

describe('isPreDraftOrDrafting', () => {
  it.each(['setup', 'pre_draft', 'drafting'])('treats %s as pre-draft', (s) => {
    expect(isPreDraftOrDrafting({ status: s })).toBe(true)
  })

  it.each(['in_season', 'playoffs', 'completed'])('treats %s as past the draft', (s) => {
    expect(isPreDraftOrDrafting({ status: s })).toBe(false)
  })
})
