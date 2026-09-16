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
 * History worth keeping: the first version of this corpus (PR #924) expected two
 * agents that did not exist yet, `general_research` and `commissioner`, and
 * recorded 53 agent gaps — nearly every question the old picker missed fell
 * through to `trade_analyzer`. Both agents were added and the picker was moved
 * onto the orchestration intent in the following change, which closed all 53.
 *
 * `HELD_OUT` at the bottom was written AFTER that fix and never used to tune it.
 * It is the check that the fix generalises rather than memorising this list.
 */

export type ExpectedAgent = ChimmyAgentType

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

const TUNED: readonly EvalCase[] = [
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
  },

  // ── lineup ───────────────────────────────────────────────────────────────
  {
    q: 'Should I start Jayden Daniels or Jared Goff?',
    category: 'lineup',
    pecr: 'roster',
    grounding: true,
    orchestration: 'start_sit',
    agent: 'matchup_simulator',
  },
  {
    q: 'Start Bijan or Gibbs?',
    category: 'lineup',
    pecr: 'roster',
    grounding: true,
    orchestration: 'start_sit',
    agent: 'matchup_simulator',
  },
  {
    q: 'Who do I bench this week?',
    category: 'lineup',
    pecr: 'roster',
    grounding: true,
    orchestration: 'start_sit',
    agent: 'matchup_simulator',
  },
  {
    q: 'Who should I play at flex?',
    category: 'lineup',
    pecr: 'roster',
    grounding: true,
    orchestration: 'start_sit',
    agent: 'matchup_simulator',
  },
  {
    q: 'Sit Travis Kelce?',
    category: 'lineup',
    pecr: 'roster',
    grounding: true,
    orchestration: 'start_sit',
    agent: 'matchup_simulator',
  },
  {
    q: 'Set my lineup for Sunday',
    category: 'lineup',
    pecr: 'roster',
    grounding: true,
    orchestration: 'start_sit',
    agent: 'matchup_simulator',
  },
  {
    q: 'Who is my opponent this week?',
    category: 'lineup',
    pecr: 'general',
    grounding: true,
    orchestration: 'matchup',
    agent: 'matchup_simulator',
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
  },
  {
    q: "When is my league's draft?",
    category: 'draft',
    pecr: 'draft',
    grounding: true,
    orchestration: ['draft', 'general'],
    agent: 'draft_assistant',
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
  },

  // ── commissioner ─────────────────────────────────────────────────────────
  {
    q: 'Should I veto this trade as commissioner?',
    category: 'commissioner',
    pecr: 'trade',
    grounding: true,
    orchestration: 'commissioner',
    agent: 'commissioner',
  },
  {
    q: 'How do I change the playoff format in my league?',
    category: 'commissioner',
    pecr: 'general',
    grounding: true,
    orchestration: 'commissioner',
    agent: 'commissioner',
  },
  {
    q: 'Is there collusion in my league?',
    category: 'commissioner',
    pecr: 'general',
    grounding: true,
    orchestration: ['commissioner', 'manager_psychology'],
    agent: 'commissioner',
  },
  {
    q: 'Can I make a rule change mid-season as commish?',
    category: 'commissioner',
    pecr: 'general',
    grounding: null,
    orchestration: 'commissioner',
    agent: 'commissioner',
  },
  {
    q: 'How many teams make the playoffs in my league?',
    category: 'commissioner',
    pecr: 'general',
    grounding: true,
    orchestration: ['general', 'commissioner'],
    agent: ['general_research', 'commissioner'],
  },

  // ── general research ─────────────────────────────────────────────────────
  {
    q: 'Who is the best wide receiver this year?',
    category: 'research',
    pecr: 'general',
    grounding: false,
    orchestration: ['general', 'player_value'],
    agent: 'general_research',
  },
  {
    q: "What's the injury status of Christian McCaffrey?",
    category: 'research',
    pecr: 'general',
    grounding: false,
    orchestration: ['general', 'injury', 'player_value'],
    agent: 'general_research',
  },
  {
    q: 'Give me a rundown on Bijan Robinson',
    category: 'research',
    pecr: 'general',
    grounding: false,
    orchestration: ['general', 'player_value'],
    agent: 'general_research',
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
  },
  /*
   * The edges of the 2026-09-16 gap fixes, each pinned in the direction the fix must NOT reach:
   * a bare "decline" is a player question; a how-does-it-work question about THEIR move is still
   * theirs; a trade decision that mentions the deadline is still a trade.
   */
  {
    q: 'Is Travis Kelce in decline?',
    category: 'research',
    pecr: 'general',
    grounding: false,
    orchestration: ['general', 'player_value'],
    agent: ['general_research', 'dynasty_legacy'],
  },
  {
    q: 'How does waiver priority work if I drop him?',
    category: 'waiver',
    pecr: 'waiver',
    grounding: true,
    orchestration: ['waiver', 'general'],
    agent: ['waiver_wire', 'general_research'],
  },
  {
    q: 'Should I trade Kelce before the deadline?',
    category: 'trade',
    pecr: 'trade',
    grounding: true,
    orchestration: 'trade',
    agent: 'trade_analyzer',
  },

  // ── college / devy ───────────────────────────────────────────────────────
  {
    q: 'Is Arch Manning a first-round devy pick?',
    category: 'college',
    pecr: 'draft',
    grounding: false,
    orchestration: ['draft', 'player_value'],
    agent: ['draft_assistant', 'c2c_specialist', 'dynasty_legacy'],
  },
  {
    q: 'When does the college football season start?',
    category: 'college',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
  },
  {
    q: 'Best college football players to stash in devy?',
    category: 'college',
    pecr: 'general',
    grounding: false,
    orchestration: ['general', 'player_value', 'draft'],
    agent: ['draft_assistant', 'c2c_specialist', 'dynasty_legacy'],
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
  },
  {
    q: 'Should I start Brandon Aubrey or Jake Elliott?',
    category: 'kicker',
    pecr: 'roster',
    grounding: true,
    orchestration: 'start_sit',
    agent: 'matchup_simulator',
  },
  {
    q: 'Is Brandon Aubrey worth rostering?',
    category: 'kicker',
    pecr: 'roster',
    grounding: true,
    orchestration: ['player_value', 'waiver'],
    agent: 'waiver_wire',
  },
  {
    q: 'How many points do kickers get for a 50-yard field goal?',
    category: 'kicker',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
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
  },
  {
    q: 'Best IDP linebacker to add?',
    category: 'idp',
    pecr: 'waiver',
    grounding: true,
    orchestration: 'waiver',
    agent: 'waiver_wire',
  },
  {
    q: 'How many points is a sack worth in my league?',
    category: 'idp',
    pecr: 'general',
    grounding: true,
    orchestration: ['general', 'commissioner'],
    agent: ['general_research', 'commissioner'],
  },
  {
    q: 'Should I start Fred Warner or Roquan Smith at LB?',
    category: 'idp',
    pecr: 'roster',
    grounding: true,
    orchestration: 'start_sit',
    agent: 'matchup_simulator',
  },
  {
    q: 'Who are the top EDGE rushers in IDP rankings?',
    category: 'idp',
    pecr: 'draft',
    grounding: false,
    orchestration: ['general', 'player_value', 'draft'],
    agent: ['draft_assistant', 'general_research'],
  },
  {
    q: 'Explain how IDP scoring works',
    category: 'idp',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
  },

  // ── platform & scoring settings ──────────────────────────────────────────
  {
    q: 'How does superflex scoring work?',
    category: 'platform_settings',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
  },
  {
    q: "What are my league's scoring settings?",
    category: 'platform_settings',
    pecr: 'general',
    grounding: true,
    orchestration: 'general',
    agent: ['general_research', 'commissioner'],
  },
  {
    q: 'Is this a TE premium league?',
    category: 'platform_settings',
    pecr: 'general',
    grounding: null,
    orchestration: 'general',
    agent: 'general_research',
  },
  {
    q: 'How do I import my Sleeper league?',
    category: 'platform_settings',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
  },
  {
    q: 'Does ESPN or Yahoo support keeper leagues?',
    category: 'platform_settings',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
  },
  {
    q: 'How do MFL and Fantrax handle IR slots?',
    category: 'platform_settings',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
  },
  {
    q: 'What is half PPR?',
    category: 'platform_settings',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
  },
  {
    q: "Is Ja'Marr Chase worth more in PPR or standard?",
    category: 'platform_settings',
    pecr: 'general',
    grounding: false,
    orchestration: 'player_value',
    agent: ['player_comparison', 'general_research'],
  },
  {
    q: 'Is Josh Allen worth more in a 2QB league?',
    category: 'platform_settings',
    pecr: 'general',
    grounding: false,
    orchestration: 'player_value',
    agent: 'general_research',
  },

  // ── real-world sport, not fantasy ────────────────────────────────────────
  {
    q: 'Who scored in the Champions League last night?',
    category: 'real_world',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
  },
  {
    q: 'When does the season start?',
    category: 'real_world',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
  },
  {
    q: 'What time does the Chiefs game start tonight?',
    category: 'real_world',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
  },
  {
    q: 'Did the 49ers win?',
    category: 'real_world',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
  },
  {
    q: 'When is the NFL draft?',
    category: 'real_world',
    pecr: 'draft',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
  },
  {
    q: 'Tell me about free agency this year',
    category: 'real_world',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
  },

  // ── substring collisions: every one of these was refused before 2026-09-16 ──
  {
    q: 'Is Ladd McConkey a WR1?',
    category: 'name_collision',
    pecr: 'general',
    grounding: false,
    orchestration: ['general', 'player_value'],
    agent: 'general_research',
  },
  {
    q: 'Jordan Addison rest-of-season outlook',
    category: 'name_collision',
    pecr: 'general',
    grounding: false,
    orchestration: ['general', 'player_value'],
    agent: 'general_research',
  },
  {
    q: 'Is Tee Higgins an ideal WR2?',
    category: 'name_collision',
    pecr: 'general',
    grounding: false,
    orchestration: ['general', 'player_value'],
    agent: 'general_research',
  },
  {
    q: 'George Pickens outlook for 2026',
    category: 'name_collision',
    pecr: 'general',
    grounding: false,
    orchestration: ['general', 'player_value'],
    agent: 'general_research',
  },
  {
    q: 'Frank Gore career rushing yards',
    category: 'name_collision',
    pecr: 'general',
    grounding: false,
    orchestration: 'general',
    agent: 'general_research',
  },
  {
    q: 'How do I claim my team?',
    category: 'name_collision',
    pecr: 'general',
    grounding: null,
    orchestration: 'general',
    agent: 'general_research',
  },
]

