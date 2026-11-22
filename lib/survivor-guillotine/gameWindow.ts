export type SGGameWindow = { weekOrRound?: number; startTime: { not: null; gte?: Date; lt?: Date; gt?: Date } }

/** NFL has real week numbers. NBA specialty periods are defined by the league's saved dates. */
export function sgGameWindow(sport: string, period: number, startsAt?: string | null, endsAt?: string | null): SGGameWindow {
  if (sport === 'NFL') return { weekOrRound: period, startTime: { not: null } }
  const start = new Date(startsAt ?? ''), end = new Date(endsAt ?? '')
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) throw new Error('NBA game locks require valid scoring-period dates.')
  return { startTime: { not: null, gte: start, lt: end } }
}
