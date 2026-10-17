export type LeagueCalendarEvent = { key: string; label: string; at: string | null; when: string; detail: string }

/** Dates are provider evidence. Week numbers are never converted into guessed dates. */
export function leagueCalendar(settings: unknown): LeagueCalendarEvent[] {
  const outer = settings && typeof settings === 'object' ? settings as Record<string, unknown> : {}
  const nested = outer.settings && typeof outer.settings === 'object' ? outer.settings as Record<string, unknown> : {}
  const s = { ...nested, ...outer }
  const events: LeagueCalendarEvent[] = []
  const date = (keys: string[]) => {
    for (const key of keys) {
      const raw = s[key]
      if (raw == null || raw === '' || raw === 0) continue
      const ms = typeof raw === 'number' ? (raw < 1e12 ? raw * 1000 : raw) : typeof raw === 'string' && !/^\d+$/.test(raw) ? Date.parse(raw) : NaN
      if (Number.isFinite(ms) && ms > Date.UTC(2000,0,1)) return new Date(ms).toISOString()
    }
    return null
  }
  for (const [key, label, keys] of [
    ['draft', 'Draft', ['draft_start', 'draftStartTime', 'draft_date']],
    ['waivers', 'Next waiver processing', ['waiver_next_run', 'nextWaiverRunAt', 'waiverProcessAt']],
    ['trade', 'Trade deadline', ['tradeDeadlineAt', 'trade_deadline_at']],
    ['keeper', 'Keeper deadline', ['keeperDeadlineAt', 'keeper_deadline_at']],
  ] as const) {
    const at = date([...keys])
    if (at) events.push({ key, label, at, when: at, detail: 'Published in this league’s settings.' })
  }
  for (const [key, label, field] of [['trade-week', 'Trade deadline', 'trade_deadline'], ['playoffs', 'Playoffs start', 'playoff_week_start']] as const) {
    const week = Number(s[field])
    if (Number.isInteger(week) && week > 0 && week <= 30 && !(key === 'trade-week' && events.some(e => e.key === 'trade'))) events.push({ key, label, at: null, when: `Week ${week}`, detail: 'The provider supplied a week, not an exact date or time.' })
  }
  return events.sort((a,b) => a.at && b.at ? a.at.localeCompare(b.at) : a.at ? -1 : b.at ? 1 : 0)
}
