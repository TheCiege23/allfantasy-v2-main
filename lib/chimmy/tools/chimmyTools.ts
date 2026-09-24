import 'server-only'
import { buildLeagueStandingsContext } from '@/lib/chimmy/leagueStandingsGrounding'
import { buildHeadToHeadGrounding } from '@/lib/chimmy/headToHeadGrounding'
import { detectStatFamily, readStatLeaders, FAMILY_LABEL } from '@/lib/live/playerStatLeaders'
import { findUpcomingGames } from '@/lib/ai/upcomingGames'
import { findLeagueByName } from '@/lib/chimmy/tools/leagueByName'
import { buildAvailablePlayersContext } from '@/lib/chimmy/tools/availablePlayersTool'
import { buildMyRosterContext } from '@/lib/chimmy/tools/myRosterTool'
import { buildMyStartersPlayingContext } from '@/lib/chimmy/tools/myStartersPlayingTool'
import { buildMyRosterInjuriesContext } from '@/lib/chimmy/tools/myRosterInjuriesTool'
import { buildPlayerValueContext } from '@/lib/chimmy/tools/playerValueTool'
import { buildPlayerProjectionContext } from '@/lib/chimmy/tools/playerProjectionTool'
import { buildExplainValueContext } from '@/lib/chimmy/tools/explainValueTool'
import { buildTradeBlockContext } from '@/lib/chimmy/tradeBlockGrounding'
import { resolveNormalizedLeagueContext } from '@/lib/league-context-engine'
import { buildWaiverContext } from '@/lib/chimmy/waiverGrounding'

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
      name: 'get_league_trade_activity',
      description: 'Read trade-block listings, your pending incoming proposals and completed trade history in the selected league. Use for trade offers, trade-block targets and whether a trade makes sense for this user. Also call get_my_roster for their team and scoring before recommending a trade. Respect missing data and historical snapshot labels. External private offers may not be available; never interpret missing offers as none existing.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
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
      name: 'get_my_roster',
      description:
        "The user's OWN team in the league in scope: starters, bench, injured reserve and taxi, with each player's position, NFL team and injury status. Use for 'who should I start', 'where am I weak', 'who should I drop', or any question about their players. Returns roster FACTS only — no projections or points. Says so plainly if their team is unclaimed or unsynced.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_available_players',
      description:
        "Ranked players who are on NOBODY's roster in the league in scope — use for 'who can I pick up', 'who is on waivers', 'best free agent', 'who should I add'. Returns the highest AllFantasy market values among unrostered players. It does NOT know who is claimable: unrostered is not the same as on-waivers, and the block says so. Returns a sentence saying so if rosters have not synced or every ranked player is taken.",
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_player_value',
      description:
        "What ONE named player is worth on the AllFantasy 0-10000 value scale — use for 'what is X worth', 'is X a good trade', 'who is worth more, X or Y' (call it once per player). Works for any player, rostered or not, which is what separates it from get_available_players. Takes a NAME. Returns long-term asset value for TRADING, not a weekly points projection and not a start/sit ranking. Only a few hundred players carry a published value; it says so plainly when there is no row, and a miss is NOT evidence the player is worthless.",
      parameters: {
        type: 'object',
        properties: {
          player: {
            type: 'string',
            description:
              'The player name as the user wrote it, e.g. "Ja\'Marr Chase". Do not add or drop suffixes like Jr.',
          },
        },
        required: ['player'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_player_projection',
      description:
        "How many fantasy points ONE named player is projected for — use for 'how many points will X score', 'is X worth starting', 'what's X projected for this week'. Returns TWO DIFFERENT numbers: a per-game rate and a rest-of-season total. When a league is selected it also attempts a separate weekly number re-scored under that league's imported rules. Never call the standard number league-specific. Also returns confidence, weather provenance and the reason on file.",
      parameters: {
        type: 'object',
        properties: {
          player: {
            type: 'string',
            description: 'The player name as the user wrote it. Do not add or drop suffixes like Jr.',
          },
          sport: {
            type: 'string',
            description: 'NFL, NCAAF, NBA, MLB, NHL, NCAABB or SOCCER. Defaults to NFL.',
          },
          week: {
            type: 'number',
            description:
              'A specific week, if the user named one. Omit for the season-long baseline — do not guess the current week.',
          },
        },
        required: ['player'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'explain_value',
      description:
        "WHY a player is worth what he is worth — the step-by-step derivation: projection, the conversion to the value scale, positional scarcity, draft capital, and any compression at the top. Use when the user challenges or asks about a number ('why is he only worth that', 'how did you get that', 'that seems low'). Different from get_player_value, which reports the stored published number; this runs the engine over current inputs and can legitimately disagree with it, in which case it says so. Uses DEFAULT positional scarcity because it takes no league.",
      parameters: {
        type: 'object',
        properties: {
          player: { type: 'string', description: 'The player name as the user wrote it.' },
          sport: { type: 'string', description: 'NFL, NCAAF, NBA, MLB, NHL, NCAABB or SOCCER. Defaults to NFL.' },
        },
        required: ['player'],
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
      name: 'get_trade_block',
      description:
        "Players on this league's trade block — who is available and which team listed them. Use for 'who is on the block', 'is X available', 'who is shopping players'. Only players managers marked in AllFantasy are visible (Sleeper does not share its own block); the result says so, and your answer must too.",
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
  /*
   * ⚠ THE ONLY CROSS-LEAGUE TOOL, AND THAT IS THE POINT. Every other roster tool
   * reads the ONE league in scope, so a question spanning all of someone's teams
   * had nothing to call and the honest best reply was "pick a league". See
   * myStartersPlayingTool.ts for the production question that exposed it.
   */
  {
    type: 'function' as const,
    function: {
      name: 'get_my_starters_playing',
      description:
        "How many of the user's OWN NFL leagues have a STARTER in today's or tonight's games, and which players they are. Use for 'do I have anyone playing tonight', 'how many leagues do I have players in tonight', 'am I starting anyone in this game'. This is the ONLY tool that spans every league at once — get_my_roster reads one league and cannot answer a 'how many leagues' question. It needs NO league in scope and ignores one if set. Starters only; bench, IR and taxi are excluded. NFL only. It reports the leagues it could not read, and those gaps mean the true count can only be higher — never round up to cover them.",
      parameters: {
        type: 'object',
        properties: {
          window: {
            type: 'string',
            enum: ['today', 'tonight'],
            description:
              "'tonight' for games kicking off from 5pm Eastern, 'today' for the whole Eastern day. Use the word the user used; default to 'today' if they named neither.",
          },
        },
        required: [],
      },
    },
  },
  /*
   * The second cross-league tool. "Who's out in my leagues" had no answer anywhere: the
   * deterministic shortcut listed league-wide injuries, and get_my_roster reads one league with
   * a Sleeper-only injury field. See myRosterInjuriesTool.ts.
   */
  {
    type: 'function' as const,
    function: {
      name: 'get_my_injuries',
      description:
        "Injury designations (Out, IR, Doubtful, Questionable…) for players on the user's OWN rosters across EVERY league they are in, current season, any platform. Use for 'who's out in my leagues', 'any injuries on my teams', 'is anyone on my roster hurt', 'injury updates for my players'. Needs NO league in scope. Each player comes with the date it was reported and which leagues/slots they are on, and STARTERS who are Out are flagged. Players not listed have no report on file — that is NOT a statement that they are healthy. It lists the leagues and players it could not check; never fill those gaps from general knowledge.",
      parameters: {
        type: 'object',
        properties: {
          sport: {
            type: 'string',
            description:
              "Limit to one sport, e.g. 'NFL', 'NBA', 'MLB', 'NHL'. Omit to check every sport the user has a current league in.",
          },
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
        "Who leads a stat in the live play-by-play from the last few hours. Use ONLY for 'who has the most TDs today / right now'. This is a short rolling window of live plays, NOT season totals, and it is empty when no games are on. For season leaders ('who leads the NFL in rushing') use get_season_stat_leaders.",
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
  /*
   * REAL-WORLD STATS (NFL, college football, MLB, NBA, NHL) — lib/chimmy/tools/realStatsTools.ts
   * and dailySportStats.ts.
   * No league gate: these describe the world, not the user's league, and take no league id.
   */
  {
    type: 'function' as const,
    function: {
      name: 'get_player_season_stats',
      description:
        "A real player's season-to-date stats for NFL, college football, MLB, NBA, NHL or college basketball (yards and TDs; home runs, AVG and ERA; points, rebounds and assists; goals, assists and saves…). Use for 'what are X's stats this season', 'how many home runs does X have', 'how is X doing this year'. Takes a NAME. Returns provider totals with the time they were refreshed — real stats, not fantasy points and not projections. For NBA/NHL it may say the numbers are LAST season's; repeat that.",
      parameters: {
        type: 'object',
        properties: {
          player: { type: 'string', description: 'The player name as the user wrote it. Do not add or drop suffixes like Jr.' },
          sport: { type: 'string', description: 'NFL, NCAAF (college football), MLB, NBA, NHL or NCAAB (college basketball). Defaults to NFL — always pass the sport for anything that is not the NFL.' },
          season: { type: 'number', description: 'A year, only if the user named one (e.g. 2025). Omit for the current season.' },
        },
        required: ['player'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_player_game_log',
      description:
        "A real player's game-by-game stat lines — NFL, college football, MLB, NBA, NHL or college basketball. Use for 'how many yards did X have last week', 'X's last 3 games', 'what did X do last night', 'how did X pitch in his last start'. Takes a NAME plus the sport. Daily sports (MLB/NBA/NHL/college basketball) list games by DATE, newest first — there are no weeks. If it warns the lines are from an earlier season or that he has not played recently, do NOT present them as this season or as last night.",
      parameters: {
        type: 'object',
        properties: {
          player: { type: 'string', description: 'The player name as the user wrote it. Do not add or drop suffixes like Jr.' },
          sport: { type: 'string', description: 'NFL, NCAAF (college football), MLB, NBA, NHL or NCAAB (college basketball). Defaults to NFL — always pass the sport for anything that is not the NFL.' },
          week: { type: 'number', description: 'NFL / college only: a specific week, only if the user named one. Do not guess the current week. Ignored for MLB/NBA/NHL.' },
          last_n: { type: 'number', description: 'How many recent games (1-10). Defaults to 5.' },
          season: { type: 'number', description: 'A year, only if the user named one.' },
        },
        required: ['player'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_season_stat_leaders',
      description:
        "Who leads NFL, college football, MLB, NBA, NHL or college basketball in a stat this season. Use for 'who leads the NFL in rushing', 'home run leaders', 'who leads the NBA in scoring', 'most goals in the NHL'. Season-to-date totals; rate stats (AVG, ERA, per-game, SV%) use a minimum-games cutoff it states.",
      parameters: {
        type: 'object',
        properties: {
          stat: {
            type: 'string',
            description:
              'Football: passing_yards, passing_touchdowns, passing_interceptions, completions, rushing_yards, rushing_touchdowns, rushing_attempts, receiving_yards, receptions, receiving_touchdowns, targets, sacks, tackles, interceptions, forced_fumbles, field_goals_made. MLB: home_runs, rbi, runs, hits, stolen_bases, batting_average, strikeouts, wins, saves, era. NBA: points, rebounds, assists, steals, blocks, three_pointers_made, points_per_game, rebounds_per_game, assists_per_game. NHL: goals, assists, points, plus_minus, shots, power_play_points, penalty_minutes, hits, wins, shutouts, save_percentage, goals_against_average. NCAAB: points, rebounds, assists, steals, blocks, three_pointers_made, points_per_game, rebounds_per_game, assists_per_game.',
          },
          sport: { type: 'string', description: 'NFL, NCAAF (college football), MLB, NBA, NHL or NCAAB (college basketball). Defaults to NFL — always pass the sport for anything that is not the NFL.' },
          limit: { type: 'number', description: 'How many leaders (1-10). Defaults to 5.' },
          season: { type: 'number', description: 'A year, only if the user named one.' },
        },
        required: ['stat'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'get_real_standings',
      description:
        "The real standings for NFL, college football, MLB, NBA, NHL or college basketball — records by conference (MLB by league). Use for 'NFL standings', 'SEC standings', 'AL standings', 'NBA East standings', 'what's the Bruins' record'. NOT fantasy league standings (that is get_league_standings).",
      parameters: {
        type: 'object',
        properties: {
          sport: { type: 'string', description: 'NFL, NCAAF (college football), MLB, NBA, NHL or NCAAB (college basketball). Defaults to NFL — always pass the sport for anything that is not the NFL.' },
          group: { type: 'string', description: 'Optional conference or league to narrow to, e.g. AFC, SEC, Big Ten, AL, NL, Eastern, Western.' },
          season: { type: 'number', description: 'A year, only if the user named one.' },
        },
        required: [],
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
      case 'get_league_trade_activity': {
        if (!ctx.leagueId || !ctx.userId) return NO_LEAGUE
        const [{ buildTradeContextForChimmy }, { buildPendingTradeDecisionContext }, { buildLeagueTradeHistoryContext }] = await Promise.all([
          import('@/lib/chimmy-trade/tradeChimmyGrounding'),
          import('@/lib/chimmy-trade/pendingTradeDecisionGrounding'),
          import('@/lib/chimmy-trade/leagueTradeHistoryGrounding'),
        ])
        const results = await Promise.allSettled([
          buildTradeContextForChimmy(ctx.leagueId, ctx.userId),
          buildPendingTradeDecisionContext(ctx.leagueId, ctx.userId),
          buildLeagueTradeHistoryContext(ctx.leagueId, ctx.userId),
          executeChimmyTool('get_my_roster', {}, ctx),
        ])
        const labels = ['Trade block and league trade context', 'Incoming proposals', 'Completed trades', 'Your team and league rules']
        return results.map((r, i) => `${labels[i]}: ${r.status === 'fulfilled' && r.value ? r.value : 'No verified data available. Do not infer that no trades exist.'}`).join('\n\n')
      }

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

      case 'get_available_players': {
        if (!ctx.leagueId || !ctx.userId) return NO_LEAGUE
        return buildAvailablePlayersContext(ctx.leagueId, ctx.userId)
      }

      case 'get_my_roster': {
        if (!ctx.leagueId || !ctx.userId) return NO_LEAGUE
        const [roster, rules, waiver] = await Promise.all([
          buildMyRosterContext(ctx.leagueId, ctx.userId),
          resolveNormalizedLeagueContext({ leagueId: ctx.leagueId, userId: ctx.userId }).catch(() => null),
          buildWaiverContext(ctx.leagueId, ctx.userId).catch(() => null),
        ])
        const settings = rules?.ok ? JSON.stringify({
          league: rules.context.leagueName, season: rules.context.season,
          scoring: rules.context.scoring, slots: rules.context.roster,
          period: rules.context.matchupPeriod, lineup: rules.context.lineupBehavior,
          format: rules.context.flags, waiver: rules.context.waiver,
          lastSyncedAt: rules.context.importHealth.lastSyncedAt,
        }) : 'League rules could not be retrieved; do not substitute generic PPR or invented FAAB.'
        return [roster, `VERIFIED LEAGUE RULES: ${settings}`, waiver ?? 'Personal FAAB balance is unavailable. Do not substitute starting budget.'].join('\n\n')
      }

      case 'get_league_standings': {
        if (!ctx.leagueId || !ctx.userId) return NO_LEAGUE
        const text = await buildLeagueStandingsContext(ctx.leagueId, ctx.userId)
        return text || 'No standings are stored for this league. Say so; do not estimate them.'
      }

      case 'get_trade_block': {
        if (!ctx.leagueId || !ctx.userId) return NO_LEAGUE
        return buildTradeBlockContext(ctx.leagueId)
      }

      case 'get_head_to_head': {
        if (!ctx.leagueId) return NO_LEAGUE
        const h2h = await buildHeadToHeadGrounding(ctx.leagueId)
        return (
          h2h?.text ||
          'No head-to-head history is stored for this league. Say so; do not describe a rivalry you cannot see.'
        )
      }

      /*
       * ⚠ NO LEAGUE GATE, AND THAT IS DELIBERATE. Every other league tool bails on `NO_LEAGUE`
       * because it reads the user's own data. A published market value is a property of the
       * player and the concept — it is the same number for every user — so requiring a selected
       * league would refuse a question we can answer perfectly well.
       */
      case 'get_player_value': {
        const asked = typeof args.player === 'string' ? args.player : ''
        return await buildPlayerValueContext({ playerName: asked })
      }

      /* No league gate: the standard projection remains useful without one. When a verified
       * scope exists, the builder also computes a league-scored number from component stats. */
      case 'get_player_projection': {
        const asked = typeof args.player === 'string' ? args.player : ''
        const sport = typeof args.sport === 'string' ? args.sport : null
        /*
         * ⚠ ONLY A REAL NUMBER BECOMES A WEEK. `Number(undefined)` is NaN and `Number(null)` is 0
         * — and week 0 is a valid-looking query that matches nothing, which would read as "no
         * projection for this player" rather than "you asked for a week that does not exist".
         */
        const week = typeof args.week === 'number' && Number.isFinite(args.week)
          ? Math.floor(args.week)
          : null
        return await buildPlayerProjectionContext({ playerName: asked, sport, week, leagueId: ctx.leagueId })
      }

      case 'explain_value': {
        const asked = typeof args.player === 'string' ? args.player : ''
        const sport = typeof args.sport === 'string' ? args.sport : null
        return await buildExplainValueContext({ playerName: asked, sport })
      }

      /*
       * ⚠ NO LEAGUE GATE, AND IT IS NOT AN OVERSIGHT. Every other tool reading the
       * user's own data bails on NO_LEAGUE because it needs a league in scope.
       * This one spans ALL of them, so requiring a selected league would refuse
       * the only question it exists to answer. It still needs a USER — that is
       * what scopes it — and it reads leagues only through the membership routes
       * in `listMemberLeagues`, never from anything the model supplied.
       */
      case 'get_my_starters_playing': {
        if (!ctx.userId) {
          return 'I cannot tell who is signed in, so I cannot read their leagues. Say that; do not name a league or a count.'
        }
        const window = args.window === 'tonight' ? 'tonight' : 'today'
        return await buildMyStartersPlayingContext({ userId: ctx.userId, window })
      }

      /* Session-scoped like get_my_starters_playing: leagues come only from listMemberLeagues. */
      case 'get_my_injuries': {
        if (!ctx.userId) {
          return 'I cannot tell who is signed in, so I cannot read their leagues. Say that; do not name a player or a league.'
        }
        const sport = typeof args.sport === 'string' && args.sport.trim() ? args.sport.trim().toUpperCase() : null
        return await buildMyRosterInjuriesContext({ userId: ctx.userId, sport })
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

      case 'get_player_season_stats': {
        const { buildPlayerSeasonStatsContext } = await import('@/lib/chimmy/tools/realStatsTools')
        return await buildPlayerSeasonStatsContext({
          playerName: typeof args.player === 'string' ? args.player : '',
          sport: args.sport,
          season: args.season,
        })
      }

      case 'get_player_game_log': {
        const { buildPlayerGameLogContext } = await import('@/lib/chimmy/tools/realStatsTools')
        return await buildPlayerGameLogContext({
          playerName: typeof args.player === 'string' ? args.player : '',
          sport: args.sport,
          season: args.season,
          week: args.week,
          lastN: args.last_n,
        })
      }

      case 'get_season_stat_leaders': {
        const { buildSeasonLeadersContext } = await import('@/lib/chimmy/tools/realStatsTools')
        return await buildSeasonLeadersContext({ stat: args.stat, sport: args.sport, season: args.season, limit: args.limit })
      }

      case 'get_real_standings': {
        const { buildRealStandingsContext } = await import('@/lib/chimmy/tools/realStatsTools')
        return await buildRealStandingsContext({ sport: args.sport, season: args.season, group: args.group })
      }

      default:
        return `There is no tool called ${name}. Answer from what you already have, or say you cannot.`
    }
  } catch {
    return `The ${name} lookup failed. Say that you could not read it rather than answering as though you had.`
  }
}
