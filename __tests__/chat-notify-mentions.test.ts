import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { leagueMentionRoomId, notifyMentions } from '@/lib/chat-core/notifyMentions'

function lastBody(f: ReturnType<typeof vi.fn>) {
  return JSON.parse(String(f.mock.calls[0][1].body)) as {
    threadId: string
    messageId: string
    mentionedUsernames: string[]
  }
}

describe('notifyMentions', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('sends the usernames a message mentions', async () => {
    await notifyMentions({ threadId: 't1', messageId: 'm1', text: 'nice one @rival and @other' })

    expect(lastBody(fetchMock).mentionedUsernames).toEqual(['rival', 'other'])
  })

  /*
   * The bug this helper exists for: parseAtMentions strips `all` out of
   * userMentions, and the old inline caller both passed that array AND skipped
   * the request when it was empty — so "@all" reached nobody, though the
   * endpoint has always implemented it.
   */
  it('re-adds the all token the endpoint looks for', async () => {
    await notifyMentions({ threadId: 't1', messageId: 'm1', text: '@all draft moved to Sunday' })

    expect(fetchMock).toHaveBeenCalled()
    expect(lastBody(fetchMock).mentionedUsernames).toContain('all')
  })

  it('sends both when a message mentions all and a person', async () => {
    await notifyMentions({ threadId: 't1', messageId: 'm1', text: '@all and especially @rival' })

    const names = lastBody(fetchMock).mentionedUsernames
    expect(names).toContain('rival')
    expect(names).toContain('all')
  })

  it('stays silent when nobody was mentioned', async () => {
    await notifyMentions({ threadId: 't1', messageId: 'm1', text: 'just a message' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /* Those have their own paths; notifications are not one of them. */
  it('does not treat @chimmy or @global as people to notify', async () => {
    await notifyMentions({ threadId: 't1', messageId: 'm1', text: '@chimmy who do I start' })
    expect(fetchMock).not.toHaveBeenCalled()

    await notifyMentions({ threadId: 't1', messageId: 'm1', text: '@global reminder' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('requires a posted message to attach to', async () => {
    await notifyMentions({ threadId: 't1', messageId: '', text: '@rival hi' })
    await notifyMentions({ threadId: '', messageId: 'm1', text: '@rival hi' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /* The message is already posted; a failed ping must never surface as a failed send. */
  it('never throws when the request fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    await expect(
      notifyMentions({ threadId: 't1', messageId: 'm1', text: '@rival hi' }),
    ).resolves.toBeUndefined()
  })

  it('builds the league room id the endpoint expects', () => {
    expect(leagueMentionRoomId('lg1')).toBe('league:lg1')
  })
})
