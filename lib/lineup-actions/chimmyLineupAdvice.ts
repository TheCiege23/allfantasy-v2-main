import { prisma } from '@/lib/prisma'
import type { LineupActionSummaryPayload } from '@/lib/lineup-actions/types'

/**
 * Annotates each league with its AutoCoach status for actionable lineup issues.
 *
 * This used to also generate a per-league Chimmy blurb with an Anthropic call
 * inside the loop. That ran on the signed-in home screen, once per league, on
 * every cache miss — so a 60-league account issued dozens of uncapped LLM
 * requests per load. The blurbs are gone. `chimmyAdvice` now carries either the
 * AutoCoach note or an empty string, and every consumer already hides it when
 * empty. On-demand Chimmy analysis stays on the league surfaces.
 *
 * The exported name is deliberately unchanged: `__tests__/decision-os/
 * lineup-shadow-route.test.ts` asserts on the literal call site.
 */
export async function attachChimmyAdviceToLineupSummary(
  summary: LineupActionSummaryPayload,
  userId: string
): Promise<LineupActionSummaryPayload> {
  const [profile, autoSettings] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { userId },
      select: { autoCoachGlobalEnabled: true },
    }),
    prisma.autoCoachSetting.findMany({
      where: { userId },
      include: { league: { select: { autoCoachEnabled: true } } },
    }),
  ])

  const autoCoachByLeague = new Map(
    autoSettings.map((s) => [
      s.leagueId,
      {
        enabled: s.enabled,
        blocked: s.blockedByCommissioner,
        leagueOn: s.league.autoCoachEnabled !== false,
      },
    ])
  )

  const leagues = summary.leagues.map((lg) => {
    const actionable = lg.issues.filter((x) => x.severity !== 'info')
    if (actionable.length === 0) return { ...lg, chimmyAdvice: '' }

    const ac = autoCoachByLeague.get(lg.leagueId)
    const autoCoachEnabledForLeague = Boolean(
      profile?.autoCoachGlobalEnabled !== false && ac?.enabled && ac.leagueOn && !ac?.blocked
    )
    const autoCoachHandlesIt =
      autoCoachEnabledForLeague && lg.issues.some((x) => x.type === 'injured_starter')

    return {
      ...lg,
      chimmyAdvice: autoCoachHandlesIt ? 'AutoCoach will handle this swap automatically' : '',
    }
  })

  return { ...summary, leagues }
}
