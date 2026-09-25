import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

/*
 * /chimmy/chat is the chat drawer's Chimmy tab, full screen (owner's call, 2026-09-25). These render
 * the real page client — and through it the real `ChimmyPanel` the drawer renders — and drive it the
 * way a person would: open it from a link, read the chat, ask, confirm a spend, go back.
 *
 * ⚠ FETCH IS ROUTED BY URL AND METHOD, NEVER BY CALL ORDER. The panel GETs the saved conversation
 * as it mounts and the page POSTs /api/chat/unread beside it; which of those lands first is not a
 * contract, and a queue of `mockResolvedValueOnce` would hand the chat answer to the history read.
 * Even the 409 → retry pair is decided by what the request CARRIES (`confirmTokenSpend`), not by
 * which call it is.
 */

const routerBack = vi.hoisted(() => vi.fn())
const confirmTokenSpendMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: routerBack }),
  usePathname: () => '/chimmy/chat',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/tokens/client-confirm', () => ({
  confirmTokenSpend: confirmTokenSpendMock,
  previewTokenSpend: vi.fn(),
}))

import { ChimmyChatPageClient } from '@/app/chimmy/chat/ChimmyChatPageClient'
import CommsDrawer from '@/components/core-app/comms/CommsDrawer'

const LEAGUES = [
  { id: 'L1', name: 'KBFL', platform: 'sleeper', platformLeagueId: '99', isCommissioner: false, teamCount: 12 },
  { id: 'L2', name: 'Zombie Beta', platform: 'espn', platformLeagueId: null, isCommissioner: true, teamCount: 10 },
]

const FUTURE = '2099-01-01T00:00:00.000Z'
const LINEUP_CARD = {
  actionId: 'a1',
  kind: 'lineup',
  token: 'signed.token-value',
  title: 'Lineup change — Week 4',
  league: { id: 'L1', name: 'KBFL', sport: 'NFL' },
  week: 4,
  season: 2026,
  expiresAt: FUTURE,
  lineup: {
    moveIn: [{ name: 'Kyren Williams', position: 'RB', team: 'LAR', slot: 'RB2' }],
    moveOut: [{ name: 'Tony Pollard', position: 'RB', team: 'TEN' }],
  },
  warnings: [],
}

function json(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

type Routes = {
  /** Answer for a POST to /api/chat/chimmy, decided from what the request carries. */
  chimmy?: (form: FormData) => Response
  /** Saved turns per scope, for GET /api/chat/chimmy?leagueId=<scope>. */
  history?: Record<string, unknown[]>
}

let fetchMock: ReturnType<typeof vi.fn>
function routeFetch(routes: Routes = {}) {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (url === '/api/chat/unread' && method === 'POST') return json({ ok: true })
    if (url.startsWith('/api/chat/chimmy?') && method === 'GET') {
      const scope = new URL(url, 'http://x').searchParams.get('leagueId') ?? ''
      return json({ turns: routes.history?.[scope] ?? [] })
    }
    if (url === '/api/chat/chimmy' && method === 'POST') {
      return routes.chimmy ? routes.chimmy(init!.body as FormData) : json({ response: 'Start him.' })
    }
    if (url === '/api/push/subscribe') return json({ configured: false, vapidPublicKey: null })
    return json({})
  })
  vi.stubGlobal('fetch', fetchMock)
}

const calls = (pred: (url: string, init: RequestInit | undefined) => boolean) =>
  fetchMock.mock.calls.filter(([u, init]) => pred(String(u), init as RequestInit | undefined))
const chimmyPosts = () => calls((u, i) => u === '/api/chat/chimmy' && (i?.method ?? 'GET') === 'POST')
const postedForm = (n = 0) => chimmyPosts()[n]![1]!.body as FormData
const historyReads = () => calls((u, i) => u.startsWith('/api/chat/chimmy?') && (i?.method ?? 'GET') === 'GET')

function openPage(props: Partial<React.ComponentProps<typeof ChimmyChatPageClient>> = {}) {
  return render(
    <ChimmyChatPageClient userId="u1" leagues={LEAGUES} tokenCost={9} planAllowance={null} {...props} />,
  )
}

async function ask(question: string) {
  const box = screen.getByLabelText('Message') as HTMLTextAreaElement
  fireEvent.change(box, { target: { value: question } })
  fireEvent.submit(box.closest('form')!)
}

