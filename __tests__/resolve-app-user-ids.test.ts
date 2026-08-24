import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The silent-drop bug, pinned.
 *
 * Every notifier collected `Roster.platformUserId` — our user id on a native
 * league, the SLEEPER user id on an imported one — and handed it to a
 * dispatcher that looks profiles up by our id and `continue`s past what it
 * does not recognise. No error, no log. Every member of every imported league
 * was skipped in silence, and imported leagues are most of the funnel.
 */

const { appUserFindMany, userProfileFindMany } = vi.hoisted(() => ({
  appUserFindMany: vi.fn(),
  userProfileFindMany: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    appUser: { findMany: appUserFindMany },
    userProfile: { findMany: userProfileFindMany },
  },
}))

import { resolveAppUserIds, resolveRecipients } from '@/lib/notifications/resolveAppUserIds'

beforeEach(() => {
  appUserFindMany.mockReset()
  userProfileFindMany.mockReset()
  appUserFindMany.mockResolvedValue([])
  userProfileFindMany.mockResolvedValue([])
})

describe('resolveRecipients', () => {
  it('translates a Sleeper id into the AllFantasy account behind it', async () => {
    userProfileFindMany.mockResolvedValue([{ userId: 'af-1', sleeperUserId: '869123' }])
    const out = await resolveRecipients(['869123'])
    expect(out.userIds).toEqual(['af-1'])
    expect(out.unresolved).toEqual([])
  })

  it('passes through ids that are already ours, without a second lookup', async () => {
    appUserFindMany.mockResolvedValue([{ id: 'af-1' }])
    const out = await resolveRecipients(['af-1'])
    expect(out.userIds).toEqual(['af-1'])
    expect(userProfileFindMany).not.toHaveBeenCalled()
  })

  it('handles a league that mixes both id spaces', async () => {
    appUserFindMany.mockResolvedValue([{ id: 'af-native' }])
    userProfileFindMany.mockResolvedValue([{ userId: 'af-imported', sleeperUserId: '77' }])
    const out = await resolveRecipients(['af-native', '77'])
    expect(new Set(out.userIds)).toEqual(new Set(['af-native', 'af-imported']))
    // The direct lookup already claimed one, so only the remainder is translated.
    expect(userProfileFindMany.mock.calls[0][0].where.sleeperUserId.in).toEqual(['77'])
  })

  it('reports a Sleeper manager with no AllFantasy account rather than pretending', async () => {
    const out = await resolveRecipients(['never-signed-up'])
    expect(out.userIds).toEqual([])
    expect(out.unresolved).toEqual(['never-signed-up'])
  })

  it('deduplicates, and never queries on an empty set', async () => {
    appUserFindMany.mockResolvedValue([{ id: 'af-1' }])
    expect((await resolveRecipients(['af-1', 'af-1'])).userIds).toEqual(['af-1'])

    appUserFindMany.mockReset()
    expect(await resolveAppUserIds([])).toEqual([])
    expect(await resolveAppUserIds([''])).toEqual([])
    expect(appUserFindMany).not.toHaveBeenCalled()
  })

  it('degrades to sending nothing rather than throwing when a read fails', async () => {
    appUserFindMany.mockImplementationOnce(async () => {
      throw new Error('db down')
    })
    userProfileFindMany.mockResolvedValue([])
    expect(await resolveAppUserIds(['someone'])).toEqual([])
  })
})
