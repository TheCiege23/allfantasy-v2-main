import { describe, expect, it } from 'vitest'
import {
  consumeDashboardRankRefreshPending,
  DASHBOARD_RANK_REFRESH_KEY,
} from '@/lib/import/dashboardRankRefresh'
import { normalizeIncomingImportProvider } from '@/lib/import/importSearchParams'

describe('normalizeIncomingImportProvider', () => {
  it('maps supported providers', () => {
    expect(normalizeIncomingImportProvider('YAHOO')).toBe('yahoo')
    expect(normalizeIncomingImportProvider('sleeper')).toBe('sleeper')
    expect(normalizeIncomingImportProvider('bad')).toBeUndefined()
  })
})

describe('dashboardRankRefresh', () => {
  it('consumeDashboardRankRefreshPending clears the pending flag once', () => {
    sessionStorage.setItem(DASHBOARD_RANK_REFRESH_KEY, '1')
    expect(consumeDashboardRankRefreshPending()).toBe(true)
    expect(sessionStorage.getItem(DASHBOARD_RANK_REFRESH_KEY)).toBeNull()
    expect(consumeDashboardRankRefreshPending()).toBe(false)
  })
})
