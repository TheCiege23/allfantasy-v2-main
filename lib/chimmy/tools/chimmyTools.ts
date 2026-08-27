import 'server-only'
import { buildLeagueStandingsContext } from '@/lib/chimmy/leagueStandingsGrounding'
import { buildHeadToHeadGrounding } from '@/lib/chimmy/headToHeadGrounding'
import { detectStatFamily, readStatLeaders, FAMILY_LABEL } from '@/lib/live/playerStatLeaders'
import { findUpcomingGames } from '@/lib/ai/upcomingGames'

/**
 * READ-ONLY TOOLS THE MODEL MAY CALL FOR ITSELF.
 *
 * Every one wraps a grounding builder that already exists and is already used
 * by the push path. Nothing here reaches a provider or writes anything — a tool
 * the model can invoke is a tool it can invoke in a loop, and a write in that
 * position is a write nobody authorised.
 *
 * ⚠ ABSENCE IS RETURNED AS A SENTENCE, NEVER AS EMPTY. Every refusal in this
 * assistant depends on the model being TOLD it has nothing, in words. Returning
 * `{}` or `[]` invites it to fill the gap from general knowledge in the same
 * confident voice it uses for grounded answers — which is the exact failure the
 * push path was built to prevent. So each executor returns prose that states
 * what was looked for and that it was not found.
 *
 * ⚠ THE SCHEMAS ARE DELIBERATELY NARROW. No free-form query parameter, no
 * league id from the model. The league comes from the SESSION, because a model
 * that can name a league id can name somebody else's.
 */

export type ChimmyToolContext = {
  /** From the session, never from the model. */
  leagueId: string | null
  userId: string | null
}

