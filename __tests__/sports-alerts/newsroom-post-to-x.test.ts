// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const publishMock = vi.fn()
const statusMock = vi.fn()
class FakeWeeklyXError extends Error {
  constructor(public readonly code: string, public readonly status = 400) {
    super(code)
  }
}
vi.mock('@/lib/core-app/weeklyXPublishing', () => ({
  publishWeeklyXPost: publishMock,
  weeklyXStatus: statusMock,
  WeeklyXError: FakeWeeklyXError,
}))

const { postNewsroomX, validNewsroomXPost, newsroomXAccount } = await import('@/lib/social-newsroom/postToX')

const ID = '3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b'
const LONG_URL = 'https://www.espn.com/nfl/story/_/id/12345678/' + 'a'.repeat(200)

beforeEach(() => {
  publishMock.mockReset()
  statusMock.mockReset()
})

describe('validNewsroomXPost', () => {
  it('counts a link as 23 characters, as X does', () => {
    // 250 raw characters of text plus a 245-character link: 495 raw, 273 as X counts it.
    const text = `${'x'.repeat(249)} ${LONG_URL}`
    expect(text.length).toBeGreaterThan(280)
    expect(validNewsroomXPost(ID, text)).toBeNull()
  })

  it('refuses a post over 280 as X counts it', () => {
    expect(validNewsroomXPost(ID, 'x'.repeat(281))).toMatch(/281\/280/)
  })

  it('refuses an empty post and a malformed request id', () => {
    expect(validNewsroomXPost(ID, '   ')).toMatch(/empty/)
    expect(validNewsroomXPost('not-a-uuid', 'hello')).toMatch(/request id/)
  })
})

describe('postNewsroomX', () => {
  it('publishes through the connected account and returns the tweet link', async () => {
    publishMock.mockResolvedValueOnce({ id: '1', url: 'https://x.com/i/status/1' })
    const res = await postNewsroomX('user-1', ID, '  Trade: A to B via @espn  ')
    expect(res).toEqual({ ok: true, url: 'https://x.com/i/status/1' })
    expect(publishMock).toHaveBeenCalledWith('user-1', { requestId: ID, text: 'Trade: A to B via @espn' })
  })

  it('never calls X for an invalid post', async () => {
    const res = await postNewsroomX('user-1', ID, 'x'.repeat(300))
    expect(res.ok).toBe(false)
    expect(publishMock).not.toHaveBeenCalled()
  })

  it('turns an expired connection into a reconnect instruction', async () => {
    publishMock.mockRejectedValueOnce(new FakeWeeklyXError('reconnect', 409))
    const res = await postNewsroomX('user-1', ID, 'hello')
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/Reconnect X/) })
  })

  it('says to check X rather than retry when the post may have landed', async () => {
    publishMock.mockRejectedValueOnce(new FakeWeeklyXError('publication_unknown', 409))
    const res = await postNewsroomX('user-1', ID, 'hello')
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/Check your X profile/) })
  })
})

describe('newsroomXAccount', () => {
  it('names the handle only for a live connection', async () => {
    statusMock.mockResolvedValueOnce({ configured: true, connected: true, handle: 'TheCiege' })
    expect(await newsroomXAccount('user-1')).toEqual({ handle: 'TheCiege' })
    statusMock.mockResolvedValueOnce({ configured: true, connected: false, handle: 'TheCiege' })
    expect(await newsroomXAccount('user-1')).toBeNull()
    expect(await newsroomXAccount(null)).toBeNull()
  })
})
