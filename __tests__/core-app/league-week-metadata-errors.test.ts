// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRaw: mocks.query } }))
import { readLeagueWeekMetadata } from '@/lib/core-app/leagueWeekMetadata'
beforeEach(() => { mocks.query.mockReset() })
describe('league period metadata read status', () => {
  it('reports a failed read to callers that need partial-data status', async () => {
    mocks.query.mockRejectedValue(new Error('database unavailable'))
    const onError = vi.fn()
    expect(await readLeagueWeekMetadata(['L1'], 'internal', onError)).toEqual([])
    expect(onError).toHaveBeenCalledOnce()
  })
  it('does not flag a successful empty result as a failure', async () => {
    mocks.query.mockResolvedValue([])
    const onError = vi.fn()
    expect(await readLeagueWeekMetadata(['L1'], 'internal', onError)).toEqual([])
    expect(onError).not.toHaveBeenCalled()
  })
  it('preserves the existing optional-read behavior for other callers', async () => {
    mocks.query.mockRejectedValue(new Error('database unavailable'))
    expect(await readLeagueWeekMetadata(['L1'])).toEqual([])
  })
})
