/**
 * D7: several Team/Commissioner Focus surfaces (Recommendations panel, hero urgent count,
 * Today's Agenda, Weekly Game Plan) read a cross-league list or per-league group straight from
 * `/api/dashboard/today-actions` without filtering it, so a manager viewing one league saw
 * another league's items. Global Command Center (selectedLeagueId=null) intentionally keeps the
 * combined, correctly-labeled view — only a specific league selection should narrow it.
 */
export function scopeBySelectedLeague<T extends { leagueId: string }>(
  items: T[],
  selectedLeagueId: string | null,
): T[] {
  if (!selectedLeagueId) return items
  return items.filter((item) => item.leagueId === selectedLeagueId)
}
