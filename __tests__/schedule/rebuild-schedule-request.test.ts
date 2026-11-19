/**
 * The commissioner's "Rebuild remaining weeks" (lib/schedule-runtime/rebuildScheduleRequest.ts, 2026-11-15).
 *
 * 🛑 The button sent a key the schedule-settings PUT ignores and always said "Schedule updated". It now asks the
 * schedule route to regenerate, confirms mid-season, and reports what the server answered.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { MID_SEASON_CONFIRMATION_CODE, requestScheduleRebuild } from '@/lib/schedule-runtime/rebuildScheduleRequest'
import { SCHEDULE_REGEN_CONFIRMATION_CODE } from '@/lib/schedule-runtime/scheduleRegeneration'

const fetchMock = vi.fn()
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('rebuilding the rest of the schedule', () => {
  it('asks the schedule route to regenerate', async () => {
    fetchMock.mockResolvedValue(reply(200, { ok: true }))
    expect(await requestScheduleRebuild('L1', () => true)).toEqual({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/redraft/schedule')
    expect(JSON.parse(init.body)).toEqual({ leagueId: 'L1', action: 'regenerate' })
  })

  it('mid-season, asks first and resends with the confirmation', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(409, { error: 'The season has started.', code: MID_SEASON_CONFIRMATION_CODE }))
      .mockResolvedValueOnce(reply(200, { ok: true }))
    const confirm = vi.fn(() => true)
    expect(await requestScheduleRebuild('L1', confirm)).toEqual({ ok: true })
    expect(confirm).toHaveBeenCalledWith('The season has started.')
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toMatchObject({ confirmMidSeasonChange: true })
  })

  it('a commissioner who says no changes nothing', async () => {
    fetchMock.mockResolvedValueOnce(reply(409, { error: 'x', code: MID_SEASON_CONFIRMATION_CODE }))
    expect(await requestScheduleRebuild('L1', () => false)).toEqual({ ok: false, message: null, cancelled: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('REGRESSION: a refusal is reported, never shown as success', async () => {
    fetchMock.mockResolvedValue(reply(409, { error: 'Every regular-season week has already started.', code: 'NO_REGENERABLE_WEEKS' }))
    expect(await requestScheduleRebuild('L1', () => true)).toEqual({ ok: false, message: 'Every regular-season week has already started.' })
  })

  it('the server and the browser spell the confirmation code the same way', () => {
    expect(SCHEDULE_REGEN_CONFIRMATION_CODE).toBe(MID_SEASON_CONFIRMATION_CODE)
  })
})