beforeEach(() => {
  vi.clearAllMocks()
  sessionStorage.clear()
  localStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  routeFetch()
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('/chimmy/chat is the drawer\'s Chimmy tab, full screen', () => {
  it('renders the drawer\'s controls — scope picker, Fast/Deep, starter questions, price — and none of the old page\'s rail', async () => {
    openPage()

    expect(screen.getByRole('heading', { name: 'Chimmy' })).toBeInTheDocument()
    expect(screen.getByText('Who sees this: Just you')).toBeInTheDocument()
    expect(screen.getByLabelText('League scope')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fast' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deep' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Which league needs me most\?/ })).toBeInTheDocument()
    expect(screen.getByText('Chimmy answers may cost 9 tokens. Free lookups and typing cost nothing.')).toBeInTheDocument()

    // What the hands-on test saw on the old page, none of which the drawer has.
    for (const gone of [/AI Quick Ask/, /AI Hub/, /AI Status/, /Wallet Summary/, /Chimmy shortcuts/, /Assistant mode/]) {
      expect(screen.queryByText(gone)).toBeNull()
    }
    expect(screen.queryByTestId('chimmy-chat-shell')).toBeNull()
    expect(screen.queryByTestId('chimmy-scope-sport')).toBeNull()
    await waitFor(() => expect(historyReads()).toHaveLength(1))
  })

  it('puts ?prompt= in the box and sends nothing', async () => {
    openPage({ prompt: 'Check my lineup for this week. Anything I should change?' })

    await waitFor(() =>
      expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe(
        'Check my lineup for this week. Anything I should change?',
      ),
    )
    await waitFor(() => expect(historyReads()).toHaveLength(1))
    expect(chimmyPosts()).toHaveLength(0)
  })

  it('opens scoped to ?leagueId= when it is one of your leagues, and asks there', async () => {
    openPage({ leagueId: 'L1', sport: 'NFL' })

    expect((screen.getByLabelText('League scope') as HTMLSelectElement).value).toBe('L1')
    expect(document.querySelector('.af-chimmy-page-head .af-cm-scopechip')!.textContent).toBe('KBFL')
    await waitFor(() => expect(historyReads().map(([u]) => String(u))).toEqual(['/api/chat/chimmy?leagueId=L1']))

    await ask('How does my matchup look?')
    await waitFor(() => expect(chimmyPosts()).toHaveLength(1))
    expect(postedForm().get('leagueId')).toBe('L1')
    // A league's own sport outranks the URL's, so the URL's is not sent while a league is picked.
    expect(postedForm().get('sport')).toBeNull()
  })

  it('opens on All leagues when ?leagueId= is not one of yours', () => {
    openPage({ leagueId: 'someone-elses' })
    expect((screen.getByLabelText('League scope') as HTMLSelectElement).value).toBe('')
    expect(document.querySelector('.af-chimmy-page-head .af-cm-scopechip')!.textContent).toBe('GLOBAL')
  })

  it('clears Chimmy\'s weekly checks from the bubble on open', async () => {
    openPage()
    await waitFor(() => expect(calls((u, i) => u === '/api/chat/unread' && i?.method === 'POST')).toHaveLength(1))
    const [, init] = calls((u) => u === '/api/chat/unread')[0]!
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ scope: 'chimmy' })
  })

  it('asks /api/chat/chimmy in multipart, as this page, with the URL\'s sport while no league is picked', async () => {
    openPage({ sport: 'NBA' })
    fireEvent.click(screen.getByRole('button', { name: 'Fast' }))
    await ask('Who are the best waiver adds tonight?')

    await waitFor(() => expect(screen.getByText('Start him.')).toBeInTheDocument())
    expect(chimmyPosts()).toHaveLength(1)
    const form = postedForm()
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('message')).toBe('Who are the best waiver adds tonight?')
    expect(form.get('source')).toBe('messages_ai')
    expect(form.get('sport')).toBe('NBA')
    expect(form.get('assistantMode')).toBe('fast_take')
    expect(form.get('leagueId')).toBeNull()
    expect(form.get('coreSurface')).toBeNull()
    expect(form.get('homeSignals')).toBeNull()
  })

  it('renders an answer the way the drawer does: confirm card inline under it, the charge, the thumbs', async () => {
    routeFetch({
      chimmy: () =>
        json({
          response: 'Start Kyren Williams over Tony Pollard.',
          meta: { tokenSpend: { tokenCost: 9 }, actionCards: [LINEUP_CARD], toolsUsed: ['get_my_lineup'] },
        }),
    })
    openPage()
    await ask('Set my best lineup for this week')

    const answer = (await screen.findByText('Start Kyren Williams over Tony Pollard.')).closest('.af-cm-turn') as HTMLElement
    expect(within(answer).getByText('Nothing changes until you tap Confirm.')).toBeInTheDocument()
    expect(within(answer).getByTestId('chimmy-action-confirm')).toBeInTheDocument()
    expect(within(answer).getByText('9 tokens')).toBeInTheDocument()
    expect(within(answer).getByRole('button', { name: 'Useful' })).toBeInTheDocument()
    // The old page's tray above the chat is gone; the card lives with the answer that made it.
    expect(screen.queryByTestId('chimmy-action-tray')).toBeNull()
  })

  it('tags a thumbs-up with this page\'s entry, so it joins the question it rates', async () => {
    routeFetch({ chimmy: () => json({ response: 'Start him.', meta: { toolsUsed: ['get_my_lineup'] } }) })
    openPage()
    await ask('Who should I start?')
    fireEvent.click(await screen.findByRole('button', { name: 'Useful' }))

    await waitFor(() => expect(calls((u) => u === '/api/ai/events')).toHaveLength(1))
    const event = JSON.parse(String((calls((u) => u === '/api/ai/events')[0]![1] as RequestInit).body))
    expect(event.event_name).toBe('feedback_submit')
    expect(event.metadata.entry).toBe('messages_ai')
    expect(event.metadata.tools).toEqual(['get_my_lineup'])
  })

  it('asks for token consent on a 409 and resends once with confirmTokenSpend, like the drawer', async () => {
    routeFetch({
      chimmy: (form) =>
        form.get('confirmTokenSpend') === 'true'
          ? json({ response: 'Start him.', meta: { tokenSpend: { tokenCost: 9 } } })
          : json(
              { error: 'Token spend confirmation required.', code: 'token_confirmation_required', preview: { ruleCode: 'ai_chimmy_chat_message' } },
              409,
            ),
    })
    confirmTokenSpendMock.mockResolvedValue({ confirmed: true, preview: { canSpend: true } })
    openPage()
    await ask('Who should I start?')

    await waitFor(() => expect(screen.getByText('Start him.')).toBeInTheDocument())
    expect(confirmTokenSpendMock).toHaveBeenCalledWith('ai_chimmy_chat_message')
    expect(chimmyPosts()).toHaveLength(2)
    expect(postedForm(0).get('confirmTokenSpend')).toBeNull()
    expect(postedForm(1).get('confirmTokenSpend')).toBe('true')
  })

  it('brings back the saved conversation', async () => {
    routeFetch({
      history: {
        global: [
          { id: 'h1', role: 'you', text: 'Is Bijan a sell?' },
          { id: 'h2', role: 'chimmy', text: 'Hold. His usage is climbing.' },
        ],
      },
    })
    openPage()
    expect(await screen.findByText('Is Bijan a sell?')).toBeInTheDocument()
    expect(screen.getByText('Hold. His usage is climbing.')).toBeInTheDocument()
  })
})

