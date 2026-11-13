import { normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'

type RoundTemplate = {
  roundNumber: number
  roundType: string
  roundLabel: string
  /** Relative week index within the season (1 = first week of tournament clock). */
  weekStartRel: number
  weekEndRel: number
}

/** NFL-oriented arc; other sports shift by `openingWeekStart - 1`. */
const TEMPLATES: Record<number, RoundTemplate[]> = {
  60: [
    { roundNumber: 1, roundType: 'opening', roundLabel: 'Opening Season', weekStartRel: 1, weekEndRel: 8 },
    { roundNumber: 2, roundType: 'bubble', roundLabel: 'Bubble Week', weekStartRel: 9, weekEndRel: 9 },
    { roundNumber: 3, roundType: 'qualifier', roundLabel: 'Qualifier Round', weekStartRel: 10, weekEndRel: 13 },
    { roundNumber: 4, roundType: 'elite', roundLabel: 'Elite Eight', weekStartRel: 14, weekEndRel: 16 },
    { roundNumber: 5, roundType: 'championship', roundLabel: 'The Championship', weekStartRel: 17, weekEndRel: 17 },
  ],
  120: [
    { roundNumber: 1, roundType: 'opening', roundLabel: 'Opening Season', weekStartRel: 1, weekEndRel: 8 },
    { roundNumber: 2, roundType: 'bubble', roundLabel: 'Bubble Week', weekStartRel: 9, weekEndRel: 9 },
    { roundNumber: 3, roundType: 'elite', roundLabel: 'Elite 32', weekStartRel: 10, weekEndRel: 13 },
    { roundNumber: 4, roundType: 'final', roundLabel: 'Final 8', weekStartRel: 14, weekEndRel: 16 },
    { roundNumber: 5, roundType: 'championship', roundLabel: 'The Championship', weekStartRel: 17, weekEndRel: 17 },
  ],
  180: [
    { roundNumber: 1, roundType: 'opening', roundLabel: 'Opening Season', weekStartRel: 1, weekEndRel: 8 },
    { roundNumber: 2, roundType: 'bubble', roundLabel: 'Bubble Week', weekStartRel: 9, weekEndRel: 9 },
    { roundNumber: 3, roundType: 'qualifier', roundLabel: 'Top 48', weekStartRel: 10, weekEndRel: 12 },
    { roundNumber: 4, roundType: 'elite', roundLabel: 'Elite 16', weekStartRel: 13, weekEndRel: 15 },
    { roundNumber: 5, roundType: 'championship', roundLabel: 'Championship', weekStartRel: 16, weekEndRel: 17 },
  ],
  240: [
    { roundNumber: 1, roundType: 'opening', roundLabel: 'Opening Season', weekStartRel: 1, weekEndRel: 8 },
    { roundNumber: 2, roundType: 'bubble', roundLabel: 'Bubble Week', weekStartRel: 9, weekEndRel: 9 },
    { roundNumber: 3, roundType: 'qualifier', roundLabel: 'Top 64', weekStartRel: 10, weekEndRel: 12 },
    { roundNumber: 4, roundType: 'elite', roundLabel: 'Elite 32', weekStartRel: 13, weekEndRel: 14 },
    { roundNumber: 5, roundType: 'semifinal', roundLabel: 'Final 16', weekStartRel: 15, weekEndRel: 16 },
    { roundNumber: 6, roundType: 'championship', roundLabel: 'The Championship', weekStartRel: 17, weekEndRel: 17 },
  ],
}

const NON_NFL_LENGTH = 24

/**
 * Recommended round structure for a pool size.
 * Week numbers are absolute sport weeks when `openingWeekStart` is the first tournament week.
 */
export function getRoundTemplate(
  participantCount: number,
  sport: string,
  openingWeekStart: number,
): Array<Omit<RoundTemplate, 'weekStartRel' | 'weekEndRel'> & { weekStart: number; weekEnd: number }> {
  const s = normalizeToSupportedSport(sport) as SupportedSport
  const key = [60, 120, 180, 240].includes(participantCount) ? participantCount : 120
  const rows = TEMPLATES[key] ?? TEMPLATES[120]
  const base = openingWeekStart - 1

  const scale = s === 'NFL' ? 1 : Math.max(1, Math.round(NON_NFL_LENGTH / 17))

  return rows.map((r) => ({
    roundNumber: r.roundNumber,
    roundType: r.roundType,
    roundLabel: r.roundLabel,
    weekStart: base + (r.weekStartRel - 1) * scale + 1,
    weekEnd: base + (r.weekEndRel - 1) * scale + 1,
  }))
}
