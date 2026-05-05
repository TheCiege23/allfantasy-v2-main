/**
 * SEO landing and discovery page config.
 * Single source for sport slugs, tool slugs, metadata, and internal links.
 */

const BASE = 'https://allfantasy.ai'

export type SportSlug =
  | 'fantasy-football'
  | 'fantasy-basketball'
  | 'fantasy-baseball'
  | 'fantasy-hockey'
  | 'fantasy-soccer'
  | 'ncaa-football-fantasy'
  | 'ncaa-basketball-fantasy'

export type ToolSlug =
  | 'trade-analyzer'
  | 'trade-finder'
  | 'mock-draft-simulator'
  | 'waiver-wire-advisor'
  | 'manager-compare'
  | 'social-pulse'
  | 'career-share'
  | 'season-strategy'
  | 'ai-draft-assistant'
  | 'matchup-simulator'
  | 'bracket-challenge'
  | 'power-rankings'
  | 'legacy-dynasty'
  | 'league-transfer'

export const SPORT_SLUGS: SportSlug[] = [
  'fantasy-football',
  'fantasy-basketball',
  'fantasy-baseball',
  'fantasy-hockey',
  'fantasy-soccer',
  'ncaa-football-fantasy',
  'ncaa-basketball-fantasy',
]

export const TOOL_SLUGS: ToolSlug[] = [
  'trade-analyzer',
  'trade-finder',
  'mock-draft-simulator',
  'waiver-wire-advisor',
  'manager-compare',
  'social-pulse',
  'career-share',
  'season-strategy',
  'ai-draft-assistant',
  'matchup-simulator',
  'bracket-challenge',
  'power-rankings',
  'legacy-dynasty',
  'league-transfer',
]

export interface SportConfig {
  slug: SportSlug
  title: string
  description: string
  headline: string
  body: string
  leagueSport: string // NFL, NBA, etc.
  toolHrefs: { label: string; href: string }[]
  keywords: string[]
}

export interface ToolConfig {
  slug: ToolSlug
  title: string
  description: string
  headline: string
  benefitSummary: string
  openToolHref: string
  icon?: string
  badge?: string
  examples: string[]
  relatedToolSlugs: ToolSlug[]
  keywords: string[]
  faqs?: { q: string; a: string }[]
}

