import { describe, expect, it } from 'vitest'

import { shouldHideChimmyFloatingFab } from '@/lib/shell/draftRoomFloatingUi'

describe('floating dock visibility (Chimmy FAB vs draft surfaces)', () => {
  it('hides on /draft/* paths', () => {
    expect(shouldHideChimmyFloatingFab('/draft/live/abc')).toBe(true)
    expect(shouldHideChimmyFloatingFab('/draft/room/xyz')).toBe(true)
    expect(shouldHideChimmyFloatingFab('/draft/abc123/snake')).toBe(true)
  })

  it('hides on league draft resolver route', () => {
    expect(shouldHideChimmyFloatingFab('/league/lid-here/draft')).toBe(true)
    expect(shouldHideChimmyFloatingFab('/league/lid-here/draft/setup')).toBe(true)
  })

  it('does not hide on dashboard', () => {
    expect(shouldHideChimmyFloatingFab('/dashboard')).toBe(false)
    expect(shouldHideChimmyFloatingFab('/dashboard?leagueId=x')).toBe(false)
  })

  it('does not hide on generic league hub', () => {
    expect(shouldHideChimmyFloatingFab('/league/x/overview')).toBe(false)
  })
})