describe('the page around the panel', () => {
  it('keeps the composer above the on-screen keyboard: the page takes the visible height', async () => {
    const listeners: Record<string, Array<() => void>> = {}
    const vv = {
      height: 812,
      offsetTop: 0,
      addEventListener: (t: string, fn: () => void) => (listeners[t] ??= []).push(fn),
      removeEventListener: vi.fn(),
    }
    vi.stubGlobal('visualViewport', vv)
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0)
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => {})
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 812 })

    openPage()
    const page = screen.getByTestId('chimmy-chat-page')
    expect(page.style.height).toBe('')

    // The keyboard opens: the VISUAL viewport shrinks, the layout one does not.
    vv.height = 480
    act(() => listeners.resize?.forEach((fn) => fn()))
    await waitFor(() => expect(page.style.height).toBe('480px'))
    expect(page.getAttribute('data-keyboard-inset')).toBe('open')
  })

  it('Back steps back when the page behind this one is ours', () => {
    Object.defineProperty(document, 'referrer', { configurable: true, value: `${window.location.origin}/player/123` })
    window.history.pushState({}, '', window.location.pathname)
    openPage()

    const back = screen.getByTestId('chimmy-chat-back-link')
    expect(back.getAttribute('href')).toBe('/core')
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    back.dispatchEvent(click)
    expect(routerBack).toHaveBeenCalledTimes(1)
    expect(click.defaultPrevented).toBe(true)
  })

  it('Back follows its link to /core when nothing of ours is behind it', () => {
    Object.defineProperty(document, 'referrer', { configurable: true, value: 'https://mail.example.com/inbox' })
    openPage()
    const back = screen.getByTestId('chimmy-chat-back-link')
    // Read whether the page claimed the click, then stop jsdom from trying to load /core.
    let claimedByPage: boolean | null = null
    const observe = (e: Event) => {
      claimedByPage = e.defaultPrevented
      e.preventDefault()
    }
    document.addEventListener('click', observe)
    try {
      back.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    } finally {
      document.removeEventListener('click', observe)
    }
    expect(routerBack).not.toHaveBeenCalled()
    expect(claimedByPage).toBe(false)
    expect(back.getAttribute('href')).toBe('/core')
  })
})

describe('the drawer\'s request is unchanged by sharing the panel', () => {
  it('sends no source and no sport from the drawer\'s Chimmy tab', async () => {
    render(
      <CommsDrawer
        open
        onClose={vi.fn()}
        mode="overlay"
        leagues={LEAGUES}
        pageLeagueId={null}
        chimmyTokenCost={9}
        initialTab="chimmy"
        userId="u1"
      />,
    )
    await ask('Who should I start?')
    await waitFor(() => expect(chimmyPosts()).toHaveLength(1))
    const form = postedForm()
    expect(form.get('source')).toBeNull()
    expect(form.get('sport')).toBeNull()
    expect(form.get('message')).toBe('Who should I start?')
  })
})
