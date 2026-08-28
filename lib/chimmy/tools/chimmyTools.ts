import 'server-only'
import { buildLeagueStandingsContext } from '@/lib/chimmy/leagueStandingsGrounding'
import { buildHeadToHeadGrounding } from '@/lib/chimmy/headToHeadGrounding'
import { detectStatFamily, readStatLeaders, FAMILY_LABEL } from '@/lib/live/playerStatLeaders'
import { findUpcomingGames } from '@/lib/ai/upcomingGames'
import { findLeagueByName } from '@/lib/chimmy/tools/leagueByName'

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
 * ⚠ THE SCHEMAS ARE DELIBERATELY NARROW, AND NO TOOL TAKES A LEAGUE ID. A model
 * that can pass a league id can pass somebody else's. `find_league_by_name` is
 * the single exception to the league coming from the session, and it takes a
 * NAME — resolved server-side against leagues this user is demonstrably in, so
 * the id is still something only we can produce. That distinction is load
 * bearing: never add a `leagueId` parameter to any tool here.
 */

export type ChimmyToolContext = {
  /**
   * The league in scope. Starts from the SESSION and is mutable for exactly one
   * reason: `find_league_by_name` binds it after verifying membership, so the
   * user can say "KBFL" instead of picking from the scope selector. It is never
   * assigned from a model-supplied id.
   */
  leagueId: string | null
  userId: string | null
}

/** OpenAI-shaped function tools; Grok accepts these through the OpenAI SDK. */
export const CHIMMY_TOOL_SPECS = [
  {
    type: 'function' as const,
    function: {
      name: 'find_league_by_name',
      description:
        "Select one of the user's own leagues by the name they used, e.g. 'KBFL' or 'Dynasty for life'. Call this FIRST whenever the question names a league, before any other league tool — otherwise nothing is selected and the other tools have nothing to read. It takes a NAME, never an id.",
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: "The league name as the user wrote it. Do not guess or expand it.",
          },
          season: {
            type: 'number',
            description:
              'The year, if the user named one ("my record in KBFL in 2025" -> 2025). The same league exists once per season, so this is usually what separates two identically named leagues. Omit it if they did not say a year.',
          },
        },
        required: ['name'],
      },
    },
  },
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
      /*
       * ⚠ THIS TOOL BINDS `ctx.leagueId` FOR THE REST OF THE TURN. That is the
       * point: every other league tool reads the league from the context, so
       * resolving a name without binding it would be a lookup with nowhere to
       * go. The binding is safe precisely because the id never came from the
       * model — `findLeagueByName` only ever returns a league this user is
       * demonstrably a member of.
       */
      case 'find_league_by_name': {
        if (!ctx.userId) {
          return 'I cannot tell who is signed in, so I cannot look up their leagues. Say that; do not name a league.'
        }
        const asked = typeof args.name === 'string' ? args.name : ''
        const askedSeason =
          typeof args.season === 'number' && Number.isFinite(args.season) ? args.season : null
        const found = await findLeagueByName(ctx.userId, asked, askedSeason)

        if (found.kind === 'match') {
          ctx.leagueId = found.league.id
          return [
            `Selected "${found.league.name}" (${found.league.sport}, ${found.league.season} season).`,
            'It is now the league in scope — call the other league tools to read its actual data.',
          ].join(' ')
        }

        if (found.kind === 'ambiguous') {
          /*
           * Deliberately NOT picking one. Someone in sixty-five leagues has
           * several called "Dynasty something", and a confident answer about the
           * wrong one is indistinguishable from a right one.
           */
          /*
           * ⚠ LIST WHAT DIFFERS, NOT JUST THE NAME. The first version rendered
           * only names, so two rows both called "KBFL" produced "which of the
           * two KBFL leagues did you mean?" — a question the reader cannot
           * possibly answer. Season and sport are what actually separate them.
           */
          return [
            `More than one of their leagues matches "${asked}":`,
            found.candidates
              .map(
                (c) =>
                  `"${c.name}" (${c.sport}, ${c.season} season${
                    typeof c.teamCount === 'number' ? `, ${c.teamCount} teams imported` : ''
                  })`,
              )
              .join('; ') + '.',
            'Ask which one they mean AND NAME THE DIFFERENCE — season, sport, or how many teams each has. Never just repeat the name, which is identical for all of them.',
            'If they already said a year, call this tool again with that season instead of asking.',
            'Do NOT pick one, and do not answer about any of them yet.',
          ].join(' ')
        }

        /*
         * ⚠ FORMAT ONLY, AND SAY SO. Legacy rows carry the settings but no
         * rosters or standings, and nothing joins them to the modern league id
         * space — so ctx.leagueId is deliberately NOT bound. Selecting a league
         * the other tools cannot read is exactly how the model was left with
         * nothing and began inventing.
         */
        if (found.kind === 'legacy') {
          const f = found.facts
          const bits = [
            f.teamCount != null ? `${f.teamCount} teams` : null,
            f.leagueType,
            f.scoringType,
            f.isSuperflex ? 'superflex' : null,
            f.isTep ? `TEP +${f.tepBonus ?? '?'} for tight ends` : 'no TEP',
          ].filter(Boolean)
          return [
            `"${f.name}" (${f.season} season) is on file as a LEGACY import.`,
            `Its format: ${bits.join(', ')}.`,
            'You may state that format. There are NO rosters, standings, records or matchups stored for it —',
            'say that plainly if asked for any of those, and do not estimate them.',
          ].join(' ')
        }

        if (found.known.length === 0) {
          return 'This user has no leagues on file at all, so there is nothing to select. Say that; do not describe a league.'
        }
        return [
          `No league of theirs is called "${asked}".`,
          `Their leagues include: ${found.known.map((c) => `"${c.name}"`).join(', ')}.`,
          'Tell them the name did not match and offer those. Do NOT answer as though a league were selected.',
        ].join(' ')
      }

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
