import type { LeagueH2HPayload, WeeklyAwards } from '@/lib/league-history/sleeperH2HService'

/**
 * Weekly awards as shareable moments (retention item 9, user decisions 2026-09-14): top score,
 * low score, narrow escape and biggest blowout — the superlatives the Tuesday weekly-awards cron
 * posts, counted from the same H2H aggregation. Pure, so the home (which reads the cache) and the
 * card route (which renders the PNG) cannot disagree about who won what.
 */

export const AWARD_KINDS = ['topScore', 'lowScore', 'narrowEscape', 'biggestBlowout'] as const
export type AwardKind = (typeof AWARD_KINDS)[number]

export const AWARD_LABEL: Record<AwardKind, string> = {
  topScore: 'Top score',
  lowScore: 'Low score',
  narrowEscape: 'Narrow escape',
  biggestBlowout: 'Biggest blowout',
}

export function isAwardKind(v: unknown): v is AwardKind {
  return typeof v === 'string' && (AWARD_KINDS as readonly string[]).includes(v)
}

export type AwardView = {
  kind: AwardKind
  label: string
  season: string
  week: number
  ownerId: string
  name: string
  teamName: string | null
  avatar: string | null
  /** Points for a score award; the winning margin for a game award. */
  value: number
  unit: 'pts' | 'margin'
  /** The beaten opponent, for a game award. */
  opponentName: string | null
}

/** The awards this manager holds for the latest synced week — a game award goes to its winner. */
export function awardsWonBy(awards: WeeklyAwards | null | undefined, ownerId: string | null | undefined): AwardKind[] {
  if (!awards || !ownerId) return []
  return AWARD_KINDS.filter((k) =>
    k === 'topScore' || k === 'lowScore' ? awards[k]?.ownerId === ownerId : awards[k]?.winnerOwnerId === ownerId,
  )
}

/** One award, named. Null when the week has no such award or its manager is not in the payload. */
export function awardView(h2h: Pick<LeagueH2HPayload, 'managers' | 'latestWeekAwards'>, kind: AwardKind): AwardView | null {
  const awards = h2h.latestWeekAwards
  if (!awards) return null
  const manager = (id: string) => h2h.managers.find((m) => m.ownerId === id) ?? null
  if (kind === 'topScore' || kind === 'lowScore') {
    const rec = awards[kind]
    const m = rec ? manager(rec.ownerId) : null
    if (!rec || !m) return null
    return {
      kind,
      label: AWARD_LABEL[kind],
      season: awards.season,
      week: awards.week,
      ownerId: rec.ownerId,
      name: m.name,
      teamName: m.teamName ?? null,
      avatar: m.avatar ?? null,
      value: rec.points,
      unit: 'pts',
      opponentName: null,
    }
  }
  const game = awards[kind]
  const winner = game ? manager(game.winnerOwnerId) : null
  if (!game || !winner) return null
  return {
    kind,
    label: AWARD_LABEL[kind],
    season: awards.season,
    week: awards.week,
    ownerId: game.winnerOwnerId,
    name: winner.name,
    teamName: winner.teamName ?? null,
    avatar: winner.avatar ?? null,
    value: game.margin,
    unit: 'margin',
    opponentName: manager(game.loserOwnerId)?.name ?? null,
  }
}
