/**
 * The one question every lineup automation asks before moving a person's starters (owner's rules,
 * 2026-11-23): AF Pro / Supreme, the user's own switch ON (off until they choose), and the commissioner's
 * league-wide switch not off. AI-managed and unclaimed seats always run.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  pref: vi.fn(),
  save: vi.fn(),
  hasAccess: vi.fn(),
}))
vi.mock('@/lib/core-app/teamPreferenceStore', () => ({ readTeamPreference: h.pref, saveTeamPreference: h.save }))
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    resolveForUser(userId: string, feature: string) {
      return Promise.resolve({ hasAccess: h.hasAccess(userId, feature) })
    }
  },
}))

import {
  AI_SWAP_PREF_KEY,
  aiSwapAllowedForTeam,
  isAiSeat,
  leagueAllowsAiSwap,
  readAiSwapChoice,
  setAiSwapPreference,
  userHasAiSwapPlan,
} from '@/lib/lineup-automation/aiSwapPolicy'

const person = { platformUserId: 'user-1', settings: {} }
const league = { autoCoachEnabled: true }

beforeEach(() => {
  vi.clearAllMocks()
  h.pref.mockResolvedValue({ on: true, decidedAt: '2026-11-23T00:00:00.000Z', version: 1 })
  h.hasAccess.mockImplementation((_u: string, feature: string) => feature === 'pro_autocoach')
  h.save.mockResolvedValue(true)
})

describe('pure parts', () => {
  it('recognises every AI or unclaimed seat, and only those', () => {
    expect(isAiSeat({ platformUserId: 'open-slot-L-3' })).toBe(true)
    expect(isAiSeat({ platformUserId: 'orphan-test-r1' })).toBe(true)
    expect(isAiSeat({ platformUserId: 'ai-manager-r1' })).toBe(true)
    expect(isAiSeat({ platformUserId: 'user-1', settings: { aiManaged: true } })).toBe(true)
    expect(isAiSeat({ platformUserId: 'user-1', settings: { aiManaged: false } })).toBe(false)
    expect(isAiSeat(person)).toBe(false)
  })

  it('reads a choice never made as OFF and undecided', () => {
    expect(readAiSwapChoice(null)).toEqual({ on: false, decided: false })
    expect(readAiSwapChoice({ on: false, decidedAt: 'x' })).toEqual({ on: false, decided: true })
    expect(readAiSwapChoice({ on: true, decidedAt: 'x' })).toEqual({ on: true, decided: true })
  })

  it('treats only an explicit commissioner false as league off', () => {
    expect(leagueAllowsAiSwap({ autoCoachEnabled: false })).toBe(false)
    expect(leagueAllowsAiSwap({ autoCoachEnabled: true })).toBe(true)
    expect(leagueAllowsAiSwap({ autoCoachEnabled: null })).toBe(true)
  })
})

describe('aiSwapAllowedForTeam', () => {
  it('[control] allows a Pro subscriber who turned it on, in a league that allows it', async () => {
    expect(await aiSwapAllowedForTeam({ roster: person, league })).toEqual({ allowed: true, reason: 'owner_opted_in' })
  })

  it('is OFF by default: a paid user who never chose gets no swaps', async () => {
    h.pref.mockResolvedValue(null)
    expect(await aiSwapAllowedForTeam({ roster: person, league })).toEqual({ allowed: false, reason: 'owner_off' })
  })

  it('refuses a paid user who turned it off', async () => {
    h.pref.mockResolvedValue({ on: false, decidedAt: 'x' })
    expect((await aiSwapAllowedForTeam({ roster: person, league })).reason).toBe('owner_off')
  })

  it('refuses a user without AF Pro / Supreme even with the switch on', async () => {
    h.hasAccess.mockReturnValue(false)
    expect((await aiSwapAllowedForTeam({ roster: person, league })).reason).toBe('owner_not_pro')
  })

  it('lets the commissioner switch beat every manager’s own setting', async () => {
    expect(await aiSwapAllowedForTeam({ roster: person, league: { autoCoachEnabled: false } })).toEqual({ allowed: false, reason: 'league_off' })
    expect(h.pref).not.toHaveBeenCalled()
  })

  it('always runs for an AI or unclaimed seat, without a plan or a choice', async () => {
    h.hasAccess.mockReturnValue(false)
    h.pref.mockResolvedValue(null)
    expect(await aiSwapAllowedForTeam({ roster: { platformUserId: 'open-slot-L-1' }, league: { autoCoachEnabled: false } })).toEqual({ allowed: true, reason: 'ai_seat' })
  })
})

describe('saving and the plan check', () => {
  it('saves the choice under its own key at the stored version', async () => {
    await setAiSwapPreference('user-1', true)
    expect(h.save).toHaveBeenCalledWith('user-1', AI_SWAP_PREF_KEY, 1, expect.objectContaining({ on: true, decidedAt: expect.any(String) }))
  })

  it('never asks the plan for a placeholder seat id', async () => {
    expect(await userHasAiSwapPlan('open-slot-L-1')).toBe(false)
    expect(h.hasAccess).not.toHaveBeenCalled()
  })
})
