/**
 * The league home's rules host: the first-time popup waits for every other dialog to close, closing
 * it records "seen", the "What changed" card dismisses once, and Spanish reads «reclamos».
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const lang = vi.hoisted(() => ({ current: 'en' as 'en' | 'es' }))
vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations: dict } = await import('@/lib/i18n/translations')
  const t = (k: string) => dict[lang.current]?.[k] ?? dict.en[k] ?? k
  return { useLanguage: () => ({ language: lang.current, t }), useOptionalLanguage: () => ({ language: lang.current, t }) }
})

import { LeagueRulesHomeHost } from '@/components/league/native/LeagueRulesHomeHost'
import { buildRulesExplainerView, EMPTY_LEAGUE_RULES_SEEN } from '@/lib/league-rules-explainer/view'
import type { RuleSnapshot } from '@/lib/league-rules-explainer/types'

const snapshot: RuleSnapshot = { sport: 'NFL', format: 'redraft', teamCount: 12, tradeDeadlineWeek: 13, waiverType: 'rolling', waiverHours: 24 }
const event = { id: 'e2', createdAt: '2026-10-02T00:00:00.000Z', actorUserId: 'commish', changes: [{ key: 'tradeDeadlineWeek', before: 12, after: 13 }] }

let posts: Array<Record<string, unknown>>
function mockFetch(view: unknown) {
  posts = []
  globalThis.fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ ok: true }))
    }
    return new Response(JSON.stringify(view))
  }) as typeof fetch
}

beforeEach(() => {
  lang.current = 'en'
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('first visit', () => {
  it('opens the rules popup, and closing it records "seen" once', async () => {
    mockFetch(buildRulesExplainerView({ snapshot, events: [], seen: EMPTY_LEAGUE_RULES_SEEN, viewerUserId: 'm', isCommissioner: false, broadcastsEnabled: true }))
    render(<LeagueRulesHomeHost leagueId="L1" />)
    const modal = await screen.findByTestId('league-rules-modal')
    expect(modal.textContent).toContain('12 teams compete in this league.')
    fireEvent.click(screen.getByTestId('league-rules-got-it'))
    await waitFor(() => expect(posts).toEqual([{ kind: 'rules' }]))
    expect(screen.queryByTestId('league-rules-modal')).toBeNull()
    // Reopening from the button is just a view: nothing more is recorded.
    fireEvent.click(screen.getByTestId('league-rules-open'))
    expect(await screen.findByTestId('league-rules-modal')).toBeTruthy()
    fireEvent.click(screen.getByTestId('league-rules-close'))
    expect(posts).toHaveLength(1)
  })

  it('waits while another dialog (an intro video, the welcome sheet) is open', async () => {
    const other = document.createElement('div')
    other.setAttribute('aria-modal', 'true')
    other.getClientRects = () => ({ length: 1 }) as unknown as DOMRectList
    document.body.appendChild(other)
    mockFetch(buildRulesExplainerView({ snapshot, events: [], seen: EMPTY_LEAGUE_RULES_SEEN, viewerUserId: 'm', isCommissioner: true, broadcastsEnabled: true }))
    render(<LeagueRulesHomeHost leagueId="L1" />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(screen.queryByTestId('league-rules-modal')).toBeNull()
    other.remove()
    const modal = await screen.findByTestId('league-rules-modal', {}, { timeout: 3000 })
    expect(modal.textContent).toContain('This is what your members will see the first time they open the league.')
  })

  it('does not open while blocked (league settings are open)', async () => {
    mockFetch(buildRulesExplainerView({ snapshot, events: [], seen: EMPTY_LEAGUE_RULES_SEEN, viewerUserId: 'm', isCommissioner: false, broadcastsEnabled: true }))
    render(<LeagueRulesHomeHost leagueId="L1" blocked />)
    await waitFor(() => expect(screen.getByTestId('league-rules-open')).toBeTruthy())
    expect(screen.queryByTestId('league-rules-modal')).toBeNull()
  })
})

describe('What changed', () => {
  const seen = { rulesSeenAt: '2026-09-01T00:00:00.000Z', lastSeenSettingsEventId: 'e1', lastSeenSettingsEventAt: '2026-10-01T00:00:00.000Z' }

  it('shows the card, not the popup, and "Got it" moves it to history', async () => {
    mockFetch(buildRulesExplainerView({ snapshot, events: [event], seen, viewerUserId: 'm', isCommissioner: false, broadcastsEnabled: true }))
    render(<LeagueRulesHomeHost leagueId="L1" />)
    const card = await screen.findByTestId('league-rules-changes-card')
    expect(card.textContent).toContain('Trade deadline: Week 12 → Week 13 — trades are allowed one week longer.')
    expect(screen.queryByTestId('league-rules-modal')).toBeNull()
    fireEvent.click(screen.getByTestId('league-rules-changes-dismiss'))
    await waitFor(() => expect(posts).toEqual([{ kind: 'changes', eventId: 'e2' }]))
    expect(screen.queryByTestId('league-rules-changes-card')).toBeNull()
    fireEvent.click(screen.getByTestId('league-rules-open'))
    expect((await screen.findByTestId('league-rules-history')).textContent).toContain('Trade deadline: Week 12 → Week 13')
  })

  it('Spanish: «reclamos», never waiver', async () => {
    lang.current = 'es'
    mockFetch(
      buildRulesExplainerView({
        snapshot,
        events: [{ ...event, changes: [{ key: 'waiverHours', before: 24, after: 48 }] }],
        seen,
        viewerUserId: 'm',
        isCommissioner: false,
        broadcastsEnabled: true,
      }),
    )
    render(<LeagueRulesHomeHost leagueId="L1" />)
    const card = await screen.findByTestId('league-rules-changes-card')
    expect(card.textContent).toContain('Periodo de reclamos: 24 horas → 48 horas — los jugadores liberados quedan en reclamos 24 horas más.')
    fireEvent.click(screen.getByTestId('league-rules-open'))
    const modal = await screen.findByTestId('league-rules-modal')
    expect(modal.textContent).toMatch(/reclamo/)
    expect(`${card.textContent} ${modal.textContent}`).not.toMatch(/waiver/i)
  })

  it('an unsupported league renders nothing', async () => {
    mockFetch({ supported: false })
    const { container } = render(<LeagueRulesHomeHost leagueId="L1" />)
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })

  it('hands off to Chimmy with the question typed in, scoped to the league, and closing counts as seen', async () => {
    mockFetch(buildRulesExplainerView({ snapshot, events: [], seen: EMPTY_LEAGUE_RULES_SEEN, viewerUserId: 'm', isCommissioner: false, broadcastsEnabled: true }))
    render(<LeagueRulesHomeHost leagueId="L1" />)
    await screen.findByTestId('league-rules-modal')
    const chimmy = screen.getByTestId('league-rules-ask-chimmy') as HTMLAnchorElement
    const { translations } = await import('@/lib/i18n/translations')
    expect(chimmy.getAttribute('href')).toBe(`/chimmy/chat?prompt=${encodeURIComponent(translations.en['leagueRules.ui.chimmyPrompt']!)}&leagueId=L1`)
    fireEvent.click(chimmy)
    await waitFor(() => expect(posts).toEqual([{ kind: 'rules' }]))
  })

  it('the imported-league shell gets its own button styling, not the native one', async () => {
    mockFetch(buildRulesExplainerView({ snapshot: { ...snapshot, importedFrom: 'sleeper' }, events: [], seen: { ...EMPTY_LEAGUE_RULES_SEEN, rulesSeenAt: '2026-10-01T00:00:00.000Z' }, viewerUserId: 'm', isCommissioner: false, broadcastsEnabled: true }))
    render(<LeagueRulesHomeHost leagueId="L1" variant="classic" />)
    const button = await screen.findByTestId('league-rules-open')
    expect(button.className).not.toContain('nl-button')
    fireEvent.click(button)
    expect((await screen.findByTestId('league-rules-modal')).textContent).toContain('This league runs on Sleeper.')
  })
})
