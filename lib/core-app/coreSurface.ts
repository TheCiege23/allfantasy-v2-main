export const CORE_SURFACE_KEYS = [
  'home',
  'my-team',
  'matchup',
  'war-room',
  'waivers',
  'trades',
  'players',
  'draft-hq',
  'week',
  'live',
  'standings',
  'season-outlook',
  'career',
  'rankings',
  'portfolio',
  'notifications',
  'sync',
  'tools',
] as const

export type CoreSurfaceKey = (typeof CORE_SURFACE_KEYS)[number]

export const CORE_SURFACE_LABELS: Record<CoreSurfaceKey, string> = {
  home: 'League overview',
  'my-team': 'My team',
  matchup: 'Matchup',
  'war-room': 'War Room',
  waivers: 'Waivers',
  trades: 'Trades',
  players: 'Player Finder',
  'draft-hq': 'Draft HQ',
  week: 'Your week',
  live: 'Live scores',
  standings: 'Standings',
  'season-outlook': 'Season Outlook',
  career: 'Your career',
  rankings: 'Rankings',
  portfolio: 'Portfolio',
  notifications: 'Notifications',
  sync: 'Sync status',
  tools: 'Tools',
}
export function isCoreSurfaceKey(value: string): value is CoreSurfaceKey {
  return (CORE_SURFACE_KEYS as readonly string[]).includes(value)
}

export function renderCoreSurfacePrompt(surface: CoreSurfaceKey): string {
  return [
    '## CORE SCREEN CONTEXT',
    `The user opened Chimmy from AllFantasy Core → ${CORE_SURFACE_LABELS[surface]}.`,
    'Treat the selected league grounding and Decision OS evidence as authoritative. Answer the question in the context of this screen when relevant, name any missing or stale input, and send roster-changing actions to the source platform.',
  ].join('\n')
}
