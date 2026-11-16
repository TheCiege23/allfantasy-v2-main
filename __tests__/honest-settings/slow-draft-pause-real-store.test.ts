/**
 * The settings window's slow-draft pause reaches the draft clock (2026-11-15).
 *
 * 🛑 It saved `LeagueSettings.slowDraftPause`, which the clock never reads; only the draft settings save sets the
 * overnight-pause window. The toggle now saves there and reports what the server applied.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { saveSlowDraftPause } from '@/app/league/[leagueId]/components/settings/DraftSettingsPanel'

const fetchMock = vi.fn()
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })

describe('turning the slow-draft pause on', () => {
  it('saves through the draft settings, with the league quiet hours', async () => {
    fetchMock.mockResolvedValue(reply(200, { ok: true, draftUISettings: { timerMode: 'overnight_pause' } }))
    expect(await saveSlowDraftPause('L1', true, { from: '22:00', to: '08:00' })).toEqual({ enabled: true, note: null })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/leagues/L1/draft/settings')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual({ slowDraftPauseEnabled: true, slowDraftPauseFrom: '22:00', slowDraftPauseTo: '08:00' })
  })

  it('a fast pick clock keeps it off, and says why', async () => {
    fetchMock.mockResolvedValue(reply(200, { ok: true, draftUISettings: { timerMode: 'per_pick' } }))
    const out = await saveSlowDraftPause('L1', true, { from: null, to: null })
    expect(out.enabled).toBe(false)
    expect(out.note).toMatch(/slow drafts/)
  })

  it('a refused save puts the switch back and shows the reason', async () => {
    fetchMock.mockResolvedValue(reply(423, { error: 'Draft settings are locked.' }))
    expect(await saveSlowDraftPause('L1', true, { from: null, to: null })).toEqual({ enabled: false, note: 'Draft settings are locked.' })
  })

  it('turning it off saves off', async () => {
    fetchMock.mockResolvedValue(reply(200, { ok: true, draftUISettings: { timerMode: 'per_pick' } }))
    expect(await saveSlowDraftPause('L1', false, { from: null, to: null })).toEqual({ enabled: false, note: null })
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toEqual({ slowDraftPauseEnabled: false })
  })
})
