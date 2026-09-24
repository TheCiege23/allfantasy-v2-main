/**
 * A dynasty league must be creatable from the wizard.
 *
 * 🛑 IT WAS NOT, AND THE BLOCKING MESSAGE NAMED TWO CONTROLS THAT DO NOT EXIST.
 * `form-completion.ts` raises `dynasty_draft_date` whenever the startup draft mode is
 * `scheduled` and `draftDateUtc` is empty — and the default was `scheduled` with an empty date.
 * `draftDateUtc` appears in exactly two places in the codebase: that default and that
 * validator. No screen sets it, and no screen switches the mode either, so "set a startup draft
 * date/time, or switch draft mode to Offline" was unactionable.
 *
 * Production 2026-09-24 agrees: 165 dynasty leagues, every one an import, ZERO created natively.
 *
 * ⚠ The rule is kept — it is correct for anyone who does choose a scheduled startup. Only the
 * default moved, and the draft date remains editable after creation through the real
 * `LeagueSettings.draftDateUtc` column and its `DraftSettingsPanel` UI.
 */
import { describe, expect, it } from 'vitest'

import { getDefaultDynastySetup } from '@/lib/create-league-v2/state'

describe('dynasty wizard defaults', () => {
  it('does not default to a draft mode that needs a field the UI cannot set', () => {
    const setup = getDefaultDynastySetup('NFL')

    expect(setup.draftDateUtc).toBe('')
    // With an unsettable date, `scheduled` is an unclearable blocker.
    expect(setup.draftMode).not.toBe('scheduled')
    expect(setup.draftMode).toBe('offline')
  })

  /**
   * ⚠ THE RULE IS NOT DELETED, AND THIS IS WHAT SAYS SO. Choosing `scheduled` without a date
   * must still block; only the default changed. A test that asserted merely "the form is now
   * submittable" would pass just as happily if the rule had been removed.
   */
  it('still blocks a scheduled startup with no date', async () => {
    const { analyzeCreateLeagueCompletion } = await import('@/lib/create-league-v2/form-completion')
    const { DEFAULT_V2_STATE } = await import('@/lib/create-league-v2/state')

    const base = { ...DEFAULT_V2_STATE, leagueType: 'dynasty', dynasty: getDefaultDynastySetup('NFL') }
    const state = {
      ...base,
      dynasty: { ...base.dynasty, draftMode: 'scheduled' as const, draftDateUtc: '' },
    }

    const codes = analyzeCreateLeagueCompletion(state as never).map((i) => i.code)
    expect(codes).toContain('dynasty_draft_date')

    // ...and clears once a date is supplied, so the rule tracks the real condition.
    const withDate = {
      ...state,
      dynasty: { ...state.dynasty, draftDateUtc: '2026-08-20T18:00:00.000Z' },
    }
    expect(analyzeCreateLeagueCompletion(withDate as never).map((i) => i.code)).not.toContain(
      'dynasty_draft_date',
    )
  })
})
