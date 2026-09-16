import type { PecrIntent } from '@/lib/chimmy-chat/question-routing'
import type { ChimmyOrchestrationIntent } from '@/lib/chimmy-orchestration/types'
import type { ChimmyAgentType } from '@/lib/agents/pipeline'

/**
 * Real fantasy questions, and what `/api/chat/chimmy` SHOULD decide about each
 * before a model ever sees it.
 *
 * Four decisions are scored, because the route makes four and they disagree:
 *
 * - `pecr`          — `classifyPecrIntent`. Drives the league requirement.
 * - `grounding`     — `requiresLeagueGrounding`. `true` means a user with no
 *                     league selected is asked which league (412), never answered.
 * - `orchestration` — `classifyChimmyIntent`. Rendered into the prompt as "you
 *                     are handling a <label>", so a misroute tells the model it
 *                     is answering a different question.
 * - `agent`         — `inferAgentFromMessage`. Picks the specialist prompt file
 *                     and, through the answer contract, the answer type the
 *                     confidence rubric scores.
 *
 * An expectation is either one value or the set of values that are all
 * defensible. Where a question genuinely has no settled answer the dimension is
 * `null` and is not scored — an eval that asserts a coin-flip teaches nothing.
 *
 * ⚠ `gaps` RECORDS WHAT IS WRONG TODAY, EXACTLY. Each entry pins the value the
 * classifier returns now, so the suite stays green while the defect stands and
 * goes RED the moment anything changes — including a fix. A fix therefore has to
 * delete its gap entry, which is how the scoreboard stays true. Never widen an
 * expectation to make a gap disappear.
 *
 * 🛑 TWO EXPECTED AGENTS DO NOT EXIST. `general_research` and `commissioner` are
 * the specialist workflows the Chimmy brief asks for (item 4) that the agent
 * taxonomy has no entry for, so today those questions are served by whatever
 * the fallthrough picks — almost always `trade_analyzer`. They are expressed as
 * expectations on purpose: the gap IS the missing workflow.
 */

export type ExpectedAgent = ChimmyAgentType | 'general_research' | 'commissioner'

export type EvalCategory =
  | 'trade'
  | 'waiver'
  | 'lineup'
  | 'draft'
  | 'commissioner'
  | 'research'
  | 'college'
  | 'kicker'
  | 'idp'
  | 'platform_settings'
  | 'real_world'
  /** Questions that tripped a substring match in a player's name or an ordinary word. */
  | 'name_collision'

type Expect<T> = T | readonly T[] | null

export type Dimension = 'pecr' | 'grounding' | 'orchestration' | 'agent'

export type EvalCase = {
  q: string
  category: EvalCategory
  pecr: Expect<PecrIntent>
  grounding: Expect<boolean>
  orchestration: Expect<ChimmyOrchestrationIntent>
  agent: Expect<ExpectedAgent>
  gaps?: Partial<Record<Dimension, { today: string | boolean; why: string }>>
}

const NO_GENERAL_AGENT = 'no general-research specialist exists; the fallthrough is trade_analyzer'
const NO_COMMISH_AGENT = 'no commissioner specialist exists'
const START_IS_CALENDAR = 'bare `start` in the start_sit branch reads the calendar verb as a lineup decision'