/*
 * 🛑 HELD OUT. Written 2026-09-16 AFTER the agent-routing fix was built against `TUNED`, with the
 * expectations set BEFORE the first run against them. The first run's result is recorded in the
 * commit that added this list; any gap below was found here, not planted.
 *
 * ⚠ THREE OF THESE ARE NO LONGER STRICTLY HELD OUT (2026-09-16): "Accept or decline…", "How does
 * the waiver priority reset work…" and "When is the trade deadline…" were pinned gaps here and were
 * then fixed against these exact questions. They still guard the fixes; they no longer measure
 * generalisation.
 */
const HELD_OUT: readonly EvalCase[] = [
  { q: 'Should I sell high on Puka Nacua?', category: 'trade', pecr: 'general', grounding: false, orchestration: ['player_value', 'trade'], agent: ['general_research', 'trade_analyzer'] },
  { q: 'Accept or decline: my Kelce for his Bowers?', category: 'trade', pecr: 'trade', grounding: true, orchestration: 'trade', agent: 'trade_analyzer' },
  { q: 'Is a 3-for-1 trade ever worth it?', category: 'trade', pecr: 'trade', grounding: null, orchestration: 'trade', agent: 'trade_analyzer' },
  { q: "Who's a good waiver pickup at tight end?", category: 'waiver', pecr: 'waiver', grounding: true, orchestration: 'waiver', agent: 'waiver_wire' },
  { q: 'Should I drop Najee Harris?', category: 'waiver', pecr: 'waiver', grounding: true, orchestration: 'waiver', agent: 'waiver_wire' },
  { q: 'Is it too late to add a handcuff?', category: 'waiver', pecr: 'waiver', grounding: true, orchestration: 'waiver', agent: 'waiver_wire' },
  { q: 'How much should I bid on Bucky Irving?', category: 'waiver', pecr: 'waiver', grounding: true, orchestration: 'waiver', agent: 'waiver_wire' },
  { q: 'Is Jahmyr Gibbs a must-start this week?', category: 'lineup', pecr: ['roster', 'general'], grounding: null, orchestration: 'start_sit', agent: 'matchup_simulator' },
  { q: 'Flex Tank Bigsby or Rhamondre Stevenson?', category: 'lineup', pecr: 'roster', grounding: true, orchestration: 'start_sit', agent: 'matchup_simulator' },
  { q: 'Should I bench Kyler Murray against the 49ers defense?', category: 'lineup', pecr: 'roster', grounding: true, orchestration: 'start_sit', agent: 'matchup_simulator' },
  { q: 'Should I start the Eagles defense or the Ravens defense?', category: 'lineup', pecr: 'roster', grounding: true, orchestration: 'start_sit', agent: 'matchup_simulator' },
  { q: 'What round should I take a kicker in?', category: 'kicker', pecr: ['draft', 'general'], grounding: false, orchestration: 'draft', agent: 'draft_assistant' },
  { q: 'Rank the top 5 rookie running backs', category: 'draft', pecr: 'draft', grounding: false, orchestration: 'draft', agent: 'draft_assistant' },
  { q: "What's the ADP of Ashton Jeanty in dynasty startups?", category: 'draft', pecr: 'draft', grounding: false, orchestration: 'draft', agent: 'draft_assistant' },
  { q: 'Who should I keep as my keeper?', category: 'draft', pecr: 'general', grounding: null, orchestration: ['general', 'draft'], agent: ['dynasty_legacy', 'general_research', 'draft_assistant'] },
  { q: 'Is Travis Hunter a WR or CB in IDP leagues?', category: 'idp', pecr: 'general', grounding: false, orchestration: 'general', agent: 'general_research' },
  { q: 'Best DL to stream in IDP this week', category: 'idp', pecr: ['general', 'waiver'], grounding: null, orchestration: 'waiver', agent: 'waiver_wire' },
  { q: 'How does the waiver priority reset work on Sleeper?', category: 'platform_settings', pecr: ['general', 'waiver'], grounding: false, orchestration: 'general', agent: 'general_research' },
  { q: 'What does TE premium do to Brock Bowers value?', category: 'platform_settings', pecr: 'general', grounding: false, orchestration: ['player_value', 'general'], agent: 'general_research' },
  { q: 'Is Caleb Williams a top-12 QB in superflex?', category: 'platform_settings', pecr: 'general', grounding: false, orchestration: ['player_value', 'general'], agent: 'general_research' },
  { q: 'When is the trade deadline in my league?', category: 'commissioner', pecr: 'trade', grounding: true, orchestration: ['commissioner', 'general', 'trade'], agent: ['commissioner', 'general_research'] },
  { q: 'Can the commissioner reverse a trade on ESPN?', category: 'commissioner', pecr: 'trade', grounding: null, orchestration: 'commissioner', agent: 'commissioner' },
  { q: 'Our league has a manager who never sets his lineup, what should I do as commish?', category: 'commissioner', pecr: 'roster', grounding: true, orchestration: 'commissioner', agent: 'commissioner' },
  { q: 'Should we switch to half PPR next season?', category: 'commissioner', pecr: 'general', grounding: null, orchestration: ['commissioner', 'general'], agent: ['commissioner', 'general_research'] },
  { q: 'Who is the strongest team in my league?', category: 'research', pecr: 'general', grounding: true, orchestration: 'league_strength', agent: 'power_rankings' },
  { q: "Can you recap my league's week 3?", category: 'research', pecr: 'general', grounding: true, orchestration: 'story_recap', agent: 'storyline' },
  { q: "What's Bijan's dynasty value?", category: 'research', pecr: 'general', grounding: false, orchestration: 'player_value', agent: ['dynasty_legacy', 'general_research'] },
  { q: 'Compare Garrett Wilson and Drake London', category: 'research', pecr: 'general', grounding: false, orchestration: ['general', 'player_value'], agent: 'player_comparison' },
  { q: 'Is Nick Chubb done?', category: 'research', pecr: 'general', grounding: false, orchestration: 'general', agent: 'general_research' },
  { q: 'Is Jeremiyah Love a top devy asset?', category: 'college', pecr: 'general', grounding: false, orchestration: ['draft', 'player_value'], agent: ['draft_assistant', 'dynasty_legacy', 'c2c_specialist', 'general_research'] },
  { q: 'Who won the Heisman last year?', category: 'college', pecr: 'general', grounding: false, orchestration: 'general', agent: 'general_research' },
  { q: 'Who leads the NFL in receiving yards?', category: 'real_world', pecr: 'general', grounding: false, orchestration: 'general', agent: 'general_research' },
  { q: 'Where can I stream the Bills game?', category: 'real_world', pecr: 'general', grounding: false, orchestration: 'general', agent: 'general_research' },
  { q: 'Start time for Monday Night Football?', category: 'real_world', pecr: 'general', grounding: false, orchestration: 'general', agent: 'general_research' },
]

export const CHIMMY_EVAL_CORPUS: readonly EvalCase[] = [...TUNED, ...HELD_OUT]
export const CHIMMY_EVAL_HELD_OUT_COUNT = HELD_OUT.length
