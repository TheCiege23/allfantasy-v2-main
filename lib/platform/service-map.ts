import type { PlatformServiceDefinition, PlatformServiceMap } from '@/types/platform-service-map'

const sharedServices: PlatformServiceDefinition[] = [
  {
    key: 'auth',
    name: 'Auth Service',
    product: 'shared',
    responsibility: 'Login, signup, session lifecycle, social auth, reset flows.',
    endpoints: [
      '/api/auth/login',
      '/api/auth/register',
      '/api/auth/logout',
      '/api/auth/me',
      '/api/auth/password/reset/request',
      '/api/auth/password/reset/confirm',
    ],
  },
  {
    key: 'profile',
    name: 'User Profile Service',
    product: 'shared',
    responsibility: 'Profile, preferences, linked account identity fields.',
    endpoints: ['/api/auth/complete-profile', '/api/auth/me'],
  },
  {
    key: 'verification',
    name: 'Verification Service',
    product: 'shared',
    responsibility: 'Email + phone verification state and send/check actions.',
    endpoints: [
      '/api/auth/verify-email',
      '/api/auth/verify-email/send',
      '/api/verify/phone/start',
      '/api/verify/phone/check',
    ],
  },
  {
    key: 'wallet',
    name: 'Wallet/Payments Service',
    product: 'shared',
    responsibility: 'Subscriptions, token purchases, and checkout/webhook links (league dues/payouts are external).',
    endpoints: ['/api/stripe/create-checkout-session', '/api/stripe/webhook', '/api/bracket/stripe/checkout'],
  },
  {
    key: 'notifications',
    name: 'Notification Service',
    product: 'shared',
    responsibility: 'System and AI notification payloads.',
    endpoints: ['/api/market-alerts', '/api/feed'],
  },
  {
    key: 'chat',
    name: 'Chat Service',
    product: 'shared',
    responsibility: 'DM/group/league-thread messaging primitives.',
    endpoints: ['/api/chimmy', '/api/chat/chimmy', '/api/bracket/leagues/:leagueId/chat'],
  },
  {
    key: 'ai-orchestrator',
    name: 'AI Orchestrator Service',
    product: 'shared',
    responsibility: 'OpenAI/Grok/DeepSeek routing and final response assembly.',
    endpoints: ['/api/ai/chat', '/api/legacy/ai/run', '/api/chimmy', '/api/chat/chimmy'],
  },
  {
    key: 'rankings-values',
    name: 'Rankings + Value Services',
    product: 'shared',
    responsibility: 'Shared rankings and valuation outputs across products.',
    endpoints: ['/api/rankings', '/api/player-value', '/api/legacy/rankings/analyze'],
  },
  {
    key: 'news-live',
    name: 'News / Live Update Service',
    product: 'shared',
    responsibility: 'News ingestion, enrichment and live overlay feed.',
    endpoints: ['/api/sports/news', '/api/news-crawl', '/api/legacy/market/refresh'],
  },
  {
    key: 'imports',
    name: 'Import Service',
    product: 'shared',
    responsibility: 'External provider sync and legacy import workflows.',
    endpoints: ['/api/import-sleeper', '/api/import-espn', '/api/legacy/import', '/api/legacy/import/status'],
  },
]

const bracketServices: PlatformServiceDefinition[] = [
  {
    key: 'bracket-pools',
    name: 'Bracket Pool Service',
    product: 'bracket',
    responsibility: 'Pool lifecycle, join and settings.',
    endpoints: ['/api/bracket/leagues', '/api/bracket/leagues/join', '/api/bracket/leagues/:leagueId/settings'],
  },
  {
    key: 'bracket-entries',
    name: 'Bracket Entry Service',
    product: 'bracket',
    responsibility: 'Entry creation, copy and pick submission.',
    endpoints: ['/api/bracket/entries', '/api/bracket/entries/copy', '/api/bracket/entries/:entryId/pick'],
  },
  {
    key: 'bracket-standings',
    name: 'Bracket Standings Service',
    product: 'bracket',
    responsibility: 'Scoring standings and tiebreaker ranking.',
    endpoints: ['/api/bracket/leagues/:leagueId/standings'],
  },
  {
    key: 'bracket-ai',
    name: 'Bracket AI Service',
    product: 'bracket',
    responsibility: 'Matchup help, pick assist, uniqueness and strategy intelligence.',
    endpoints: ['/api/bracket/ai/matchup', '/api/bracket/ai/pick-assist', '/api/bracket/intelligence/uniqueness'],
  },
]

const webappServices: PlatformServiceDefinition[] = [
  {
    key: 'webapp-league',
    name: 'League Service',
    product: 'webapp',
    responsibility: 'League creation/list/discovery and sync.',
    endpoints: ['/api/league/create', '/api/league/list', '/api/league/discover', '/api/league/sync'],
  },
  {
    key: 'webapp-roster',
    name: 'Roster Service',
    product: 'webapp',
    responsibility: 'Roster snapshot retrieval and updates.',
    endpoints: ['/api/league/roster', '/api/roster/analyze'],
  },
  {
    key: 'webapp-waiver',
    name: 'Waiver Service',
    product: 'webapp',
    responsibility: 'Waiver recommendations and assistant outputs.',
    endpoints: ['/api/waiver-ai', '/api/waiver-ai/grok', '/api/waiver-ai-suggest'],
  },
  {
    key: 'webapp-trade',
    name: 'Trade Service',
    product: 'webapp',
    responsibility: 'Trade proposals and evaluation flows.',
    endpoints: ['/api/trade/propose', '/api/trade-evaluator', '/api/trades/analyze'],
  },
  {
    key: 'webapp-draft',
    name: 'Draft Service',
    product: 'webapp',
    responsibility: 'Mock draft board, prediction and recommendation tools.',
    endpoints: ['/api/mock-draft/simulate', '/api/mock-draft/predict-board', '/api/mock-draft/ai-pick'],
  },
]

const legacyServices: PlatformServiceDefinition[] = [
  {
    key: 'legacy-dashboard',
    name: 'Legacy Dashboard Service',
    product: 'legacy',
    responsibility: 'Offseason team scan and strategic summary outputs.',
    endpoints: ['/api/legacy/offseason-dashboard', '/api/legacy/team/direction-refresh'],
  },
  {
    key: 'legacy-trade-center',
    name: 'Legacy Trade Command Center Service',
    product: 'legacy',
    responsibility: 'Trade targets/offer templates/reopen board.',
    endpoints: ['/api/legacy/trade-command-center', '/api/legacy/trade/review'],
  },
  {
    key: 'legacy-draft-war-room',
    name: 'Legacy Draft War Room Service',
    product: 'legacy',
    responsibility: 'Pick recommendations, availability matrix, pivot plans.',
    endpoints: ['/api/legacy/draft-war-room', '/api/legacy/draft/recommendation-refresh'],
  },
  {
    key: 'legacy-market-waiver',
    name: 'Legacy Market/Waiver Service',
    product: 'legacy',
    responsibility: 'Market board + waiver stash/priority refresh.',
    endpoints: ['/api/legacy/market/refresh', '/api/legacy/waiver/analyze'],
  },
  {
    key: 'legacy-identity',
    name: 'Legacy Identity Service',
    product: 'legacy',
    responsibility: 'Resolve app user -> legacy user key for hydrated AI flows.',
    endpoints: ['/api/legacy/identity', '/api/legacy/session'],
  },
]

export function getPlatformServiceMap(): PlatformServiceMap {
  return {
    generatedAt: new Date().toISOString(),
    sharedServices,
    bracketServices,
    webappServices,
    legacyServices,
  }
}
