import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'

/*
 * The Chimmy chat shell's League <select> (/ai-chat, /messages, the league chat panels) listed
 * same-named leagues identically — measured 2026-09-28, four "TheCiege26's 12-Team NFL Redraft
 * League (manual)". It now applies the app's one rule (lib/core-app/leagueNameCollision.ts).
 *
 * ⚠ THAT NAME IS EXACTLY 48 CHARACTERS, and the option text is cut at 48. So appending the suffix
 * to the raw name and cutting afterwards would silently cut the suffix off again; the rule has to
 * run on the text the option shows. The second case pins that.
 */

vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }))
vi.mock('@/lib/chimmy-chat/ChimmyChatService', () => ({ sendChimmyMessage: vi.fn() }))
vi.mock('@/lib/tokens/client-confirm', () => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('@/lib/chimmy-voice', () => ({
  getVoiceConfig: () => ({ enabled: false, autoPlay: false }),
  playChimmyVoice: vi.fn(),
  saveVoiceConfig: (next: unknown) => next,
  stopCurrentVoice: vi.fn(),
}))
vi.mock('@/lib/chimmy-chat/voiceEngagementNudge', () => ({ triggerChimmyVoiceListenNudge: vi.fn() }))
vi.mock('@/lib/chimmy-chat/analytics-events-client', () => ({
  trackChimmyAIEvent: vi.fn().mockResolvedValue(undefined),
  trackChimmyModeChangeEvent: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/chimmy-conversation-service', () => ({ loadChimmyConversation: vi.fn().mockResolvedValue(null) }))
vi.mock('@/hooks/useChimmyAutoTradeEval', () => ({
  useChimmyAutoTradeEval: () => ({ autoTradeEvalEnabled: false, toggleAutoTradeEval: vi.fn(), autoTradeEvalReady: true }),
}))

const TWELVE = "TheCiege26's 12-Team NFL Redraft League (manual)"

function stubLeagues(leagues: Array<{ id: string; name: string; sport: string }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (String(url).includes('/api/league/list') ? { leagues } : { available: false, leagues: [] }),
    })),
  )
}

async function optionTexts(expectedCount: number) {
  const ChimmyChatShell = (await import('@/components/chimmy/ChimmyChatShell')).default
  render(<ChimmyChatShell />)
  const select = screen.getByTestId('chimmy-scope-league')
  // Generous: the leagues arrive from a mount-time fetch, and a cold first render of this shell
  // measured >1s (the default) on a contended box — which reads as "no options", not a label bug.
  await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(expectedCount), { timeout: 15_000 })
  return within(select)
    .getAllByRole('option')
    .map((o) => o.textContent)
}

describe('ChimmyChatShell league select', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('gives colliding leagues distinct option labels and leaves a unique name unchanged', async () => {
    expect(TWELVE).toHaveLength(48)
    stubLeagues([
      { id: 'lg-12a-0c31', name: TWELVE, sport: 'NFL' },
      { id: 'lg-12b-0d42', name: TWELVE, sport: 'NFL' },
      { id: 'lg-kbfl-9999', name: 'KBFL', sport: 'NFL' },
    ])
    expect(await optionTexts(4)).toEqual([
      'All leagues',
      `${TWELVE} (NFL) · 0c31`,
      `${TWELVE} (NFL) · 0d42`,
      'KBFL (NFL)',
    ])
  })

  it('separates two names that differ only past the 48-character cut', async () => {
    stubLeagues([
      { id: 'lg-long-aaaa', name: `${TWELVE} — North`, sport: 'NFL' },
      { id: 'lg-long-bbbb', name: `${TWELVE} — South`, sport: 'NFL' },
    ])
    const texts = await optionTexts(3)
    expect(texts.slice(1)).toEqual([`${TWELVE} (NFL) · aaaa`, `${TWELVE} (NFL) · bbbb`])
  })
})
