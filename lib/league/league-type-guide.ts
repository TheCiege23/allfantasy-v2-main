import type { LeagueFormatDefinition, LeagueFormatId } from '@/lib/league/format-engine'

type LeagueFormatModifierId = LeagueFormatDefinition['supportedModifiers'][number]

export type LeagueGuideCategory = 'Seasonal' | 'Long term' | 'Elimination & social'

type FormatGuide = {
  category: LeagueGuideCategory
  bestFor: string
  commitment: string
  rules: string[]
  commissioner: string[]
  beforeJoining: string
}

// Keep educational copy separate from live league rules. The page reads sport
// availability and format names from the canonical format registry.
export const LEAGUE_TYPE_GUIDES = {
  pirate: {
    category: 'Seasonal',
    bestFor: 'Head-to-head competition where a win can change both teams’ rosters.',
    commitment: 'Weekly lineups, player protections and claim deadlines.',
    rules: [
      'Protect eligible players before the protection deadline each period.',
      'A matchup win earns a claim on an unprotected player from the defeated opponent. Ties do not earn claims.',
      'Claims, optional return offers and roster transfers follow the selection and settlement windows.',
    ],
    commissioner: ['Configure protection limits, claim and selection windows, roster overflow grace and whether playoff claims are enabled.'],
    beforeJoining: 'Check when protections lock, how long you have to claim, and what happens when a transfer puts a roster over its limit.',
  },
  redraft: {
    category: 'Seasonal',
    bestFor: 'A fresh start each season, including your first fantasy league.',
    commitment: 'One season; regular lineup and roster decisions.',
    rules: [
      'Draft a new roster each season. Players do not carry over to next year.',
      'Set eligible starters and use trades and waivers under the league rules.',
      'Scoring, standings and the playoff setup determine the champion.',
    ],
    commissioner: ['Choose roster slots, scoring, draft settings, waiver rules, trade review and the playoff schedule.'],
    beforeJoining: 'Check lineup deadlines, scoring, waiver processing and playoff dates.',
  },
  dynasty: {
    category: 'Long term',
    bestFor: 'Building a team over several seasons and trading with the future in mind.',
    commitment: 'Multiple seasons, with offseason decisions.',
    rules: [
      'A startup draft establishes teams; rosters carry over between seasons.',
      'Rookie drafts bring in new players, while trades can include future picks when enabled.',
      'Taxi squads can hold developing players under eligibility and promotion rules.',
    ],
    commissioner: ['Configure roster depth, taxi slots and eligibility, rookie drafts and future pick trading policies.'],
    beforeJoining: 'Read the offseason calendar, rookie draft order, roster cut rules and pick trading limits.',
  },
  keeper: {
    category: 'Long term',
    bestFor: 'Keeping a few favorites while still enjoying a substantial draft each year.',
    commitment: 'Seasonal play plus a keeper decision before the next draft.',
    rules: [
      'Retain a limited number of eligible players; the rest return to the draft pool.',
      'Keeping a player may cost a draft pick or round, depending on the keeper policy.',
      'Keeper deadlines and retention limits govern who returns next season.',
    ],
    commissioner: ['Set maximum keepers, eligibility, deadlines and draft round costs.'],
    beforeJoining: 'Confirm how keeper costs change over time and how many seasons a player can be retained.',
  },
  best_ball: {
    category: 'Seasonal',
    bestFor: 'Drafting a balanced roster with fewer recurring lineup decisions.',
    commitment: 'Draft focused; ongoing roster activity depends on league settings.',
    rules: [
      'The highest-scoring legal lineup is selected automatically from your roster each scoring period.',
      'Roster depth and position coverage matter because only eligible slot combinations count.',
      'Standings may use head-to-head or cumulative scoring. Waivers and trades depend on the configured mode.',
    ],
    commissioner: ['Choose scoring periods, lineup slots, contest structure, playoff format and the available roster transaction settings.'],
    beforeJoining: 'Check whether this is a draft-only contest or a managed league with waivers and trades.',
  },
  guillotine: {
    category: 'Elimination & social',
    bestFor: 'Weekly survival pressure and a changing free-agent pool.',
    commitment: 'Active lineup and waiver management until elimination.',
    rules: [
      'The lowest-scoring team in a scoring period is chopped under the elimination schedule.',
      'A chopped team leaves contention and its players are released to the waiver pool.',
      'Surviving managers compete for released players; the final survivor wins.',
    ],
    commissioner: ['Configure chop timing, elimination rules, tiebreakers and waiver handling.'],
    beforeJoining: 'Read the chop schedule, tie procedure, waiver budget and player release timing.',
  },
  survivor: {
    category: 'Elimination & social',
    bestFor: 'Fantasy scoring combined with tribes, social strategy and elimination.',
    commitment: 'Frequent attention to challenges, votes and deadlines.',
    rules: [
      'Managers compete in tribes before a merge shifts the contest toward individual survival.',
      'Challenges, immunity and tribal council voting shape elimination under the league rules.',
      'Idols, tribe shuffles, exile returns and jury participation depend on configuration.',
    ],
    commissioner: ['Configure tribes and formation, merge timing, challenges, voting deadlines, idols and optional exile returns.'],
    beforeJoining: 'This is the fantasy roster and tribe format. Read the voting, immunity, merge and finale rules before joining.',
  },
  tournament: {
    category: 'Elimination & social',
    bestFor: 'A larger competition spanning multiple leagues and rounds.',
    commitment: 'Round-based play for the duration of the event.',
    rules: [
      'Managers compete in feeder leagues within a larger tournament.',
      'Seeding and advancement rules determine who reaches later rounds.',
      'The tournament rules define how the final champion is decided.',
    ],
    commissioner: ['Choose the participant pool and league naming; review the tournament structure, seeding and advancement rules.'],
    beforeJoining: 'Check advancement thresholds, scoring resets, tiebreakers and the round schedule.',
  },
  devy: {
    category: 'Long term',
    bestFor: 'Dynasty managers who enjoy scouting college prospects before they turn pro.',
    commitment: 'Multiple seasons, including college prospect research.',
    rules: [
      'A dynasty roster is paired with a separate pool of college prospects.',
      'Drafting a prospect establishes future player rights under eligibility rules.',
      'Promotion rules govern movement from the college pool to the pro roster.',
    ],
    commissioner: ['Configure college roster depth, prospect eligibility, devy drafts, taxi slots and promotion policies.'],
    beforeJoining: 'Check prospect ownership and promotion rules. Football connects NFL and NCAAF; basketball connects NBA and NCAAB. Check current creation options for availability.',
  },
  c2c: {
    category: 'Long term',
    bestFor: 'Managing both college and professional teams in one connected ecosystem.',
    commitment: 'Multiple seasons and two active player pools.',
    rules: [
      'Campus to Canton connects separate college and pro rosters.',
      'College players contribute to campus competition while also forming a future pro pipeline.',
      'Promotion and eligibility rules connect the two sides across seasons.',
    ],
    commissioner: ['Configure dual rosters, college scoring, drafts, taxi slots and player promotion rules.'],
    beforeJoining: 'Read how campus and pro results contribute to titles. The paired ecosystems are NFL/NCAAF and NBA/NCAAB; check current creation options for availability.',
  },
  zombie: {
    category: 'Elimination & social',
    bestFor: 'Themed head-to-head play with infection, role changes and special powers.',
    commitment: 'Weekly play plus attention to role-specific actions and deadlines.',
    rules: [
      'Matchup outcomes can infect teams and change their roles under the configured infection rules.',
      'Whisperers, zombies, survivors, serum and weapons add special objectives and actions.',
      'Role restrictions affect trades and roster moves; linked universes can connect multiple leagues.',
    ],
    commissioner: ['Choose universe size and Whisperer selection; configure infection triggers, serum, weapons, ambushes and transaction restrictions.'],
    beforeJoining: 'Read role win conditions, action deadlines, revival rules and the effect of infection on transactions.',
  },
  salary_cap: {
    category: 'Long term',
    bestFor: 'Running a roster like a general manager with contracts and a budget.',
    commitment: 'Ongoing cap planning and offseason contract decisions.',
    rules: [
      'Player contracts consume cap space, and roster moves must satisfy cap legality.',
      'Contract length and salary affect both current flexibility and future commitments.',
      'Dead money, cap growth, rollover and contract options apply when enabled.',
    ],
    commissioner: ['Configure the cap, contract lengths, minimum salaries, dead money, rollover and optional extensions or franchise tags.'],
    beforeJoining: 'Check contract expiry, cut penalties, cap compliance deadlines and whether lineup scoring uses dynasty or best ball mode.',
  },
  big_brother: {
    category: 'Elimination & social',
    bestFor: 'Fantasy competition shaped by nominations, private votes and social strategy.',
    commitment: 'Frequent attention to competitions, nominations and voting windows.',
    rules: [
      'A Head of Household (HOH) earns nomination power through the challenge process.',
      'Veto competitions can change nominations before a private eviction vote.',
      'Evicted managers may join the jury, which participates in the finale under the configured rules.',
    ],
    commissioner: ['Configure challenge modes, consecutive HOH eligibility, ceremony deadlines, eviction tiebreaks, jury start and final two or three.'],
    beforeJoining: 'Check who can vote, whether vote totals are public, veto deadlines and the jury finale rules.',
  },
} satisfies Record<LeagueFormatId, FormatGuide>