/** OpenAI-shaped function tools; Grok accepts these through the OpenAI SDK. */
export const CHIMMY_TOOL_SPECS = [
  {
    type: 'function' as const,
    function: {
      name: 'get_league_standings',
      description:
        "Current standings for the league the user is asking about. Use when the question involves records, rank, who is winning, or playoff position. Returns a sentence saying so if no standings are stored.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_head_to_head',
      description:
        "Every manager's all-time record against the others in this league. Use for rivalry questions — 'am I any good against him', 'who owns who'. Returns a sentence saying so if no matchup history is stored.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_upcoming_games',
      description:
        'Scheduled games that have not kicked off yet. Use for "when is the next game", "when does the season start", "what is on this week".',
      parameters: {
        type: 'object',
        properties: {
          sport: {
            type: 'string',
            description: 'NFL, NCAAF, NBA, MLB, NHL or SOCCER. Omit for all sports.',
          },
          seasonType: {
            type: 'string',
            enum: ['pre', 'regular'],
            description: 'Narrow to preseason or regular season. Omit for either.',
          },
          limit: { type: 'number', description: 'How many games to return, 1-10. Default 5.' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_stat_leaders',
      description:
        "Who leads a stat in the live play-by-play from the last few hours. Use for 'who has the most TDs today'. This is a short rolling window of live plays, NOT season totals, and it is empty when no games are on.",
      parameters: {
        type: 'object',
        properties: {
          stat: {
            type: 'string',
            description:
              'touchdowns, passing yards, rushing yards or receiving yards. Phrase it plainly.',
          },
        },
        required: ['stat'],
      },
    },
  },
] as const

/*
 * ⚠ THE MODEL REWROTE THIS INTO A CLAIM ABOUT THE USER'S DATA. Observed in
 * production: with no league selected, this sentence came back to the reader as
 * "No last-season records are stored for the KBFL league" — turning "I could not
 * look" into "I looked and your data is missing". The second is far worse than
 * unhelpful; it tells a commissioner their league is empty when it was never
 * queried, and in the same session the model went on to invent "all 18 teams
 * begin at 0-0 with equal FAAB budgets" for a 32-team league.
 *
 * So the sentence now names the distinction and forbids the paraphrase outright.
 * A tool result is the only thing standing between an empty lookup and a
 * confident lie, and it has to say so in words the model cannot soften.
 */
const NO_LEAGUE =
  'NO LEAGUE IS SELECTED for this conversation, so NOTHING WAS LOOKED UP. ' +
  'This is NOT a finding about the user\'s data. You must NOT say that a league ' +
  'has no records, no standings, no roster, or is empty — you have not checked. ' +
  'You must NOT state a team count, scoring setting, FAAB budget, or any other ' +
  'league detail; none was retrieved and inventing one is the worst answer here. ' +
  'Tell the user to pick a league from the scope selector above the message box, ' +
  'or to open Chimmy from a league page, and say nothing else about their league.'

/**
 * Run one tool call and return prose for the model.
 *
 * Never throws: a tool that blew up must come back as a sentence saying it
 * could not be read, because an exception here would abort a conversation the
 * user is waiting on.
 */
export async function executeChimmyTool(
  name: string,
  rawArgs: unknown,
  ctx: ChimmyToolContext,
): Promise<string> {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>

  try {
    switch (name) {
      case 'get_league_standings': {
        if (!ctx.leagueId || !ctx.userId) return NO_LEAGUE
        const text = await buildLeagueStandingsContext(ctx.leagueId, ctx.userId)
        return text || 'No standings are stored for this league. Say so; do not estimate them.'
      }

      case 'get_head_to_head': {
        if (!ctx.leagueId) return NO_LEAGUE
        const h2h = await buildHeadToHeadGrounding(ctx.leagueId)
        return (
          h2h?.text ||
          'No head-to-head history is stored for this league. Say so; do not describe a rivalry you cannot see.'
        )
      }

      case 'get_upcoming_games': {
        const sport = typeof args.sport === 'string' ? args.sport.toUpperCase() : null
        const seasonType =
          args.seasonType === 'pre' || args.seasonType === 'regular' ? args.seasonType : null
        const limit =
          typeof args.limit === 'number' && Number.isFinite(args.limit)
            ? Math.max(1, Math.min(10, Math.floor(args.limit)))
            : 5

        const { games } = await findUpcomingGames(
          { kind: 'next-game', sport, seasonType },
          new Date(),
          limit,
        )
        if (games.length === 0) {
          return `No upcoming ${[seasonType === 'pre' ? 'preseason' : null, sport].filter(Boolean).join(' ') || 'games'} are on the stored schedule. Say so rather than naming a game.`
        }
        return games
          .map((g) => {
            const kind = g.seasonType === 'pre' ? ' (preseason)' : ''
            const week = typeof g.week === 'number' ? `, week ${g.week}` : ''
            return `${g.awayTeam} at ${g.homeTeam}${kind}${week} — ${new Date(g.startTime).toISOString()}`
          })
          .join('\n')
      }

      case 'get_stat_leaders': {
        const asked = typeof args.stat === 'string' ? args.stat : 'touchdowns'
        const family = detectStatFamily(asked) ?? 'touchdowns'
        const { leaders, eventsScanned } = await readStatLeaders(family, 5)

        if (eventsScanned === 0) {
          return 'The live play feed is empty — no games in the last few hours, or none polled. This is NOT the same as nobody having scored, and must not be reported as a zero.'
        }
        if (leaders.length === 0) {
          return `${eventsScanned} live plays are in the window and none of them were ${FAMILY_LABEL[family]}.`
        }
        return [
          `Leaders in ${FAMILY_LABEL[family]} from ${eventsScanned} live plays in the last few hours (not season totals):`,
          ...leaders.map(
            (l, i) => `${i + 1}. ${l.playerName}${l.team ? ` (${l.team})` : ''} — ${l.total}`,
          ),
        ].join('\n')
      }

      default:
        return `There is no tool called ${name}. Answer from what you already have, or say you cannot.`
    }
  } catch {
    return `The ${name} lookup failed. Say that you could not read it rather than answering as though you had.`
  }
}
