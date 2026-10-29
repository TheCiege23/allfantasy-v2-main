/**
 * The first week a guillotine league can chop: the week after its draft.
 *
 * 🛑 A LEAGUE THAT DRAFTED AFTER WEEK 1 CHOPPED THE WEEKS BEFORE ITS OWN DRAFT. The season shell
 * starts at period 0 and the configured first chop week is 1, so the driver's next week was week 1
 * — sealed long ago, past its correction window — and every surviving team was scored on games
 * played before anyone drafted. One chop per tick, every five minutes, until a champion: an NFL
 * league drafted in week 10 lost about eight teams within the hour. The late-start seat math
 * (`lateStartSeatMath.ts`) already sized such a league on "a draft held during week D can only chop
 * from week D+1"; nothing told the chop that.
 *
 * The draft's week comes from `guillotineFantasyWeekAt`, the calendar the seat math and the stat
 * sync use (0 = before week 1), at the moment the league's draft completed.
 */
import { prisma } from '@/lib/prisma'
import { guillotineFantasyWeekAt } from './lateStartSeats'

/** Null when it cannot tell (no completed draft, an unknown calendar): the configured week stands. */
export async function firstChopWeekAfterDraft(input: { leagueId: string; sport: string; season: number }): Promise<number | null> {
  const draft = await prisma.draftSession.findFirst({
    where: { leagueId: input.leagueId, status: 'completed', completedAt: { not: null } },
    orderBy: { completedAt: 'desc' },
    select: { completedAt: true },
  })
  if (!draft?.completedAt) return null
  const week = await guillotineFantasyWeekAt(input.sport, input.season, draft.completedAt)
  return week == null ? null : week + 1
}