export const LEAGUE_MODIFIER_GUIDES = {
  superflex: { title: 'Superflex', description: 'A football flex slot that can include a quarterback alongside eligible skill positions. Check the exact eligible positions and starting slots.' },
  idp: { title: 'IDP · Individual Defensive Players', description: 'Draft individual football defenders and score their defensive stats. Commissioners choose defensive slots, position grouping and scoring. Available for NFL and NCAAF where the selected format permits it.' },
  te_premium: { title: 'Tight end premium', description: 'Football scoring adds a premium for tight end receptions. Check the bonus amount and whether it stacks with the base reception score.' },
  taxi: { title: 'Taxi squad', description: 'Reserve developing players in dedicated slots. Eligibility, promotion deadlines and return restrictions depend on the league policy.' },
  devy: { title: 'Devy prospect rights', description: 'Add a college prospect pipeline and future player rights. Check pool eligibility and promotion rules in the Devy format guide.' },
  c2c: { title: 'College + pro rosters', description: 'Connect college competition to a professional roster and promotion pipeline. See Campus to Canton for the complete format.' },
  salary_cap: { title: 'Contracts & salary cap', description: 'Roster legality includes salaries, contract terms and cap space. See Salary Cap for the full format and optional contract policies.' },
  best_ball: { title: 'Best ball lineup selection', description: 'Automatically score the best eligible lineup each period. Where offered as a mode, roster carryover and transaction rules still come from the underlying league.' },
} satisfies Record<LeagueFormatModifierId, { title: string; description: string }>

