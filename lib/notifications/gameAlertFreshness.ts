/** Game updates lose their value when delivered after the moment has passed. */
export function isLiveGameAlert(type: string | undefined): boolean {
  return /^(game_|live_score)/.test(type ?? '')
}

/** Keep an absolute deadline across retries, including rows created before expiry was added. */
export function gameAlertDeadline(type: string | undefined, createdAt: Date, explicit?: unknown): number | undefined {
  const supplied = typeof explicit === 'string' ? Date.parse(explicit) : NaN
  const bounded = isLiveGameAlert(type) ? createdAt.getTime() + 300_000 : undefined
  return Number.isFinite(supplied) ? Math.min(supplied, bounded ?? supplied) : bounded
}

/** Zero means deliver now or discard; never replay game updates when a device reconnects. */
export function pushRetentionSeconds(type: string | undefined): number {
  return isLiveGameAlert(type) ? 0 : 86400
}