export const SPORT_CONFIG: Record<SportSlug, SportConfig> = {
  'fantasy-football': {
    slug: 'fantasy-football',
    leagueSport: 'NFL',
    title: 'Fantasy Football Tools – AI Trade Analyzer & More | AllFantasy',
    description:
      'AllFantasy fantasy football tools: AI trade analyzer, mock drafts, waiver wire advisor, and league management for NFL fantasy leagues.',
    headline: 'Fantasy Football Tools',
    body:
      'AllFantasy brings AI-powered fantasy football tools to your NFL leagues. Analyze trades with context-aware grades, run mock drafts, get waiver and lineup advice, and manage your league in one place. Built for redraft and dynasty.',
    keywords: ['fantasy football tools', 'NFL fantasy', 'fantasy trade analyzer', 'fantasy football AI'],
    toolHrefs: [
      { label: 'Trade Analyzer', href: '/trade-analyzer' },
      { label: 'Mock Draft', href: '/mock-draft' },
      { label: 'Waiver Wire Advisor', href: '/waiver-ai' },
      { label: 'Season Strategy', href: '/season-strategy' },
      { label: 'Manager Comparison', href: '/manager-compare' },
      { label: 'Social Pulse', href: '/social-pulse' },
      { label: 'Sports App', href: '/discover/leagues' },
      { label: 'Legacy & Dynasty', href: '/af-legacy' },
    ],
  },
  'fantasy-basketball': {
    slug: 'fantasy-basketball',
    leagueSport: 'NBA',
    title: 'Fantasy Basketball Tools – AI Analysis & League Management | AllFantasy',
    description:
      'AllFantasy fantasy basketball tools for NBA leagues: trade analyzer, waiver advice, power rankings, and AI-powered draft and lineup help.',
    headline: 'Fantasy Basketball Tools',
    body:
      'AllFantasy supports NBA fantasy basketball with AI trade analysis, waiver wire recommendations, power rankings, and draft tools. Use the Sports App for league management and the Trade Analyzer for deal evaluation.',
    keywords: ['fantasy basketball tools', 'NBA fantasy', 'fantasy basketball AI', 'basketball trade analyzer'],
    toolHrefs: [
      { label: 'Trade Analyzer', href: '/trade-analyzer' },
      { label: 'Mock Draft', href: '/mock-draft' },
      { label: 'Waiver Advisor', href: '/waiver-ai' },
      { label: 'Season Strategy', href: '/season-strategy' },
      { label: 'Social Pulse', href: '/social-pulse' },
      { label: 'Power Rankings', href: '/app/power-rankings' },
      { label: 'Sports App', href: '/discover/leagues' },
    ],
  },
  'fantasy-baseball': {
    slug: 'fantasy-baseball',
    leagueSport: 'MLB',
    title: 'Fantasy Baseball Tools – AI Trade Analyzer & Waiver Help | AllFantasy',
    description:
      'AllFantasy fantasy baseball tools for MLB leagues: AI trade analyzer, waiver wire advisor, mock drafts, and dynasty management.',
    headline: 'Fantasy Baseball Tools',
    body:
      'AllFantasy offers fantasy baseball tools for MLB redraft and dynasty leagues. Analyze trades, get waiver and lineup advice, run mock drafts, and use Chimmy AI for real-time guidance.',
    keywords: ['fantasy baseball tools', 'MLB fantasy', 'fantasy baseball AI', 'baseball trade analyzer'],
    toolHrefs: [
      { label: 'Trade Analyzer', href: '/trade-analyzer' },
      { label: 'Waiver Advisor', href: '/waiver-ai' },
      { label: 'Mock Draft', href: '/mock-draft' },
      { label: 'Season Strategy', href: '/season-strategy' },
      { label: 'Sports App', href: '/discover/leagues' },
      { label: 'Chimmy AI', href: '/chimmy' },
    ],
  },
  'fantasy-hockey': {
    slug: 'fantasy-hockey',
    leagueSport: 'NHL',
    title: 'Fantasy Hockey Tools – AI Analysis & League Tools | AllFantasy',
    description:
      'AllFantasy fantasy hockey tools for NHL leagues: trade analyzer, waiver wire advisor, mock drafts, and AI-powered league management.',
    headline: 'Fantasy Hockey Tools',
    body:
      'AllFantasy supports NHL fantasy hockey with AI trade analysis, waiver recommendations, mock draft simulator, and league management in the Sports App. Dynasty and redraft supported.',
    keywords: ['fantasy hockey tools', 'NHL fantasy', 'fantasy hockey AI', 'hockey trade analyzer'],
    toolHrefs: [
      { label: 'Trade Analyzer', href: '/trade-analyzer' },
      { label: 'Mock Draft', href: '/mock-draft' },
      { label: 'Waiver Advisor', href: '/waiver-ai' },
      { label: 'Season Strategy', href: '/season-strategy' },
      { label: 'Sports App', href: '/discover/leagues' },
      { label: 'Legacy', href: '/af-legacy' },
    ],
  },
  'fantasy-soccer': {
    slug: 'fantasy-soccer',
    leagueSport: 'SOCCER',
    title: 'Fantasy Soccer Tools – AI Trade & League Management | AllFantasy',
    description:
      'AllFantasy fantasy soccer tools: AI trade analyzer, waiver advice, and league management for fantasy soccer leagues.',
    headline: 'Fantasy Soccer Tools',
    body:
      'AllFantasy brings AI-powered tools to fantasy soccer: trade analysis, waiver wire advisor, and league management. Use the Sports App and Trade Analyzer for smarter decisions.',
    keywords: ['fantasy soccer tools', 'soccer fantasy', 'fantasy soccer AI', 'soccer trade analyzer'],
    toolHrefs: [
      { label: 'Trade Analyzer', href: '/trade-analyzer' },
      { label: 'Waiver Advisor', href: '/waiver-ai' },
      { label: 'Season Strategy', href: '/season-strategy' },
      { label: 'Sports App', href: '/discover/leagues' },
      { label: 'Chimmy AI', href: '/chimmy' },
    ],
  },
  'ncaa-football-fantasy': {
    slug: 'ncaa-football-fantasy',
    leagueSport: 'NCAAF',
    title: 'NCAA Football Fantasy Tools – AI Analysis & Dynasty | AllFantasy',
    description:
      'AllFantasy NCAA football fantasy tools: trade analyzer, waiver advisor, and dynasty league management for college fantasy football.',
    headline: 'NCAA Football Fantasy Tools',
    body:
      'AllFantasy supports NCAA football fantasy with AI trade analysis, waiver wire advice, and dynasty tools. Use the Sports App and Legacy experience for college fantasy leagues.',
    keywords: ['NCAA football fantasy', 'college fantasy football', 'NCAAF fantasy tools'],
    toolHrefs: [
      { label: 'Trade Analyzer', href: '/trade-analyzer' },
      { label: 'Waiver Advisor', href: '/waiver-ai' },
      { label: 'Season Strategy', href: '/season-strategy' },
      { label: 'Sports App', href: '/discover/leagues' },
      { label: 'Legacy & Dynasty', href: '/af-legacy' },
    ],
  },
  'ncaa-basketball-fantasy': {
    slug: 'ncaa-basketball-fantasy',
    leagueSport: 'NCAAB',
    title: 'NCAA Basketball Fantasy & Bracket Tools | AllFantasy',
    description:
      'AllFantasy NCAA basketball tools: bracket challenge, fantasy league management, and AI-powered bracket analysis and pool management.',
    headline: 'NCAA Basketball Fantasy & Bracket Tools',
    body:
      'AllFantasy offers NCAA basketball bracket challenges, pool management, and fantasy league tools. Compete in bracket contests and use AI to stress-test your picks. Fantasy league support for NCAAB.',
    keywords: ['NCAA basketball fantasy', 'bracket challenge', 'March Madness', 'NCAAB fantasy'],
    toolHrefs: [
      { label: 'Bracket Challenge', href: '/brackets' },
      { label: 'Bracket Hub', href: '/brackets' },
      { label: 'Trade Analyzer', href: '/trade-analyzer' },
      { label: 'Season Strategy', href: '/season-strategy' },
      { label: 'Sports App', href: '/discover/leagues' },
    ],
  },
}

