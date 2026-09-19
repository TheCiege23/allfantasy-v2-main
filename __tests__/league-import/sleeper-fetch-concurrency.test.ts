import { describe, expect, it } from 'vitest'

import {
  fetchSleeperDraftPickGroups,
} from '@/lib/league-import/sleeper/SleeperLeagueFetchService'
import {
  fetchSleeperTransactionWeeks,
} from '@/lib/league-import/sleeper/SleeperHistoricalTransactionSyncService'
import {
  SLEEPER_DRAFT_FETCH_CONCURRENCY,
  SLEEPER_HISTORY_FETCH_CONCURRENCY,
} from '@/lib/league-import/sleeper/SleeperFetchConcurrency'
import type { SleeperTransaction } from '@/lib/sleeper-client'

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

describe('bounded Sleeper history fetches', () => {
  it('loads transaction weeks concurrently while preserving week order', async () => {
    let active = 0
    let maxActive = 0

    const result = await fetchSleeperTransactionWeeks({
      externalLeagueId: 'league-1',
      firstWeek: 1,
      fetchWeek: async (_leagueId, week) => {
        active += 1
        maxActive = Math.max(maxActive, active)
        await pause((week % 3) + 1)
        active -= 1
        return [{ transaction_id: `tx-${week}` } as SleeperTransaction]
      },
    })

    expect(maxActive).toBe(SLEEPER_HISTORY_FETCH_CONCURRENCY)
    expect(result.map((row) => row.week)).toEqual(
      Array.from({ length: 18 }, (_, index) => index + 1),
    )
    expect(result.map((row) => row.transactions[0]?.transaction_id)).toEqual(
      Array.from({ length: 18 }, (_, index) => `tx-${index + 1}`),
    )
  })

  it('loads unique draft boards concurrently and keeps provider order', async () => {
    let active = 0
    let maxActive = 0
    const requested: string[] = []

    const result = await fetchSleeperDraftPickGroups({
      draftIds: ['draft-1', 'draft-2', 'draft-2', 'draft-3', 'draft-4', 'draft-5'],
      season: '2026',
      fetchDraftPicks: async (draftId) => {
        requested.push(draftId)
        active += 1
        maxActive = Math.max(maxActive, active)
        await pause(Number(draftId.at(-1)) % 3 + 1)
        active -= 1
        return [{ player_id: `player-${draftId.at(-1)}` }] as never
      },
    })

    expect(maxActive).toBe(SLEEPER_DRAFT_FETCH_CONCURRENCY)
    expect(requested).toHaveLength(5)
    expect(result.map((pick) => pick.draft_id)).toEqual([
      'draft-1',
      'draft-2',
      'draft-3',
      'draft-4',
      'draft-5',
    ])
    expect(result.every((pick) => pick.season === '2026')).toBe(true)
  })
})