export const LEAGUE_GUIDE_QUESTIONS = [
  { question: 'Do scoring and waiver settings change the league type?', answer: 'Settings such as PPR, half PPR, standard scoring, category or roto scoring, and FAAB waiver bidding describe parts of the experience. They do not by themselves determine whether a league is Redraft, Dynasty or another format. Their availability depends on sport and setup. Some advanced commissioner settings also depend on the selected plan.' },
  { question: 'Are these the exact rules for every league?', answer: 'These are general introductions. A league’s published settings, constitution and commissioner announcements define its scoring, deadlines, eligibility and special rules. Review those before joining.' },
  { question: 'Can a commissioner combine formats and add-ons?', answer: 'Some formats support combinations such as Dynasty with Superflex, taxi squads or IDP. Available combinations depend on both the format and sport. The creation flow and league settings show the permitted choices; every add-on is not available for every format.' },
  { question: 'Can my existing league change format or rules?', answer: 'A scoring or roster change can affect player values, draft picks, contracts and eligibility. Ask the commissioner to explain the proposed change, effective season, approval process and effect on existing rosters. An existing league may need a supported migration or a new league; do not assume every format can be switched in place.' },
  { question: 'What should a commissioner publish before the draft?', answer: 'Publish scoring, roster slots, draft rules, waivers, trades, tiebreakers and the season schedule. Add format-specific rules for retention, contracts, eliminations, voting, promotions and special powers. State when changes take effect and how disputes or missed deadlines are handled.' },
  { question: 'Is an auction, snake or slow draft a separate league type?', answer: 'Draft methods describe how players are selected. League types describe how the competition works over the season or across years. Available draft methods vary by format and sport; a pick timer or auction budget does not by itself change the league type.' },
  { question: 'How do I choose a format to try?', answer: 'Start with the time you want to spend and whether you want player carryover, automatic lineups or social elimination. Compare the “Good fit for” and commitment notes, then review the actual settings of a league before joining.' },
] as const