export const CHIMMY_EVAL_CORPUS: readonly EvalCase[] = [
  // ── trade ────────────────────────────────────────────────────────────────
  {
    q: 'Should I trade Josh Allen for Bijan Robinson in my dynasty league?',
    category: 'trade',
    pecr: 'trade',
    grounding: true,
    orchestration: 'trade',
    agent: ['trade_analyzer', 'dynasty_legacy'],
  },
  {
    q: 'Is this a fair deal: my Chase for his Nacua and a 2027 1st?',
    category: 'trade',
    pecr: 'trade',
    grounding: true,
    orchestration: 'trade',
    agent: 'trade_analyzer',
  },
  {
    q: 'What would you give for Puka Nacua?',
    category: 'trade',
    pecr: 'trade',
    grounding: true,
    orchestration: 'trade',
    agent: 'trade_analyzer',
    gaps: { orchestration: { today: 'general', why: 'the trade branch has no `give` vocabulary' } },
  },
  {
    q: 'Should I accept this trade offer?',
    category: 'trade',
    pecr: 'trade',
    grounding: true,
    orchestration: 'trade',
    agent: 'trade_analyzer',
  },
  {
    q: 'Who wins this trade: CeeDee Lamb for Jahmyr Gibbs?',
    category: 'trade',
    pecr: 'trade',
    grounding: true,
    orchestration: 'trade',
    agent: 'trade_analyzer',
  },

  // ── waiver ───────────────────────────────────────────────────────────────
  {
    q: 'Who should I pick up this week?',
    category: 'waiver',
    pecr: 'waiver',
    grounding: true,
    orchestration: 'waiver',
    agent: 'waiver_wire',
    gaps: { agent: { today: 'trade_analyzer', why: 'the agent waiver branch knows `waiver|faab|claim` but not `pick up`' } },
  },
  {
    q: 'How much FAAB should I bid on Bauer Sharp?',
    category: 'waiver',
    pecr: 'waiver',
    grounding: true,
    orchestration: 'waiver',
    agent: 'waiver_wire',
  },
  {
    q: 'Should I drop Tyler Lockett for a streaming defense?',
    category: 'waiver',
    pecr: 'waiver',
    grounding: true,
    orchestration: 'waiver',
    agent: 'waiver_wire',
    gaps: { agent: { today: 'trade_analyzer', why: 'the agent waiver branch has no `drop`' } },
  },
  {
    q: 'Best waiver adds at running back?',
    category: 'waiver',
    pecr: 'waiver',
    grounding: true,
    orchestration: 'waiver',
    agent: 'waiver_wire',
  },
  {
    q: 'Is anyone worth adding off the wire?',
    category: 'waiver',
    pecr: 'waiver',
    grounding: true,
    orchestration: 'waiver',
    agent: 'waiver_wire',
    gaps: { agent: { today: 'trade_analyzer', why: 'the agent waiver branch has no `add` or `wire`' } },
  },

  // ── lineup ───────────────────────────────────────────────────────────────
  {
    q: 'Should I start Jayden Daniels or Jared Goff?',
    category: 'lineup',
    pecr: 'roster',
    grounding: true,
    orchestration: 'start_sit',
    agent: 'matchup_simulator',
    gaps: { agent: { today: 'trade_analyzer', why: 'the agent knows only the literal `start/sit` / `start sit`' } },
  },
  {
    q: 'Start Bijan or Gibbs?',
    category: 'lineup',
    pecr: 'roster',
    grounding: true,
    orchestration: 'start_sit',
    agent: 'matchup_simulator',
    gaps: { agent: { today: 'trade_analyzer', why: 'the agent knows only the literal `start/sit` / `start sit`' } },
  },
  {
    q: 'Who do I bench this week?',
    category: 'lineup',
    pecr: 'roster',
    grounding: true,
    orchestration: 'start_sit',
    agent: 'matchup_simulator',
    gaps: {
      orchestration: { today: 'general', why: 'the start_sit branch knows `bench him` but not a bare `bench`' },
      agent: { today: 'trade_analyzer', why: 'the agent has no bench vocabulary' },
    },
  },
  {
    q: 'Who should I play at flex?',
    category: 'lineup',
    pecr: 'roster',
    grounding: true,
    orchestration: 'start_sit',
    agent: 'matchup_simulator',
    gaps: { agent: { today: 'trade_analyzer', why: 'the agent has no flex vocabulary' } },
  },
  {
    q: 'Sit Travis Kelce?',
    category: 'lineup',
    pecr: 'roster',
    grounding: true,
    orchestration: 'start_sit',
    agent: 'matchup_simulator',
    gaps: { agent: { today: 'trade_analyzer', why: 'the agent knows only the literal `start/sit` / `start sit`' } },
  },
  {
    q: 'Set my lineup for Sunday',
    category: 'lineup',
    pecr: 'roster',
    grounding: true,
    orchestration: 'start_sit',
    agent: 'matchup_simulator',
    gaps: { agent: { today: 'trade_analyzer', why: 'the agent has no lineup vocabulary' } },
  },
  {
    q: 'Who is my opponent this week?',
    category: 'lineup',
    pecr: 'general',
    grounding: true,
    orchestration: 'matchup',
    agent: 'matchup_simulator',
    gaps: { agent: { today: 'trade_analyzer', why: 'the agent knows `matchup` but not `opponent`' } },
  },
  {
    q: 'Given the matchup, is Kittle startable?',
    category: 'lineup',
    pecr: ['general', 'roster'],
    grounding: null,
    orchestration: ['matchup', 'start_sit'],
    agent: 'matchup_simulator',
  },

  // ── draft ────────────────────────────────────────────────────────────────
  {
    q: 'Who should I draft at 1.03?',
    category: 'draft',
    pecr: 'draft',
    grounding: false,
    orchestration: 'draft',
    agent: 'draft_assistant',
    gaps: { orchestration: { today: 'general', why: 'the draft branch has no bare `draft` verb' } },
  },
  {
    q: "What is Brock Bowers' ADP?",
    category: 'draft',
    pecr: 'draft',
    grounding: false,
    orchestration: 'draft',
    agent: 'draft_assistant',
  },
  {
    q: 'Give me my draft tiers for tight ends',
    category: 'draft',
    pecr: 'draft',
    grounding: true,
    orchestration: 'draft',
    agent: 'draft_assistant',
    gaps: { orchestration: { today: 'player_value', why: '`tiers` routes to player_value ahead of the draft branch' } },
  },
  {
    q: "When is my league's draft?",
    category: 'draft',
    pecr: 'draft',
    grounding: true,
    orchestration: ['draft', 'general'],
    agent: 'draft_assistant',
    gaps: {
      agent: {
        today: 'trade_analyzer',
        why: 'the calendar guard excludes `draft` from draft_assistant when the question starts with `when`',
      },
    },
  },
  {
    q: 'Mock draft for a 12-team superflex league',
    category: 'draft',
    pecr: 'draft',
    grounding: false,
    orchestration: 'draft',
    agent: 'draft_assistant',
  },
  {
    q: 'Who should I pick in round 3 of my draft?',
    category: 'draft',
    pecr: 'draft',
    grounding: true,
    orchestration: 'draft',
    agent: 'draft_assistant',
    gaps: { orchestration: { today: 'general', why: 'the draft branch has no bare `pick` or `draft`' } },
  },

  // ── commissioner ─────────────────────────────────────────────────────────
  {
    q: 'Should I veto this trade as commissioner?',
    category: 'commissioner',
    pecr: 'trade',
    grounding: true,
    orchestration: 'commissioner',
    agent: 'commissioner',
    gaps: {
      orchestration: { today: 'trade', why: 'classifyChimmyIntent never returns `commissioner`, though the type allows it' },
      agent: { today: 'trade_analyzer', why: NO_COMMISH_AGENT },
    },
  },
  {
    q: 'How do I change the playoff format in my league?',
    category: 'commissioner',
    pecr: 'general',
    grounding: true,
    orchestration: 'commissioner',
    agent: 'commissioner',
    gaps: {
      orchestration: { today: 'general', why: 'classifyChimmyIntent never returns `commissioner`' },
      agent: { today: 'trade_analyzer', why: NO_COMMISH_AGENT },
    },
  },
  {
    q: 'Is there collusion in my league?',
    category: 'commissioner',
    pecr: 'general',
    grounding: true,
    orchestration: ['commissioner', 'manager_psychology'],
    agent: 'commissioner',
    gaps: { agent: { today: 'trade_analyzer', why: NO_COMMISH_AGENT } },
  },
  {
    q: 'Can I make a rule change mid-season as commish?',
    category: 'commissioner',
    pecr: 'general',
    grounding: null,
    orchestration: 'commissioner',
    agent: 'commissioner',
    gaps: {
      orchestration: { today: 'general', why: 'classifyChimmyIntent never returns `commissioner`' },
      agent: { today: 'trade_analyzer', why: NO_COMMISH_AGENT },
    },
  },
  {
    q: 'How many teams make the playoffs in my league?',
    category: 'commissioner',
    pecr: 'general',
    grounding: true,
    orchestration: ['general', 'commissioner'],
    agent: ['general_research', 'commissioner'],
    gaps: { agent: { today: 'trade_analyzer', why: NO_COMMISH_AGENT } },
  },

  // ── general research ─────────────────────────────────────────────────────
  {
    q: 'Who is the best wide receiver this year?',
    category: 'research',
    pecr: 'general',
    grounding: false,
    orchestration: ['general', 'player_value'],
    agent: 'general_research',
    gaps: { agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT } },
  },
  {
    q: "What's the injury status of Christian McCaffrey?",
    category: 'research',
    pecr: 'general',
    grounding: false,
    orchestration: ['general', 'injury', 'player_value'],
    agent: 'general_research',
    gaps: { agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT } },
  },
  {
    q: 'Give me a rundown on Bijan Robinson',
    category: 'research',
    pecr: 'general',
    grounding: false,
    orchestration: ['general', 'player_value'],
    agent: 'general_research',
    gaps: { agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT } },
  },
  {
    q: 'Is my team a contender or should I rebuild?',
    category: 'research',
    pecr: 'general',
    grounding: true,
    orchestration: ['general', 'league_strength'],
    agent: 'dynasty_legacy',
  },
  {
    q: 'Who are the best dynasty rookies for next season?',
    category: 'research',
    pecr: 'general',
    grounding: false,
    orchestration: ['draft', 'player_value'],
    agent: ['draft_assistant', 'dynasty_legacy'],
    gaps: {
      grounding: {
        today: true,
        why: '`next season` forces a league for a ranking question that has nothing league-specific in it',
      },
      orchestration: { today: 'general', why: 'no branch knows `rookies`' },
    },
  },

  // ── college / devy ───────────────────────────────────────────────────────
  {
    q: 'Is Arch Manning a first-round devy pick?',
    category: 'college',
    pecr: 'draft',
    grounding: false,
    orchestration: ['draft', 'player_value'],
    agent: ['draft_assistant', 'c2c_specialist', 'dynasty_legacy'],
    gaps: {
      orchestration: { today: 'general', why: 'no branch knows `devy`' },
      agent: { today: 'trade_analyzer', why: 'no agent branch knows `devy`' },
    },
  },
  {
    q: 'When does the college football season start?',
    category: 'college',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
    gaps: {
      orchestration: { today: 'start_sit', why: START_IS_CALENDAR },
      agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT },
    },
  },
  {
    q: 'Best college football players to stash in devy?',
    category: 'college',
    pecr: 'general',
    grounding: false,
    orchestration: ['general', 'player_value', 'draft'],
    agent: ['draft_assistant', 'c2c_specialist', 'dynasty_legacy'],
    gaps: { agent: { today: 'trade_analyzer', why: 'no agent branch knows `devy` or `stash`' } },
  },
  {
    q: 'Should I trade my devy Jeremiah Smith for a 2027 first?',
    category: 'college',
    pecr: 'trade',
    grounding: true,
    orchestration: 'trade',
    agent: ['trade_analyzer', 'dynasty_legacy'],
  },
  {
    q: 'How does College to Canton scoring work?',
    category: 'college',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'c2c_specialist',
  },

  // ── kickers ──────────────────────────────────────────────────────────────
  {
    /*
     * `stream` is NOT waiver vocabulary for PECR, deliberately: "where can I
     * stream the game" would then 412. `general` is the safe failure here — the
     * question is answered, only without the league's free-agent pool.
     */
    q: 'Best kicker to stream this week?',
    category: 'kicker',
    pecr: ['general', 'waiver'],
    grounding: null,
    orchestration: 'waiver',
    agent: 'waiver_wire',
    gaps: { agent: { today: 'trade_analyzer', why: 'the agent waiver branch has no `stream`' } },
  },
  {
    q: 'Should I start Brandon Aubrey or Jake Elliott?',
    category: 'kicker',
    pecr: 'roster',
    grounding: true,
    orchestration: 'start_sit',
    agent: 'matchup_simulator',
    gaps: { agent: { today: 'trade_analyzer', why: 'the agent knows only the literal `start/sit` / `start sit`' } },
  },
  {
    q: 'Is Brandon Aubrey worth rostering?',
    category: 'kicker',
    pecr: 'roster',
    grounding: true,
    orchestration: ['player_value', 'waiver'],
    agent: 'waiver_wire',
    gaps: { agent: { today: 'trade_analyzer', why: 'the agent has no roster vocabulary' } },
  },
  {
    q: 'How many points do kickers get for a 50-yard field goal?',
    category: 'kicker',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
    gaps: { agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT } },
  },
  {
    q: 'Who is the best available kicker on waivers?',
    category: 'kicker',
    pecr: 'waiver',
    grounding: true,
    orchestration: 'waiver',
    agent: 'waiver_wire',
  },

  // ── IDP ──────────────────────────────────────────────────────────────────
  {
    q: 'Is Micah Parsons a top-5 IDP?',
    category: 'idp',
    pecr: 'general',
    grounding: false,
    orchestration: ['general', 'player_value'],
    agent: 'general_research',
    gaps: { agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT } },
  },
  {
    q: 'Best IDP linebacker to add?',
    category: 'idp',
    pecr: 'waiver',
    grounding: true,
    orchestration: 'waiver',
    agent: 'waiver_wire',
    gaps: { agent: { today: 'trade_analyzer', why: 'the agent waiver branch has no `add`' } },
  },
  {
    q: 'How many points is a sack worth in my league?',
    category: 'idp',
    pecr: 'general',
    grounding: true,
    orchestration: ['general', 'commissioner'],
    agent: ['general_research', 'commissioner'],
    gaps: {
      orchestration: { today: 'player_value', why: '`worth` reads a scoring-rule question as a player valuation' },
      agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT },
    },
  },
  {
    q: 'Should I start Fred Warner or Roquan Smith at LB?',
    category: 'idp',
    pecr: 'roster',
    grounding: true,
    orchestration: 'start_sit',
    agent: 'matchup_simulator',
    gaps: { agent: { today: 'trade_analyzer', why: 'the agent knows only the literal `start/sit` / `start sit`' } },
  },
  {
    q: 'Who are the top EDGE rushers in IDP rankings?',
    category: 'idp',
    pecr: 'draft',
    grounding: false,
    orchestration: ['general', 'player_value', 'draft'],
    agent: ['draft_assistant', 'general_research'],
    gaps: {
      agent: {
        today: 'power_rankings',
        why: '`rankings` sends a PLAYER ranking question to the agent that ranks league TEAMS',
      },
    },
  },
  {
    q: 'Explain how IDP scoring works',
    category: 'idp',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
    gaps: { agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT } },
  },

  // ── platform & scoring settings ──────────────────────────────────────────
  {
    q: 'How does superflex scoring work?',
    category: 'platform_settings',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
    gaps: {
      orchestration: { today: 'start_sit', why: '`superflex` is start_sit vocabulary even in a rules question' },
      agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT },
    },
  },
  {
    q: "What are my league's scoring settings?",
    category: 'platform_settings',
    pecr: 'general',
    grounding: true,
    orchestration: 'general',
    agent: ['general_research', 'commissioner'],
    gaps: { agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT } },
  },
  {
    q: 'Is this a TE premium league?',
    category: 'platform_settings',
    pecr: 'general',
    grounding: null,
    orchestration: 'general',
    agent: 'general_research',
    gaps: { agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT } },
  },
  {
    q: 'How do I import my Sleeper league?',
    category: 'platform_settings',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
    gaps: { agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT } },
  },
  {
    q: 'Does ESPN or Yahoo support keeper leagues?',
    category: 'platform_settings',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
    gaps: { agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT } },
  },
  {
    q: 'How do MFL and Fantrax handle IR slots?',
    category: 'platform_settings',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
    gaps: { agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT } },
  },
  {
    q: 'What is half PPR?',
    category: 'platform_settings',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
    gaps: { agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT } },
  },
  {
    q: "Is Ja'Marr Chase worth more in PPR or standard?",
    category: 'platform_settings',
    pecr: 'general',
    grounding: false,
    orchestration: 'player_value',
    agent: ['player_comparison', 'general_research'],
    gaps: { agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT } },
  },
  {
    q: 'Is Josh Allen worth more in a 2QB league?',
    category: 'platform_settings',
    pecr: 'general',
    grounding: false,
    orchestration: 'player_value',
    agent: 'general_research',
    gaps: { agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT } },
  },

  // ── real-world sport, not fantasy ────────────────────────────────────────
  {
    q: 'Who scored in the Champions League last night?',
    category: 'real_world',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
    gaps: { agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT } },
  },
  {
    q: 'When does the season start?',
    category: 'real_world',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
    gaps: {
      orchestration: { today: 'start_sit', why: START_IS_CALENDAR },
      agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT },
    },
  },
  {
    q: 'What time does the Chiefs game start tonight?',
    category: 'real_world',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
    gaps: {
      orchestration: { today: 'start_sit', why: START_IS_CALENDAR },
      agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT },
    },
  },
  {
    q: 'Did the 49ers win?',
    category: 'real_world',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
    gaps: { agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT } },
  },
  {
    q: 'When is the NFL draft?',
    category: 'real_world',
    pecr: 'draft',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
    gaps: { agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT } },
  },
  {
    q: 'Tell me about free agency this year',
    category: 'real_world',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
    gaps: { agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT } },
  },

  // ── substring collisions: every one of these was refused before 2026-09-16 ──
  {
    q: 'Is Ladd McConkey a WR1?',
    category: 'name_collision',
    pecr: 'general',
    grounding: false,
    orchestration: ['general', 'player_value'],
    agent: 'general_research',
    gaps: { agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT } },
  },
  {
    q: 'Jordan Addison rest-of-season outlook',
    category: 'name_collision',
    pecr: 'general',
    grounding: false,
    orchestration: ['general', 'player_value'],
    agent: 'general_research',
    gaps: { agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT } },
  },
  {
    q: 'Is Tee Higgins an ideal WR2?',
    category: 'name_collision',
    pecr: 'general',
    grounding: false,
    orchestration: ['general', 'player_value'],
    agent: 'general_research',
    gaps: { agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT } },
  },
  {
    q: 'George Pickens outlook for 2026',
    category: 'name_collision',
    pecr: 'general',
    grounding: false,
    orchestration: ['general', 'player_value'],
    agent: 'general_research',
    gaps: { agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT } },
  },
  {
    q: 'Frank Gore career rushing yards',
    category: 'name_collision',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
    gaps: { agent: { today: 'trade_analyzer', why: NO_GENERAL_AGENT } },
  },
  {
    q: 'How do I claim my team?',
    category: 'name_collision',
    pecr: 'general',
    grounding: null,
    orchestration: 'general',
    agent: 'general_research',
    gaps: {
      agent: { today: 'waiver_wire', why: 'bare `claim` sends a team-claiming (import) question to the waiver agent' },
    },
  },
]
