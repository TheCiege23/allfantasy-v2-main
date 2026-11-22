import { expect, it, vi } from 'vitest'
const upsert = vi.hoisted(() => vi.fn(async () => ({})))
vi.mock('@/lib/prisma', () => ({ prisma: { userProfile: { upsert } } }))
import { updateUserProfile } from '@/lib/user-settings/UserProfileService'
it('persists live-only sports while normalizing and rejecting unknown interests', async () => {
  expect(await updateUserProfile('u1', { preferredSports: ['wnba', 'NFL', 'NCAABASE', 'WNBA', 'unknown'] })).toEqual({ ok: true })
  expect(upsert).toHaveBeenLastCalledWith(expect.objectContaining({ update: { preferredSports: ['NFL', 'NCAABASE', 'WNBA'] } }))
  expect(await updateUserProfile('u1', { preferredSports: [] })).toEqual({ ok: true })
  expect(upsert).toHaveBeenLastCalledWith(expect.objectContaining({ update: { preferredSports: null } }))
})
