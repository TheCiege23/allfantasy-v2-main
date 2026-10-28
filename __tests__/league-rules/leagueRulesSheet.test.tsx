/** The league rules sheet (components/league-rules/LeagueRulesSheet.tsx), when it opens by itself, and its route. */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { translations } from '@/lib/i18n/translations'

const lang = vi.hoisted(() => ({ language: 'en' as 'en' | 'es' }))

vi.mock('@/components/i18n/LanguageProviderClient', async () => {
  const { translations } = await import('@/lib/i18n/translations')
  const t = (k: string) => translations[lang.language][k] ?? translations.en[k] ?? k
  return {
    useOptionalLanguage: () => ({
      language: lang.language,
      t,
      tInterpolate: (k: string, vars: Record<string, string | number>) => t(k).replace(/\{\{(\w+)\}\}/g, (_: string, v: string) => String(vars[v] ?? '')),
    }),
  }
})

import { LeagueRulesSheet } from '@/components/league-rules/LeagueRulesSheet'
import { isRulesSheetSeen, markRulesSheetSeen, rulesSheetSeenKey, shouldAutoOpenRulesSheet } from '@/lib/league-rules/rulesSheetSeen'

const view = {
  leagueId: 'L1',
  leagueName: 'Dynasty Den',
  sport: 'NFL',
  native: true,
  platform: null,
  sections: [
    {
      id: 'trades',
      title: 'Trades',
      rules: [
        { id: 'trades.deadline', label: 'Trade deadline', value: 'After week 11', means: 'Trades close once week 11 ends, and pending offers expire.', source: null },
        { id: 'trades.pickDeadline', label: 'Pick trade deadline', value: 'Open all season', means: null, source: null },
      ],
    },
    { id: 'playoffs', title: 'Playoffs and standings', rules: [{ id: 'playoffs.teams', label: 'Playoff teams', value: '6 teams', means: null, source: 'default' }] },
  ],
}

const stub = (responses: Array<{ ok: boolean; body: unknown }>) => {
  const f = vi.fn(async () => {
    const r = responses.shift() ?? { ok: true, body: view }
    return { ok: r.ok, json: async () => r.body }
  })
  vi.stubGlobal('fetch', f)
  return f
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  lang.language = 'en'
})

describe('the sheet', () => {
  it('fetches the sheet in the viewer’s language and shows each rule, its meaning and its source', async () => {
    const f = stub([{ ok: true, body: view }])
    render(<LeagueRulesSheet leagueId="L1" open onClose={() => {}} />)
    expect(screen.getByRole('status').textContent).toBe(translations.en['rules.sheet.loading'])
    const rules = await screen.findAllByTestId('league-rule')
    expect(f).toHaveBeenCalledWith('/api/leagues/L1/rules-sheet?lang=en', expect.objectContaining({ credentials: 'include' }))
    expect(rules.map((r) => r.textContent)).toEqual([
      'Trade deadlineAfter week 11Trades close once week 11 ends, and pending offers expire.',
      'Pick trade deadlineOpen all season',
      'Playoff teams6 teamsDefault',
    ])
    expect(screen.queryByTestId('league-rules-sheet-commissioner-hint')).toBeNull()
  })

  it('tells the commissioner this is what every manager sees', async () => {
    stub([{ ok: true, body: view }])
    render(<LeagueRulesSheet leagueId="L1" open onClose={() => {}} isCommissioner />)
    expect((await screen.findByTestId('league-rules-sheet-commissioner-hint')).textContent).toBe(translations.en['rules.sheet.commissionerHint'])
  })

  it('says where an imported league’s rules live', async () => {
    stub([{ ok: true, body: { ...view, native: false, platform: 'Sleeper' } }])
    render(<LeagueRulesSheet leagueId="L1" open onClose={() => {}} />)
    expect((await screen.findByTestId('league-rules-sheet-imported')).textContent).toBe('This league runs on Sleeper. Rules not shown here are set there.')
  })

  it('offers a retry when the sheet cannot load, and recovers', async () => {
    const f = stub([{ ok: false, body: { error: 'nope' } }, { ok: true, body: view }])
    render(<LeagueRulesSheet leagueId="L1" open onClose={() => {}} />)
    fireEvent.click(await screen.findByTestId('league-rules-sheet-retry'))
    expect(await screen.findAllByTestId('league-rule')).toHaveLength(3)
    expect(f).toHaveBeenCalledTimes(2)
  })

  it('closes from the button, the backdrop and Escape; links Chimmy to the league with the question typed in', async () => {
    stub([{ ok: true, body: view }])
    const onClose = vi.fn()
    render(<LeagueRulesSheet leagueId="L1" open onClose={onClose} />)
    await screen.findAllByTestId('league-rule')
    fireEvent.click(screen.getByTestId('league-rules-sheet-done'))
    fireEvent.click(screen.getByTestId('league-rules-sheet'))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(3)
    const chimmy = screen.getByTestId('league-rules-sheet-chimmy') as HTMLAnchorElement
    expect(chimmy.getAttribute('href')).toBe(`/chimmy/chat?prompt=${encodeURIComponent(translations.en['rules.sheet.chimmyPrompt']!)}&leagueId=L1`)
  })

  it('renders nothing and fetches nothing while closed', () => {
    const f = stub([])
    const { container } = render(<LeagueRulesSheet leagueId="L1" open={false} onClose={() => {}} />)
    expect(container.innerHTML).toBe('')
    expect(f).not.toHaveBeenCalled()
  })

  it('speaks Spanish, with no «waiver»', async () => {
    lang.language = 'es'
    const f = stub([{ ok: true, body: view }])
    render(<LeagueRulesSheet leagueId="L1" open onClose={() => {}} />)
    await screen.findAllByTestId('league-rule')
    expect(f).toHaveBeenCalledWith('/api/leagues/L1/rules-sheet?lang=es', expect.anything())
    const text = screen.getByTestId('league-rules-sheet').textContent ?? ''
    expect(text).toContain(translations.es['rules.sheet.title'])
    expect(text).toContain(translations.es['rules.sheet.source.default'])
    expect(text.toLowerCase()).not.toContain('waiver')
  })
})