export const TOOL_CONFIG: Record<ToolSlug, ToolConfig> = {
  'trade-analyzer': {
    slug: 'trade-analyzer',
    title: 'Fantasy Trade Analyzer – AI-Powered Trade Grades | AllFantasy',
    description:
      'AllFantasy trade analyzer evaluates fantasy football, basketball, baseball, and more with AI grades, context-aware analysis, and counter-offer suggestions.',
    headline: 'Fantasy Trade Analyzer',
    benefitSummary:
      'Get deterministic trade grades, lineup impact, and replacement value in context. Stop arguing in the group chat—show the receipts.',
    openToolHref: '/trade-evaluator',
    examples: [
      'Evaluate redraft and dynasty trades with league context',
      'See letter grades and AI explanations for both sides',
      'Get counter-offer suggestions to maximize value',
    ],
    relatedToolSlugs: ['mock-draft-simulator', 'waiver-wire-advisor', 'ai-draft-assistant', 'legacy-dynasty'],
    keywords: ['fantasy trade analyzer', 'trade analyzer', 'fantasy football trade', 'AI trade analysis'],
    faqs: [
      { q: 'What sports does the trade analyzer support?', a: 'NFL, NBA, MLB, NHL, NCAA Basketball, NCAA Football, and Soccer. Redraft and dynasty formats.' },
      { q: 'How does the AI grade trades?', a: 'Grades consider lineup impact, replacement value, and your league settings. You get letter grades and explanations for both sides.' },
      { q: 'Do I need to connect my league?', a: 'You can use the analyzer standalone or with a connected league for better context.' },
    ],
  },
  'trade-finder': {
    slug: 'trade-finder',
    title: 'AI Trade Finder - League-Wide Trade Discovery | AllFantasy',
    description:
      'AI scans your synced Sleeper league to find the best available fantasy trades based on roster fit, trade goals, partner alignment, and market context.',
    headline: 'AI Trade Finder',
    benefitSummary:
      'Scan your full league for realistic trade paths, partner fits, and analyzer-ready packages without manually checking every roster.',
    openToolHref: '/trade-finder',
    examples: [
      'Scan the full league for win-now, rebuild, or balanced trade paths',
      'Surface partner matches before sending a package into the analyzer',
      'Filter opportunities by target position, picks, fairness, and roster fit',
    ],
    relatedToolSlugs: ['trade-analyzer', 'waiver-wire-advisor', 'power-rankings'],
    keywords: ['trade finder', 'ai trade finder', 'fantasy trade ideas', 'league trade scanner'],
  },
  'mock-draft-simulator': {
    slug: 'mock-draft-simulator',
    title: 'Mock Draft Simulator – Fantasy Football & More | AllFantasy',
    description:
      'Full AI-powered mock draft room that looks and feels like a live draft board. Import your Sleeper league for real managers and draft slots, or run a custom open mock across all supported sports.',
    headline: 'Mock Draft Simulator',
    benefitSummary:
      'Import a real Sleeper league or build a custom room, then draft against AI teams using ADP, roster needs, and scoring-aware logic in one shareable board.',
    badge: 'AI-Powered',
    openToolHref: '/mock-draft',
    examples: [
      'Import real Sleeper managers, avatars, and draft order when available',
      'Run open mocks with custom team count, rounds, speed, and scoring',
      'Save and share a completed draft room recap with league mates',
    ],
    relatedToolSlugs: ['trade-analyzer', 'ai-draft-assistant', 'waiver-wire-advisor', 'legacy-dynasty'],
    keywords: ['mock draft simulator', 'fantasy mock draft', 'draft simulator', 'AI draft'],
  },
  'waiver-wire-advisor': {
    slug: 'waiver-wire-advisor',
    title: 'Waiver Wire Advisor – AI Pickup & Lineup Help | AllFantasy',
    description:
      'AllFantasy waiver wire advisor gives AI-powered pickup recommendations and lineup help tuned to your league settings and scoring.',
    headline: 'Waiver Wire Advisor',
    benefitSummary:
      'Get pickup and lineup recommendations based on your league. AI considers scoring, roster needs, and availability.',
    openToolHref: '/waiver-ai',
    examples: [
      'Waiver and free-agent pickup recommendations',
      'Lineup optimization suggestions',
      'League-context aware advice',
    ],
    relatedToolSlugs: ['trade-analyzer', 'mock-draft-simulator', 'ai-draft-assistant', 'matchup-simulator'],
    keywords: ['waiver wire advisor', 'fantasy waiver', 'pickup recommendations', 'lineup help'],
  },
  'manager-compare': {
    slug: 'manager-compare',
    title: 'Manager Comparison – Head-to-Head Fantasy Manager Grades | AllFantasy',
    description:
      'Compare any two fantasy managers head-to-head. AI grades records, win rates, championships, and play style across redraft, dynasty, and specialty formats. Includes trade style and manager DNA.',
    headline: 'Manager Comparison',
    benefitSummary:
      'Stack two Sleeper managers side-by-side with AI grades, verdict hero, DNA signals, trade style context, and shared-league opponent tendencies.',
    openToolHref: '/manager-compare',
    icon: '⚔️',
    badge: 'AI-Powered',
    examples: [
      'Compare redraft, dynasty, and specialty format grades for two managers',
      'See trade style, manager DNA, and shared-league opponent tendencies in one place',
      'Generate a shareable comparison URL for league chat debates',
    ],
    relatedToolSlugs: ['social-pulse', 'power-rankings'],
    keywords: ['manager comparison', 'fantasy manager grades', 'sleeper manager compare', 'head to head fantasy managers'],
    faqs: [
      { q: 'What does Manager Comparison measure?', a: 'It compares Sleeper manager history, format-specific grades, win rates, championships, and play-style tendencies.' },
      { q: 'Does the tool include AI analysis?', a: 'Yes. The head-to-head verdict, manager grading, and follow-up context are presented through an AI-assisted comparison flow.' },
      { q: 'Can I share a comparison with someone else?', a: 'Yes. After loading results, you can copy a shareable URL with both manager usernames baked into the page.' },
    ],
  },
  'social-pulse': {
    slug: 'social-pulse',
    title: 'Social Pulse – Live Fantasy Sentiment Research | AllFantasy',
    description:
      'Real-time player and team sentiment from X and the web. Know what the market is saying before it moves. Powered by Grok AI with live search.',
    headline: 'Social Pulse',
    benefitSummary:
      'Track live fantasy narratives, confidence, impact, and cross-player connections before the market fully reacts.',
    openToolHref: '/social-pulse',
    badge: 'Live',
    examples: [
      'Search player, team, or coach narratives across X and the web',
      'Spot buy-low, sell-high, injury, and hype signals with confidence and recency',
      'Send the names you find directly into the Trade Analyzer workspace',
    ],
    relatedToolSlugs: ['trade-analyzer', 'waiver-wire-advisor', 'ai-draft-assistant', 'matchup-simulator'],
    keywords: ['social pulse', 'fantasy sentiment', 'player sentiment', 'grok live search', 'x search fantasy'],
    faqs: [
      { q: 'What sports does Social Pulse support today?', a: 'NFL and NBA live sentiment research today, using X and web search inside AllFantasy.' },
      { q: 'Does Social Pulse use live data?', a: 'Yes. Social Pulse uses Grok with live X search and web search to summarize recent narratives from the last seven days.' },
      { q: 'Can I move from Social Pulse into another tool?', a: 'Yes. After a run, you can send the searched names into the Trade Analyzer to continue researching a possible deal.' },
    ],
  },
  'career-share': {
    slug: 'career-share',
    title: 'Career Share – AI Fantasy Social Captions & Rewards | AllFantasy',
    description:
      'Generate AI-powered social captions for your fantasy career rank, trades, league standings, player takes, and waiver wins. Load a dynasty report, edit the caption, and earn reward tokens for sharing.',
    headline: 'Career Share',
    benefitSummary:
      'Turn your fantasy moments into post-ready captions with Grok AI, optional dynasty report context, platform-aware formatting, and daily share rewards.',
    openToolHref: '/career-share',
    icon: '🚀',
    badge: 'Grok AI',
    examples: [
      'Create a ranking flex post from your AllFantasy career tier and XP snapshot',
      'Generate social copy for trade debates, league standing updates, player stock takes, and waiver pickups',
      'Copy or share a caption and earn a daily token reward inside AllFantasy',
    ],
    relatedToolSlugs: ['social-pulse', 'manager-compare', 'power-rankings', 'legacy-dynasty'],
    keywords: ['career share', 'fantasy social captions', 'grok fantasy captions', 'share reward tokens', 'fantasy post generator'],
    faqs: [
      { q: 'What can I generate inside Career Share?', a: 'Career Share supports five fantasy post types: ranking flex, trade debate, league standing, player stock, and waiver pickup captions.' },
      { q: 'Do I have to load the dynasty report first?', a: 'No. The dynasty report is optional and loads separately so you can generate a caption immediately without waiting on it.' },
      { q: 'How do the reward tokens work?', a: 'Copying or sharing a generated caption records a daily reward entry and can award one token per day for that share flow.' },
    ],
  },
  'season-strategy': {
    slug: 'season-strategy',
    title: 'Season Strategy Planner – AI Fantasy GM Roadmap | AllFantasy',
    description:
      'Your AI GM for the full season. Analyze one specific Sleeper team inside one specific league and get a complete plan for win window, roster pressure points, trade targets, waiver priorities, schedule leverage, and opponent intelligence.',
    headline: 'Season Strategy Planner',
    benefitSummary:
      'Get one cohesive, league-aware blueprint instead of isolated advice. The planner prices your roster, scans the rest of the league, and maps the next moves that actually fit your team direction.',
    openToolHref: '/season-strategy',
    icon: '🧠',
    badge: 'GPT-4o',
    examples: [
      'Classify your roster as contender, fringe, rebuilder, or transition using real league context',
      'Surface specific trade targets, sell candidates, waiver stash ideas, and schedule pressure points',
      'See opponent tendencies and a staged weekly action plan instead of one-off advice',
    ],
    relatedToolSlugs: ['trade-finder', 'waiver-wire-advisor', 'power-rankings', 'career-share'],
    keywords: ['season strategy planner', 'fantasy season roadmap', 'ai gm planner', 'fantasy roster blueprint', 'league strategy tool'],
    faqs: [
      { q: 'What does Season Strategy Planner analyze?', a: 'It reviews your selected Sleeper league, values your roster, looks across the other teams, and returns one full-season plan for trades, waivers, picks, and matchup timing.' },
      { q: 'Do I need to pick a league first?', a: 'Yes. This tool is league-gated because the strategy is built from your exact roster, league settings, and opponent context.' },
      { q: 'Is this just trade advice?', a: 'No. Trade ideas are only one part of the output. You also get a win-window read, waiver plan, schedule notes, draft-pick guidance, and opponent intelligence.' },
    ],
  },
  'ai-draft-assistant': {
    slug: 'ai-draft-assistant',
    title: 'AI Draft Assistant – Fantasy Draft Help | AllFantasy',
    description:
      'AllFantasy AI draft assistant helps you draft smarter with real-time rankings, strategy tips, and Chimmy AI guidance during your draft.',
    headline: 'AI Draft Assistant',
    benefitSummary:
      'Draft with AI support: rankings, strategy, and Chimmy answering your questions in real time.',
    openToolHref: '/af-legacy?tab=mock-draft',
    examples: [
      'Real-time draft rankings and suggestions',
      'Chimmy AI for draft questions',
      'Snake and auction support',
    ],
    relatedToolSlugs: ['mock-draft-simulator', 'trade-analyzer', 'waiver-wire-advisor', 'legacy-dynasty'],
    keywords: ['AI draft assistant', 'fantasy draft help', 'draft assistant', 'Chimmy AI'],
  },
  'matchup-simulator': {
    slug: 'matchup-simulator',
    title: 'Matchup Simulator – Fantasy Projections & Scenarios | AllFantasy',
    description:
      'AllFantasy matchup simulator: run season and playoff scenarios, project head-to-head outcomes, and explore dynasty simulations.',
    headline: 'Matchup Simulator',
    benefitSummary:
      'Simulate seasons, playoffs, and matchups. Use data-driven scenarios for redraft and dynasty.',
    openToolHref: '/matchup-simulator',
    examples: [
      'Season and playoff simulations',
      'Head-to-head and scoring projections',
      'Dynasty scenario modeling',
    ],
    relatedToolSlugs: ['power-rankings', 'waiver-wire-advisor', 'trade-analyzer', 'legacy-dynasty'],
    keywords: ['matchup simulator', 'fantasy simulation', 'projection tool', 'playoff simulator'],
  },
  'bracket-challenge': {
    slug: 'bracket-challenge',
    title: 'NCAA Bracket Challenge – Pools & AI Analysis | AllFantasy',
    description:
      'AllFantasy NCAA bracket challenge: create pools, invite friends, fill out brackets, and use AI to stress-test your picks. Compete in public and private contests.',
    headline: 'NCAA Bracket Challenge',
    benefitSummary:
      'Build bracket pools, track standings, and get AI bracket analysis. March Madness made social and smart.',
    openToolHref: '/brackets',
    examples: [
      'Create and join bracket pools',
      'AI bracket review and simulation',
      'Live standings and leaderboards',
    ],
    relatedToolSlugs: ['power-rankings', 'legacy-dynasty', 'trade-analyzer'],
    keywords: ['bracket challenge', 'NCAA bracket', 'March Madness', 'bracket pool'],
  },
  'power-rankings': {
    slug: 'power-rankings',
    title: 'Fantasy Power Rankings – League Rankings Tool | AllFantasy',
    description:
      'AllFantasy power rankings: see how your team stacks up across your leagues. AI-powered fantasy power rankings for multiple sports.',
    headline: 'Power Rankings',
    benefitSummary:
      'View power rankings across your leagues. Compare teams and track movement over the season.',
    openToolHref: '/power-rankings',
    examples: [
      'League and cross-league power rankings',
      'Sport-specific and multi-sport support',
      'Track rankings over time',
    ],
    relatedToolSlugs: ['matchup-simulator', 'trade-analyzer', 'waiver-wire-advisor', 'bracket-challenge'],
    keywords: ['power rankings', 'fantasy rankings', 'league rankings', 'fantasy power rankings'],
  },
  'legacy-dynasty': {
    slug: 'legacy-dynasty',
    title: 'Legacy & Dynasty Fantasy Tools | AllFantasy',
    description:
      'AllFantasy Legacy: dynasty history, hall of fame moments, legacy score, reputation system, and classic fantasy tools for long-run league play.',
    headline: 'Legacy & Dynasty Tools',
    benefitSummary:
      'Track your dynasty history, rivalries, hall of fame moments, and fantasy legacy. Deep league history and commissioner-style tools.',
    openToolHref: '/af-legacy',
    examples: [
      'Dynasty history and legacy score',
      'Hall of fame moments and reputation',
      'Trade analyzer, waiver AI, and Chimmy chat',
    ],
    relatedToolSlugs: ['trade-analyzer', 'mock-draft-simulator', 'waiver-wire-advisor', 'bracket-challenge'],
    keywords: ['dynasty fantasy', 'legacy fantasy', 'hall of fame fantasy', 'fantasy commissioner'],
  },
  'league-transfer': {
    slug: 'league-transfer',
    title: 'League Transfer – Move Your League to AllFantasy | AllFantasy',
    description:
      'Move your full league from Sleeper, Yahoo, MFL, ESPN, Fleaflicker, or Fantrax to AllFantasy with manager names, settings, rosters, draft history, playoffs, and trades copied over.',
    headline: 'League Transfer',
    benefitSummary:
      'Commissioners can move a league into AllFantasy with an exact transfer flow for league settings, managers, rosters, and historical context.',
    openToolHref: '/league-transfer',
    examples: [
      'Transfer a full Sleeper league into AllFantasy',
      'Preview manager names, format, and roster positions before import',
      'Bring draft history, playoff brackets, and trade history into one commissioner workspace',
    ],
    relatedToolSlugs: ['power-rankings', 'legacy-dynasty', 'trade-analyzer'],
    keywords: ['league transfer', 'commissioner tools', 'import fantasy league', 'move Sleeper league'],
  },
}

export function getSportCanonical(slug: SportSlug): string {
  return `${BASE}/sports/${slug}`
}

export function getToolCanonical(slug: ToolSlug): string {
  return `${BASE}/tools/${slug}`
}

export const TOOLS_HUB_TITLE = 'Fantasy Tools Hub – All Tools & Sports | AllFantasy'
export const TOOLS_HUB_DESCRIPTION =
  'Discover AllFantasy tools: trade analyzer, mock draft, waiver advisor, bracket challenge, power rankings, and AI fantasy assistant. Browse by sport and tool.'

export const CHIMMY_TITLE = 'Chimmy AI – Your Fantasy Sports Assistant | AllFantasy'
export const CHIMMY_DESCRIPTION =
  'Chimmy is AllFantasy’s AI fantasy assistant: draft help, trade analysis, waiver advice, matchup predictions, and league storytelling. Sport-specific guidance.'
