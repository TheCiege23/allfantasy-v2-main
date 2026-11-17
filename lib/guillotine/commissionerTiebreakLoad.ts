import { prisma } from '@/lib/prisma'
import {
  COMMISSIONER_TIEBREAKS_KEY,
  decisionDeadline,
  readCommissionerTiebreak,
  tiebreakState,
  validateTiebreakDecision,
  type CommissionerTiebreakState,
} from './commissionerTiebreak'
import { saveCommissionerDecision } from './commissionerTiebreakStore'
import { resolveRosterDisplayNames } from './rosterDisplayNames'

export type CommissionerTiebreakView = {
  key: string
  week: number
  state: Exclude<CommissionerTiebreakState, 'none'>
  needed: number
  deadline: string
  decidedAt: string | null
  teams: Array<{ rosterId: string; name: string; points: number | null; chosen: boolean }>
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

/** The league's chop ties that reached "Commissioner decides", newest first (at most five). */
export async function loadCommissionerTiebreaks(leagueId: string, now = new Date()): Promise<CommissionerTiebreakView[]> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const all = isRecord(league?.settings) ? league!.settings[COMMISSIONER_TIEBREAKS_KEY] : null
  if (!isRecord(all)) return []
  const entries = Object.keys(all)
    .map((key) => ({ key, entry: readCommissionerTiebreak(league!.settings, key) }))
    .filter((x): x is { key: string; entry: NonNullable<typeof x.entry> } => x.entry != null)
    .sort((a, b) => Date.parse(b.entry.requestedAt) - Date.parse(a.entry.requestedAt))
    .slice(0, 5)
  if (!entries.length) return []

  const rosterIds = [...new Set(entries.flatMap((x) => x.entry.tiedRosterIds))]
  const [names, scores] = await Promise.all([
    resolveRosterDisplayNames(leagueId, rosterIds),
    prisma.guillotinePeriodScore.findMany({
      where: { leagueId, rosterId: { in: rosterIds }, weekOrPeriod: { in: entries.map((x) => Number(x.key.split(':')[1])).filter(Number.isFinite) } },
      select: { rosterId: true, weekOrPeriod: true, season: true, periodPoints: true },
    }),
  ])

  return entries.map(({ key, entry }) => {
    const [seasonPart, weekPart] = key.split(':')
    const week = Number(weekPart)
    const season = Number(seasonPart)
    return {
      key,
      week,
      state: tiebreakState(entry, now) as Exclude<CommissionerTiebreakState, 'none'>,
      needed: entry.needed,
      deadline: decisionDeadline(entry).toISOString(),
      decidedAt: entry.decidedAt ?? null,
      teams: entry.tiedRosterIds.map((rosterId, i) => {
        const score = scores.find((s) => s.rosterId === rosterId && s.weekOrPeriod === week && (!Number.isFinite(season) || s.season == null || s.season === season))
        return {
          rosterId,
          name: names.get(rosterId) ?? `Team ${i + 1}`,
          points: score ? Math.round(score.periodPoints * 100) / 100 : null,
          chosen: entry.decidedRosterIds?.includes(rosterId) ?? false,
        }
      }),
    }
  })
}

/** Record the commissioner's pick. The chop follows on the next score sync (within about five minutes). */
export function decideCommissionerTiebreak(args: { leagueId: string; userId: string; key: unknown; rosterIds: unknown; now?: Date }) {
  const now = args.now ?? new Date()
  if (typeof args.key !== 'string' || !/^[^:]+:\d+$/.test(args.key)) {
    return Promise.resolve({ ok: false as const, error: 'Which week? Send the tie you are deciding.', status: 400 })
  }
  return saveCommissionerDecision({
    leagueId: args.leagueId,
    key: args.key,
    userId: args.userId,
    now,
    check: (entry) => validateTiebreakDecision(entry, args.rosterIds, now),
  })
}
