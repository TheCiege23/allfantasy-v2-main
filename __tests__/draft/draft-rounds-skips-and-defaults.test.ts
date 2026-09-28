/**
 * Three ways a draft could not finish, or finished wrong:
 *   - more rounds than roster slots: every pick past the roster size is refused and a draft
 *     completes only on a full board, so it could never complete;
 *   - a skipped pick (`(Skipped)` / `SKIP`) was put on a roster by both post-draft syncs;
 *   - auto-pick on an expired clock was OFF by default, so an absent manager or an unfilled seat
 *     stopped the draft until the commissioner picked by hand.
 */
import { describe, expect, it, vi } from 'vitest'

const templatePayload = vi.hoisted(() => ({ value: { totalRosterSlots: 16 } as { totalRosterSlots: number } | null }))
vi.mock('@/lib/league/league-draft-template-payload', () => ({
  getLeagueDraftTemplatePayload: vi.fn(async () => templatePayload.value),
  getDraftEligiblePositionsFromPayload: vi.fn(() => new Set<string>()),
}))

const leagueSettingsRow = vi.hoisted(() => ({ settings: {} as Record<string, unknown> }))
vi.mock('@/lib/prisma', () => ({
  prisma: { league: { findUnique: vi.fn(async () => leagueSettingsRow), findFirst: vi.fn(async () => leagueSettingsRow) } },
}))

import { validateDraftRoundsFitRoster } from '@/lib/live-draft-engine/RosterFitValidation'
import { isDraftPickRowEmpty, isDraftPickSkipped } from '@/lib/live-draft-engine/draftPickEmpty'
import { getDraftUISettingsForLeague } from '@/lib/draft-defaults/DraftUISettingsResolver'

describe('rounds must fit the roster', () => {
  it('refuses more rounds than roster slots', async () => {
    templatePayload.value = { totalRosterSlots: 16 }
    expect(await validateDraftRoundsFitRoster('L', 17)).toMatch(/cannot finish/)
  })

  it('accepts up to the roster size', async () => {
    templatePayload.value = { totalRosterSlots: 16 }
    expect(await validateDraftRoundsFitRoster('L', 16)).toBeNull()
    expect(await validateDraftRoundsFitRoster('L', 4)).toBeNull()
  })

  it('does not block when there is no template to judge against', async () => {
    templatePayload.value = null
    expect(await validateDraftRoundsFitRoster('L', 40)).toBeNull()
  })
})

describe('a skipped pick', () => {
  const skip = { playerName: '(Skipped)', position: 'SKIP', pickMetadata: null }

  it('is not an open pick — the board moves past it', () => {
    expect(isDraftPickRowEmpty(skip)).toBe(false)
  })

  it('is recognised so no roster receives it', () => {
    expect(isDraftPickSkipped(skip)).toBe(true)
    expect(isDraftPickSkipped({ position: 'skip' })).toBe(true)
    expect(isDraftPickSkipped({ position: 'RB' })).toBe(false)
  })
})

describe('expired-clock auto-pick', () => {
  it('is on for a league that never set it', async () => {
    leagueSettingsRow.settings = {}
    expect((await getDraftUISettingsForLeague('L')).autoPickEnabled).toBe(true)
  })

  it('stays off for a league that turned it off', async () => {
    leagueSettingsRow.settings = { draft_auto_pick_enabled: false }
    expect((await getDraftUISettingsForLeague('L')).autoPickEnabled).toBe(false)
  })
})
