import { describe, expect, it } from 'vitest'

import { applyMatchupPrimaryTab, shouldUseMatchupInsteadOfDraft } from '@/lib/matchup-center/tabTransition'
import {
  resolveLifecycleTransitionAfterDraftCompletes,
  resolveLifecycleTransitionAfterDraftReset,
} from '@/server/services/leagueLifecycleService'
import type { TabDef } from '@/app/league/[leagueId]/LeagueTabs'

describe('resolveLifecycleTransitionAfterDraftCompletes', () => {
  it('maps drafting → post_draft without force when transition is valid', () => {
    expect(resolveLifecycleTransitionAfterDraftCompletes('drafting')).toEqual({
      target: 'post_draft',
      force: false,
    })
  })

  it('maps setup → post_draft with force (no direct edge in TRANSITIONS)', () => {
    expect(resolveLifecycleTransitionAfterDraftCompletes('setup')).toEqual({
      target: 'post_draft',
      force: true,
    })
  })

  it('maps pre_draft → post_draft with force', () => {
    expect(resolveLifecycleTransitionAfterDraftCompletes('pre_draft')).toEqual({
      target: 'post_draft',
      force: true,
    })
  })

  it('returns null when already post_draft or in-season (idempotent)', () => {
    expect(resolveLifecycleTransitionAfterDraftCompletes('post_draft')).toBeNull()
    expect(resolveLifecycleTransitionAfterDraftCompletes('in_season')).toBeNull()
    expect(resolveLifecycleTransitionAfterDraftCompletes('playoffs')).toBeNull()
    expect(resolveLifecycleTransitionAfterDraftCompletes('completed')).toBeNull()
    expect(resolveLifecycleTransitionAfterDraftCompletes('archived')).toBeNull()
  })

  it('does not propose another transition after league would already be post_draft (repeated completion)', () => {
    expect(resolveLifecycleTransitionAfterDraftCompletes('drafting')).toEqual({
      target: 'post_draft',
      force: false,
    })
    expect(resolveLifecycleTransitionAfterDraftCompletes('post_draft')).toBeNull()
    expect(resolveLifecycleTransitionAfterDraftCompletes('post_draft')).toBeNull()
  })
})

describe('resolveLifecycleTransitionAfterDraftReset', () => {
  it('maps post_draft → drafting when commissioner resets draft', () => {
    expect(resolveLifecycleTransitionAfterDraftReset('post_draft')).toBe('drafting')
  })

  it('returns null for non-post_draft states', () => {
    expect(resolveLifecycleTransitionAfterDraftReset('setup')).toBeNull()
    expect(resolveLifecycleTransitionAfterDraftReset('drafting')).toBeNull()
    expect(resolveLifecycleTransitionAfterDraftReset('in_season')).toBeNull()
  })
})

describe('LeagueShell tab contract after draft completion', () => {
  it('shouldUseMatchupInsteadOfDraft is true for post_draft', () => {
    expect(shouldUseMatchupInsteadOfDraft({ status: 'post_draft' })).toBe(true)
  })

  it('applyMatchupPrimaryTab promotes matchup when useMatchup is true', () => {
    const tabs: TabDef[] = [
      { id: 'draft', label: 'Draft' },
      { id: 'roster', label: 'Roster' },
    ]
    const out = applyMatchupPrimaryTab(tabs, true)
    expect(out[0]?.id).toBe('matchup')
  })
})
