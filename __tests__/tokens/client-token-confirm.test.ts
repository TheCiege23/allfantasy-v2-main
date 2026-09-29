import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import {
  isTokenConfirmationRequired,
  postWithTokenConfirm,
  responseErrorMessage,
  tokenConfirmationMessage,
} from '@/lib/tokens/clientTokenConfirm'

/*
 * The client half of the token fallback (2026-09-29): nothing is spent without the person being
 * told the cost and saying yes. The storyline buttons used to spend on one click (the route
 * hardcoded the confirmation) and the Survivor panel could never spend at all (it never sent it).
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const ASK = {
  code: 'token_confirmation_required',
  message: 'Use 30 tokens to unlock this request once.',
  preview: { tokenCost: 30, currentBalance: 120, featureLabel: 'League storyline' },
}

function sentBodies(fetchImpl: ReturnType<typeof vi.fn>) {
  return fetchImpl.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)))
}

describe('postWithTokenConfirm', () => {
  it('a plan holder is never asked: one call, never confirming', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(200, { narrative: 'ok' }))
    const confirm = vi.fn()
    const r = await postWithTokenConfirm('/x', { eventId: 'e1' }, { fetchImpl, confirm })
    expect(r.declined).toBe(false)
    expect(r.response.status).toBe(200)
    expect(confirm).not.toHaveBeenCalled()
    expect(sentBodies(fetchImpl)).toEqual([{ eventId: 'e1', confirmTokenSpend: false }])
  })

  it('asks with the cost named, and only a yes sends the confirmation', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(409, ASK)).mockResolvedValueOnce(json(200, { narrative: 'ok' }))
    const confirm = vi.fn().mockReturnValue(true)
    const r = await postWithTokenConfirm('/x', { eventId: 'e1' }, { fetchImpl, confirm })
    expect(confirm).toHaveBeenCalledWith('League storyline uses 30 tokens (you have 120). Continue?')
    expect(sentBodies(fetchImpl)).toEqual([
      { eventId: 'e1', confirmTokenSpend: false },
      { eventId: 'e1', confirmTokenSpend: true },
    ])
    expect(r).toMatchObject({ declined: false })
    expect(r.response.status).toBe(200)
  })

  it('a no spends nothing: no second call, and the caller is told it was declined', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(409, ASK))
    const r = await postWithTokenConfirm('/x', { eventId: 'e1' }, { fetchImpl, confirm: () => false })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(r.declined).toBe(true)
  })

  it('an async confirm (a dialog) is awaited', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(409, ASK)).mockResolvedValueOnce(json(200, {}))
    await postWithTokenConfirm('/x', {}, { fetchImpl, confirm: async () => true })
    expect(sentBodies(fetchImpl)[1]).toEqual({ confirmTokenSpend: true })
  })

  it('[control] a 409 that is not a token question is returned as-is, with no prompt', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(409, { code: 'draft_locked' }))
    const confirm = vi.fn()
    const r = await postWithTokenConfirm('/x', {}, { fetchImpl, confirm })
    expect(confirm).not.toHaveBeenCalled()
    expect(r).toMatchObject({ declined: false })
    expect(r.response.status).toBe(409)
  })

  it('[control] a 402 (not enough tokens) is returned as-is, never retried with a confirmation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(402, { code: 'insufficient_token_balance', message: 'Need 30 tokens.' }))
    const r = await postWithTokenConfirm('/x', {}, { fetchImpl, confirm: () => true })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(await responseErrorMessage(r.response, 'fallback')).toBe('Need 30 tokens.')
  })

  it('without a browser, the default confirm says no rather than spending', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(json(409, ASK))
    const r = await postWithTokenConfirm('/x', {}, { fetchImpl })
    expect(r.declined).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('the question and the error text', () => {
  it('names the cost even with no label or balance', () => {
    expect(tokenConfirmationMessage({ preview: { tokenCost: 1 } })).toBe('This uses 1 token. Continue?')
    expect(tokenConfirmationMessage({})).toBe('This uses tokens. Continue?')
  })

  it('recognises only the token question', () => {
    expect(isTokenConfirmationRequired(409, ASK)).toBe(true)
    expect(isTokenConfirmationRequired(402, ASK)).toBe(false)
    expect(isTokenConfirmationRequired(409, { code: 'other' })).toBe(false)
  })

  it('reads message, then error, then the fallback', async () => {
    expect(await responseErrorMessage(json(500, { error: 'Failed to build story' }), 'x')).toBe('Failed to build story')
    expect(await responseErrorMessage(json(500, {}), 'Could not load story.')).toBe('Could not load story.')
  })
})

describe('every screen that can spend storyline or Survivor tokens asks first', () => {
  /* Comments stripped, so a sentence ABOUT the old bug can neither satisfy nor break a check. */
  const code = (rel: string) =>
    readFileSync(resolve(process.cwd(), rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
  const CALLERS: ReadonlyArray<{ file: string; route: string }> = [
    { file: 'app/app/league/[leagueId]/drama/[eventId]/page.tsx', route: '/drama/tell-story' },
    { file: 'app/app/league/[leagueId]/drama/page.tsx', route: '/drama/tell-story' },
    { file: 'components/app/league/LeagueDramaWidget.tsx', route: '/drama/tell-story' },
    { file: 'components/app/matchups/MatchupDramaWidget.tsx', route: '/drama/tell-story' },
    { file: 'components/league-story/LeagueStoryModal.tsx', route: '/story/create' },
    { file: 'components/survivor/SurvivorAIPanel.tsx', route: '/survivor/ai' },
  ]

  it.each(CALLERS)('$file posts through postWithTokenConfirm, never a bare fetch', ({ file, route }) => {
    const src = code(file)
    expect(src).toMatch(/postWithTokenConfirm\(/)
    // The route's URL appears only as the helper's argument: find each use and look just before it.
    let at = src.indexOf(route)
    expect(at).toBeGreaterThan(-1)
    while (at !== -1) {
      const before = src.slice(Math.max(0, at - 120), at)
      expect(before).toMatch(/postWithTokenConfirm\(\s*[`'"][^`'"]*$/)
      at = src.indexOf(route, at + route.length)
    }
  })

  it('no storyline route hardcodes the confirmation any more', () => {
    for (const f of ['app/api/leagues/[leagueId]/drama/tell-story/route.ts', 'app/api/leagues/[leagueId]/story/create/route.ts']) {
      const src = code(f)
      expect(src).toMatch(/confirmTokenSpend:\s*body\.confirmTokenSpend === true/)
      expect(src).not.toMatch(/confirmTokenSpend:\s*true/)
    }
  })
})
