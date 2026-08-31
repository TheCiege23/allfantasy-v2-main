import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { openaiChatText } from '@/lib/openai-client'
import { ingest, storylineGenerated } from '@/lib/notification-engine'
import { getInjuries } from '@/lib/injuries'
import { resolveLeagueAccess } from '@/lib/league-access'
import { buildRosterLabelMap } from '@/lib/scoring-engine/resolveTeamLabels'

/**
 * /api/league-story — the weekly league storyline.
 *
 * 🛑 THIS ROUTE INVENTED THE WEEK IT WAS WRITING ABOUT, AND THEN NOTIFIED EVERYONE.
 *
 * It read the league name, team names and a sport-wide injury list — no matchup, no score, no
 * record, nothing about what actually happened — then asked the model at temperature 0.8 to
 * "Write 2-3 paragraphs. Be dramatic and fun. Reference specific teams" with no
 * anti-fabrication constraint. Every game, score and outcome in the output was therefore
 * invented, persisted as `source: 'ai'`, and pushed to every claimed manager in the league via
 * `storylineGenerated`. A fabricated recap that arrives as a notification is not harmless
 * colour: it is the product telling a manager their week went a way it did not.
 *
 * 🛑 AND IT HAD NO MEMBERSHIP GATE. The check was session-only, so any signed-in user could
 * POST any `leagueId` and push a storyline notification into a league they had nothing to do
 * with. That is notification injection across league boundaries, which is why the gate below
 * is a 403 rather than a nicety.
 *
 * Now: real results or nothing. The story is grounded in `team_week_results` — the same table
 * and the same `buildRosterLabelMap` join that /api/leagues/[leagueId]/scoring/matchups uses.
 * That source was chosen deliberately: `WeeklyMatchup.rosterId` is an Int that does NOT join
 * to the label map, so grounding on it would have produced confidently mislabelled teams —
 * the same class of error this fix exists to remove.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  const session = (await getServerSession(authOptions as never)) as { user?: { id?: string } } | null
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const { leagueId, season, week, storyType = 'weekly_storyline' } = body as {
    leagueId?: string
    season?: number
    week?: number
    storyType?: string
  }

  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId required' }, { status: 400 })
  }

  /*
   * Membership, not just authentication. This route WRITES a row and fans a notification out
   * to every claimed manager, so a non-member reaching it is an injection vector rather than
   * an information leak. Same predicate and same 403 shape as the other league routes.
   */
  const access = await resolveLeagueAccess(leagueId, session.user.id)
  if (!access?.isMember) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { name: true, sport: true, leagueSize: true, season: true },
    })
    if (!league) {
      return NextResponse.json({ error: 'League not found' }, { status: 404 })
    }

    const resolvedSeason = season ?? league.season ?? new Date().getFullYear()

    /*
     * ⚠ A WEEK NUMBER IS NOT A WEEK OF FOOTBALL. Without a specific week there is no set of
     * results to write about, and the old route happily accepted `week: undefined`, printed
     * "Week ?" as the title, and let the model imagine the rest.
     */
    if (!Number.isFinite(Number(week))) {
      return NextResponse.json(
        { error: 'week required', detail: 'A storyline is about a specific week; pass one.' },
        { status: 400 },
      )
    }
    const resolvedWeek = Number(week)

    const [results, labels] = await Promise.all([
      prisma.teamWeekResult.findMany({
        where: { leagueId, season: resolvedSeason, week: resolvedWeek },
        orderBy: { totalPoints: 'desc' },
      }),
      buildRosterLabelMap(leagueId),
    ])

    /*
     * 🛑 REFUSE RATHER THAN INVENT. This is the whole fix. If the week has not been played (or
     * has not synced), there is no story to tell, and the honest response is to say so — not
     * to hand the model a team list and let it fill in a slate. 409 because it is a state
     * problem the caller can retry once the sync lands, not a malformed request.
     */
    if (results.length === 0) {
      return NextResponse.json(
        {
          error: 'no_results',
          detail: `No scored results for ${league.name}, season ${resolvedSeason}, week ${resolvedWeek}. A storyline is written from real matchups; there is nothing to write about yet.`,
        },
        { status: 409 },
      )
    }

    const nameFor = (rosterId: string | null | undefined): string =>
      (rosterId ? labels.get(rosterId) : null) ?? 'Unknown team'

    // One line per team, highest score first — the only facts the model is allowed to use.
    const scoreLines = results.map((r) => {
      const opponent = r.opponentRosterId ? ` vs ${nameFor(r.opponentRosterId)}` : ' (no opponent recorded)'
      const outcome = r.winLoss ? ` [${r.winLoss}]` : ''
      return `${nameFor(r.rosterId)}: ${r.totalPoints.toFixed(1)} pts${opponent}${outcome}`
    })

    const injuries = await getInjuries(String(league.sport ?? 'NFL'), { limit: 15 })

    /*
     * Injuries come from getInjuries(sport), which is league-agnostic — those players are not
     * necessarily on any roster here. Labelling that is the difference between context and a
     * fabricated claim that a specific team lost a specific player.
     */
    const injuryLine =
      injuries.length > 0
        ? `League-wide ${league.sport} injury news (these players may NOT be on any roster in this league — do not attribute them to a team): ${injuries
            .slice(0, 8)
            .map((i) => `${i.playerName} (${i.status})`)
            .join(', ')}`
        : 'No notable league-wide injury news.'

    const prompt = [
      `League: "${league.name}" (${league.sport}, ${league.leagueSize ?? results.length} teams).`,
      `Season ${resolvedSeason}, Week ${resolvedWeek}.`,
      '',
      'ACTUAL RESULTS FOR THIS WEEK — these are the only facts you may use:',
      ...scoreLines.map((l) => `  ${l}`),
      '',
      injuryLine,
      '',
      `Story type: ${storyType}`,
      'Write 2-3 short paragraphs recapping THIS week for THIS league. Be lively and specific.',
    ].join('\n')

    const result = await openaiChatText({
      messages: [
        {
          role: 'system',
          content: [
            'You are a fantasy sports commentator recapping a real league week.',
            'DO NOT INVENT any score, result, matchup, player name, statistic, record or event.',
            'Use ONLY the results supplied in the user message. If a detail is not given, omit it',
            'rather than guessing — do not infer standings, streaks, playoff position or history',
            'that were not provided. Refer to teams only by the names given.',
          ].join(' '),
        },
        { role: 'user', content: prompt },
      ],
      /*
       * Lowered from 0.8. The job is recapping supplied facts with some flavour, and higher
       * sampling is precisely what invents a plausible extra detail nobody supplied.
       */
      temperature: 0.4,
      maxTokens: 600,
    })

    if (!result.ok) {
      return NextResponse.json({ error: 'Story generation failed' }, { status: 502 })
    }

    const storyline = await prisma.leagueStoryline.create({
      data: {
        leagueId,
        season: resolvedSeason,
        week: resolvedWeek,
        storyType,
        title: `Week ${resolvedWeek} Storyline`,
        summary: result.text.slice(0, 500),
        body: result.text,
        source: 'ai',
      },
    })

    void ingest(storylineGenerated({ leagueId, title: storyline.title, storyId: storyline.id }))

    return NextResponse.json({
      ok: true,
      storyline: { id: storyline.id, title: storyline.title, body: storyline.body },
      groundedOn: { season: resolvedSeason, week: resolvedWeek, teamsScored: results.length },
    })
  } catch (e) {
    console.error('[league-story]', e)
    return NextResponse.json({ error: 'Story generation failed' }, { status: 500 })
  }
}
