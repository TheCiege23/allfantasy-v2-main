import { describe, expect, it } from 'vitest'
import { AI_ACTION_REGISTRY } from '@/lib/chimmy-actions/AIActionRegistry'
import {
  AI_ACTION_WRITE_SCOPE,
  buildStagedWriteAuthority,
  describeStagedAction,
  getAIActionWriteScope,
  sourceLinkActionForScope,
} from '@/lib/chimmy-actions/AIActionWriteScope'
import { writeAuthorityCopy } from '@/lib/league/write-authority'

describe('AI_ACTION_WRITE_SCOPE', () => {
  it('classifies exactly the registered action types', () => {
    expect(Object.keys(AI_ACTION_WRITE_SCOPE).sort()).toEqual(Object.keys(AI_ACTION_REGISTRY).sort())
  })

  it('marks the actions that would change a host league', () => {
    expect(getAIActionWriteScope('claim_player')).toBe('waiver_claim')
    expect(getAIActionWriteScope('set_faab_bid')).toBe('waiver_claim')
    expect(getAIActionWriteScope('drop_player')).toBe('waiver_add_drop')
    expect(getAIActionWriteScope('start_player')).toBe('lineup')
    expect(getAIActionWriteScope('move_to_ir')).toBe('lineup')
    expect(getAIActionWriteScope('propose_trade')).toBe('trade')
    expect(getAIActionWriteScope('draft_player')).toBe('draft')
  })

  it('leaves analysis and AllFantasy-only actions unscoped', () => {
    for (const type of ['analyze_trade', 'compare_claims', 'simulate_matchup', 'open_deep_dive', 'save_recommendation'] as const) {
      expect(getAIActionWriteScope(type)).toBeNull()
    }
  })

  it('links each league-changing scope to the matching host screen', () => {
    expect(sourceLinkActionForScope('waiver_claim')).toBe('waiver')
    expect(sourceLinkActionForScope('waiver_add_drop')).toBe('waiver')
    expect(sourceLinkActionForScope('lineup')).toBe('lineup')
    expect(sourceLinkActionForScope('trade')).toBe('trade')
    expect(sourceLinkActionForScope('draft')).toBe('league')
    expect(sourceLinkActionForScope(null)).toBeUndefined()
  })
})

describe('buildStagedWriteAuthority', () => {
  it('treats an imported league as SHADOW and names its source', () => {
    const wa = buildStagedWriteAuthority('espn')
    expect(wa).toMatchObject({ authority: 'SHADOW', platform: 'espn', shadow: true })
    expect(wa.sourceLabel).toBeTruthy()
  })

  it('treats a league with no platform as NATIVE', () => {
    expect(buildStagedWriteAuthority(null)).toEqual({
      authority: 'NATIVE',
      platform: null,
      sourceLabel: null,
      shadow: false,
    })
  })

  it('carries no success copy — a staged action has not happened', () => {
    expect(buildStagedWriteAuthority('espn')).not.toHaveProperty('copy')
  })
})

describe('describeStagedAction', () => {
  it('tells a SHADOW league that nothing reached the source platform', () => {
    const wa = buildStagedWriteAuthority('espn')
    const message = describeStagedAction({ label: 'Claim Now', scope: 'waiver_claim', writeAuthority: wa })
    expect(message).toBe(
      `"Claim Now" is staged in AllFantasy — nothing has been sent to ${wa.sourceLabel}. Make the change in ${wa.sourceLabel} to apply it.`,
    )
    expect(message).not.toContain(writeAuthorityCopy('waiver_claim', 'espn').title)
  })

  it('tells a NATIVE league the action still needs submitting', () => {
    const message = describeStagedAction({
      label: 'Claim Now',
      scope: 'waiver_claim',
      writeAuthority: buildStagedWriteAuthority(null),
    })
    expect(message).toBe('"Claim Now" is staged — review and submit it to apply the change.')
    expect(message).not.toContain(writeAuthorityCopy('waiver_claim', null).title)
  })

  it('makes no claim about where a submit lands when the authority is unknown', () => {
    expect(describeStagedAction({ label: 'Claim Now', scope: 'waiver_claim', writeAuthority: null })).toBe(
      '"Claim Now" is staged — review and submit it to apply the change.',
    )
  })

  it('keeps the plain wording for actions that change nothing', () => {
    expect(describeStagedAction({ label: 'Compare', scope: null, writeAuthority: buildStagedWriteAuthority('espn') })).toBe(
      'Action "Compare" is ready.',
    )
  })
})
