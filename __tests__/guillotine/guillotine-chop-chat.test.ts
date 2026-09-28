import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A chop announcement is authored by the league owner — `LeagueChatMessage.userId` must be a real
 * user and there is no system user — so it must be TAGGED as a host announcement. As a plain `text`
 * message it read as the owner typing "Bravo has been chopped".
 */

const create = vi.hoisted(() => vi.fn())
vi.mock('@/lib/league-chat/LeagueChatMessageService', () => ({ createLeagueChatMessage: create }))

import { postChopToLeagueChat } from '@/lib/guillotine/guillotineChat'

beforeEach(() => create.mockReset().mockResolvedValue({ id: 'msg-1' }))

describe('postChopToLeagueChat', () => {
  it('posts as a host announcement, never as the owner typing', async () => {
    await postChopToLeagueChat({
      leagueId: 'L1',
      weekOrPeriod: 3,
      choppedRosterIds: ['R-b'],
      displayNames: { 'R-b': 'Bravo' },
      userId: 'owner-1',
    })
    expect(create).toHaveBeenCalledWith(
      'L1',
      'owner-1',
      'Week 3 — Bravo has been chopped. Their roster has been released to waivers.',
      {
        type: 'host_announcement',
        metadata: expect.objectContaining({
          senderIsHost: true,
          guillotineChop: true,
          weekOrPeriod: 3,
          choppedRosterIds: ['R-b'],
        }),
      },
    )
  })

  it('names every team when more than one is chopped', async () => {
    await postChopToLeagueChat({
      leagueId: 'L1',
      weekOrPeriod: 9,
      choppedRosterIds: ['R-b', 'R-c'],
      displayNames: { 'R-b': 'Bravo', 'R-c': 'Charlie' },
      userId: 'owner-1',
    })
    expect(create.mock.calls[0]![2]).toBe('Week 9 — Chopped: Bravo, Charlie. Their rosters have been released to waivers.')
  })
})
