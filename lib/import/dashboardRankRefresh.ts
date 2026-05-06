/** Client-only: signal dashboard to refetch `/api/user/rank` after legacy import. */

export const DASHBOARD_RANK_REFRESH_KEY = 'af_rank_refresh_pending'

export function markDashboardRankRefreshPending(): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(DASHBOARD_RANK_REFRESH_KEY, '1')
  } catch {
    /* ignore */
  }
}

export function consumeDashboardRankRefreshPending(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const v = sessionStorage.getItem(DASHBOARD_RANK_REFRESH_KEY)
    if (v === '1') {
      sessionStorage.removeItem(DASHBOARD_RANK_REFRESH_KEY)
      return true
    }
  } catch {
    /* ignore */
  }
  return false
}
