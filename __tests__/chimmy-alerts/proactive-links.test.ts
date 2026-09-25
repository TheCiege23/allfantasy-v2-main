import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ user: vi.fn(), record: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: h.user }))
vi.mock('@/lib/chimmy-personalization', () => ({ recordChimmyPersonalizationEvent: h.record }))

import { chimmyChatHref, describeProactiveFrom, readProactiveFrom } from '@/lib/chimmy-alerts/proactiveLinks'
import { recordProactiveOpen } from '@/lib/chimmy-alerts/recordProactiveOpen'

/**
 * Did the weekly messages bring anyone in? Every link carries `from=`, and the /chimmy/chat page
 * records an open as the personalization layer's own `alert_clicked` event.
 */

beforeEach(() => {
  h.user.mockReset()
  h.record.mockReset()
  h.user.mockResolvedValue({ appUserId: 'u1' })
  h.record.mockResolvedValue(undefined)
})

describe('the tag', () => {
  it('accepts only the four known values — the URL is typeable, so anything else is dropped', () => {
    for (const v of ['lineup_check', 'lineup_check_email', 'waiver_check', 'waiver_check_email']) expect(readProactiveFrom(v)).toBe(v)
    for (const v of ['LINEUP_CHECK', 'lineup_check ', 'x', '', null, undefined, 3, ['lineup_check']]) expect(readProactiveFrom(v)).toBeNull()
  })

  it('says which check and which channel', () => {
    expect(describeProactiveFrom('lineup_check')).toEqual({ alert: 'lineup_check', channel: 'app' })
    expect(describeProactiveFrom('lineup_check_email')).toEqual({ alert: 'lineup_check', channel: 'email' })
    expect(describeProactiveFrom('waiver_check')).toEqual({ alert: 'waiver_check', channel: 'app' })
    expect(describeProactiveFrom('waiver_check_email')).toEqual({ alert: 'waiver_check', channel: 'email' })
  })

  it('builds a link that survives any prompt text', () => {
    const href = chimmyChatHref({ prompt: 'Should I pick up Ja\'Marr & drop "X"?', leagueId: 'L 1', from: 'waiver_check_email' })
    const u = new URL(href, 'https://x.test')
    expect(u.pathname).toBe('/chimmy/chat')
    expect(u.searchParams.get('prompt')).toBe('Should I pick up Ja\'Marr & drop "X"?')
    expect(u.searchParams.get('leagueId')).toBe('L 1')
    expect(u.searchParams.get('sport')).toBe('NFL')
    expect(u.searchParams.get('from')).toBe('waiver_check_email')
  })
})

describe('recording the open', () => {
  it('records an alert_clicked event with the check, channel and league', async () => {
    await recordProactiveOpen({ from: 'waiver_check_email', leagueId: 'lg_123-abc' })
    expect(h.record).toHaveBeenCalledWith('u1', {
      type: 'alert_clicked',
      metadata: { alert: 'waiver_check', channel: 'email', from: 'waiver_check_email', leagueId: 'lg_123-abc', surface: 'chimmy_chat' },
    })
  })

  it('stores no league id it cannot vouch for', async () => {
    await recordProactiveOpen({ from: 'lineup_check', leagueId: '<script>' })
    await recordProactiveOpen({ from: 'lineup_check', leagueId: 'x'.repeat(65) })
    await recordProactiveOpen({ from: 'lineup_check' })
    for (const call of h.record.mock.calls) expect(call[1].metadata.leagueId).toBeNull()
  })

  it('counts nothing for a signed-out open', async () => {
    h.user.mockResolvedValue({ appUserId: null })
    await recordProactiveOpen({ from: 'lineup_check' })
    expect(h.record).not.toHaveBeenCalled()
  })

  it('never throws — a lost count, never a lost page', async () => {
    h.record.mockRejectedValue(new Error('db down'))
    await expect(recordProactiveOpen({ from: 'lineup_check' })).resolves.toBeUndefined()
    h.user.mockRejectedValue(new Error('session down'))
    await expect(recordProactiveOpen({ from: 'lineup_check' })).resolves.toBeUndefined()
  })
})
