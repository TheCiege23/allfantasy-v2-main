/** Current market observations may rank a forward-season draft. Never relabel their stored year. */
export function observedAdpSeason(requested: number | undefined, now = new Date()): number | undefined {
  return requested == null ? undefined : Math.min(requested, now.getUTCFullYear())
}