describe('opening by itself', () => {
  beforeEach(() => window.localStorage.clear())
  const ready = { leagueId: 'L1', userId: 'u1', welcomeDone: true, introsSeen: true, embedded: false, seen: false }

  it('opens once nothing else is greeting the manager, and only once', () => {
    expect(shouldAutoOpenRulesSheet(ready)).toBe(true)
    expect(shouldAutoOpenRulesSheet({ ...ready, welcomeDone: false })).toBe(false)
    expect(shouldAutoOpenRulesSheet({ ...ready, introsSeen: false })).toBe(false)
    expect(shouldAutoOpenRulesSheet({ ...ready, embedded: true })).toBe(false)
    expect(shouldAutoOpenRulesSheet({ ...ready, userId: null })).toBe(false)
    expect(shouldAutoOpenRulesSheet({ ...ready, seen: true })).toBe(false)
  })

  it('remembers per league and per manager', () => {
    expect(isRulesSheetSeen('L1', 'u1')).toBe(false)
    markRulesSheetSeen('L1', 'u1')
    expect(window.localStorage.getItem(rulesSheetSeenKey('L1', 'u1'))).toBe('1')
    expect(isRulesSheetSeen('L1', 'u1')).toBe(true)
    expect(isRulesSheetSeen('L1', 'u2')).toBe(false)
    expect(isRulesSheetSeen('L2', 'u1')).toBe(false)
  })

  it('treats blocked storage as seen, so a private window is not greeted every visit', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(isRulesSheetSeen('L1', 'u1')).toBe(true)
    spy.mockRestore()
  })
})

describe('GET /api/leagues/:id/rules-sheet', () => {
  it('needs a session, passes the language through and maps refusals', async () => {
    vi.resetModules()
    const session = { value: null as null | { user: { id: string } } }
    const read = vi.fn(async (): Promise<unknown> => ({ ok: true, view }))
    vi.doMock('next-auth', () => ({ getServerSession: vi.fn(async () => session.value) }))
    vi.doMock('@/lib/auth', () => ({ authOptions: {} }))
    vi.doMock('@/lib/league-rules/rulesSheetService', () => ({ readRulesSheet: read }))
    const { GET } = await import('@/app/api/leagues/[leagueId]/rules-sheet/handler')
    const { NextRequest } = await import('next/server')
    const req = (q = '') => new NextRequest(`http://x/api/leagues/L1/rules-sheet${q}`)
    const ctx = { params: { leagueId: 'L1' } }

    expect((await GET(req(), ctx)).status).toBe(401)
    session.value = { user: { id: 'u1' } }
    const ok = await GET(req('?lang=es'), ctx)
    expect(ok.status).toBe(200)
    expect(read).toHaveBeenLastCalledWith('L1', 'u1', 'es')
    await GET(req('?lang=fr'), ctx)
    expect(read).toHaveBeenLastCalledWith('L1', 'u1', 'en')
    read.mockResolvedValueOnce({ ok: false, status: 403 })
    expect((await GET(req(), ctx)).status).toBe(403)
    read.mockResolvedValueOnce({ ok: false, status: 404 })
    expect((await GET(req(), ctx)).status).toBe(404)
  })
})
