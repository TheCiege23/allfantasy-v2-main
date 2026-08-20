import { describe, expect, it } from 'vitest'
import { applyMatchupPrimaryTab, shouldUseMatchupInsteadOfDraft } from '@/lib/matchup-center/tabTransition'
import type { TabDef } from '@/app/league/[leagueId]/LeagueTabs'

describe('matchup tab transition', () => {
  it('shouldUseMatchupInsteadOfDraft for in-season and post_draft', () => {
    expect(shouldUseMatchupInsteadOfDraft({ status: 'in_season' })).toBe(true)
    expect(shouldUseMatchupInsteadOfDraft({ status: 'post_draft' })).toBe(true)
    expect(shouldUseMatchupInsteadOfDraft({ status: 'drafting' })).toBe(false)
    expect(shouldUseMatchupInsteadOfDraft({ status: 'setup' })).toBe(false)
  })

  it('replaces draft tab with matchup', () => {
    const tabs: TabDef[] = [
      { id: 'draft', label: 'Draft' },
      { id: 'team', label: 'Team' },
    ]
    const out = applyMatchupPrimaryTab(tabs, true)
    expect(out[0]?.id).toBe('matchup')
  })
})
