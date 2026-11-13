export const SURVIVOR_BACKGROUND_THEME_IDS = [
  'island-dawn',
  'volcanic-tribal',
  'jungle-mist',
  'moonlit-lagoon',
  'storm-beach',
  'ember-camp',
  'reef-sunrise',
  'mangrove-night',
  'canyon-fire',
  'monsoon-canopy',
] as const

export type SurvivorBackgroundThemeId = (typeof SURVIVOR_BACKGROUND_THEME_IDS)[number]

export type SurvivorBackgroundTheme = {
  id: SurvivorBackgroundThemeId
  name: string
  backgroundClass: string
  panelClass: string
  accent: string
}

export const SURVIVOR_BACKGROUND_THEMES: Record<SurvivorBackgroundThemeId, SurvivorBackgroundTheme> = {
  'island-dawn': {
    id: 'island-dawn',
    name: 'Island Dawn',
    backgroundClass: 'bg-[radial-gradient(circle_at_top_left,rgba(251,191,36,0.22),transparent_22%),radial-gradient(circle_at_top_right,rgba(16,185,129,0.18),transparent_24%),linear-gradient(180deg,#0b1820_0%,#08221a_52%,#05110e_100%)]',
    panelClass: 'from-amber-500/14 via-emerald-500/10 to-cyan-500/8',
    accent: '#f59e0b',
  },
  'volcanic-tribal': {
    id: 'volcanic-tribal',
    name: 'Volcanic Tribal',
    backgroundClass: 'bg-[radial-gradient(circle_at_top,rgba(239,68,68,0.24),transparent_28%),radial-gradient(circle_at_bottom_left,rgba(245,158,11,0.18),transparent_25%),linear-gradient(180deg,#17090a_0%,#1c0d0d_48%,#090909_100%)]',
    panelClass: 'from-red-500/16 via-orange-500/10 to-amber-500/8',
    accent: '#ef4444',
  },
  'jungle-mist': {
    id: 'jungle-mist',
    name: 'Jungle Mist',
    backgroundClass: 'bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.20),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(45,212,191,0.16),transparent_22%),linear-gradient(180deg,#07140f_0%,#0b2218_55%,#06110d_100%)]',
    panelClass: 'from-emerald-500/14 via-teal-500/10 to-lime-500/8',
    accent: '#22c55e',
  },
  'moonlit-lagoon': {
    id: 'moonlit-lagoon',
    name: 'Moonlit Lagoon',
    backgroundClass: 'bg-[radial-gradient(circle_at_top_right,rgba(59,130,246,0.22),transparent_25%),radial-gradient(circle_at_left,rgba(168,85,247,0.16),transparent_20%),linear-gradient(180deg,#08101f_0%,#0a1a2c_52%,#050c15_100%)]',
    panelClass: 'from-sky-500/14 via-blue-500/10 to-violet-500/8',
    accent: '#60a5fa',
  },
  'storm-beach': {
    id: 'storm-beach',
    name: 'Storm Beach',
    backgroundClass: 'bg-[radial-gradient(circle_at_top,rgba(125,211,252,0.18),transparent_20%),radial-gradient(circle_at_bottom,rgba(148,163,184,0.18),transparent_28%),linear-gradient(180deg,#0a1119_0%,#14202c_50%,#081018_100%)]',
    panelClass: 'from-slate-400/12 via-sky-500/10 to-cyan-500/8',
    accent: '#94a3b8',
  },
  'ember-camp': {
    id: 'ember-camp',
    name: 'Ember Camp',
    backgroundClass: 'bg-[radial-gradient(circle_at_bottom_left,rgba(251,146,60,0.22),transparent_24%),radial-gradient(circle_at_top_right,rgba(245,158,11,0.16),transparent_20%),linear-gradient(180deg,#120c09_0%,#1c140e_55%,#090806_100%)]',
    panelClass: 'from-orange-500/16 via-amber-500/10 to-rose-500/8',
    accent: '#fb923c',
  },
  'reef-sunrise': {
    id: 'reef-sunrise',
    name: 'Reef Sunrise',
    backgroundClass: 'bg-[radial-gradient(circle_at_top_left,rgba(251,146,60,0.18),transparent_18%),radial-gradient(circle_at_right,rgba(45,212,191,0.18),transparent_22%),linear-gradient(180deg,#09151d_0%,#0c2430_48%,#071118_100%)]',
    panelClass: 'from-orange-400/14 via-cyan-500/10 to-teal-500/8',
    accent: '#2dd4bf',
  },
  'mangrove-night': {
    id: 'mangrove-night',
    name: 'Mangrove Night',
    backgroundClass: 'bg-[radial-gradient(circle_at_top_left,rgba(20,184,166,0.18),transparent_20%),radial-gradient(circle_at_bottom_right,rgba(99,102,241,0.14),transparent_22%),linear-gradient(180deg,#071116_0%,#0a181d_56%,#050c0f_100%)]',
    panelClass: 'from-teal-500/14 via-cyan-500/8 to-indigo-500/8',
    accent: '#14b8a6',
  },
  'canyon-fire': {
    id: 'canyon-fire',
    name: 'Canyon Fire',
    backgroundClass: 'bg-[radial-gradient(circle_at_left,rgba(244,63,94,0.18),transparent_18%),radial-gradient(circle_at_top_right,rgba(249,115,22,0.20),transparent_24%),linear-gradient(180deg,#150a0c_0%,#231010_54%,#080607_100%)]',
    panelClass: 'from-rose-500/14 via-red-500/10 to-orange-500/8',
    accent: '#f97316',
  },
  'monsoon-canopy': {
    id: 'monsoon-canopy',
    name: 'Monsoon Canopy',
    backgroundClass: 'bg-[radial-gradient(circle_at_top,rgba(34,197,94,0.16),transparent_20%),radial-gradient(circle_at_bottom_left,rgba(59,130,246,0.16),transparent_24%),linear-gradient(180deg,#071119_0%,#0a1a18_50%,#060d12_100%)]',
    panelClass: 'from-green-500/12 via-emerald-500/10 to-blue-500/8',
    accent: '#34d399',
  },
}

export const SURVIVOR_TRIBE_ICON_CHOICES = [
  '🔥','🌴','🦂','🦈','🐍','🦅','🐅','🐺','🦍','🦜',
  '🐗','🦎','🐊','🐢','🦑','🐙','🦀','🐠','🪸','🌊',
  '⛰️','🌋','🌙','☀️','⚡','🌪️','🌿','🍃','🪵','🪨',
  '🏝️','🛖','🗿','🪶','🛡️','⚔️','🏹','🎯','🧭','🔥',
  '👑','💀','📜','🕯️','🥥','🍍','🦴','🐚','🪙','⭐',
] as const

export function getRandomSurvivorThemeId(): SurvivorBackgroundThemeId {
  return SURVIVOR_BACKGROUND_THEME_IDS[Math.floor(Math.random() * SURVIVOR_BACKGROUND_THEME_IDS.length)]
}

export function pickSurvivorThemeIdForLeague(leagueId: string): SurvivorBackgroundThemeId {
  let hash = 0
  for (let index = 0; index < leagueId.length; index += 1) {
    hash = (hash * 31 + leagueId.charCodeAt(index)) >>> 0
  }
  return SURVIVOR_BACKGROUND_THEME_IDS[hash % SURVIVOR_BACKGROUND_THEME_IDS.length]
}

export function getSurvivorThemeById(themeId: string | null | undefined, leagueId?: string): SurvivorBackgroundTheme {
  const resolved = themeId && themeId in SURVIVOR_BACKGROUND_THEMES
    ? (themeId as SurvivorBackgroundThemeId)
    : pickSurvivorThemeIdForLeague(leagueId ?? 'survivor')
  return SURVIVOR_BACKGROUND_THEMES[resolved]
}

export function extractLeadingTribeIcon(name: string | null | undefined): string | null {
  const safe = (name ?? '').trim()
  if (!safe) return null
  const matched = SURVIVOR_TRIBE_ICON_CHOICES.find((icon) => safe.startsWith(`${icon} `) || safe === icon)
  return matched ?? null
}

export function stripLeadingTribeIcon(name: string | null | undefined): string {
  const safe = (name ?? '').trim()
  const icon = extractLeadingTribeIcon(safe)
  if (!icon) return safe
  return safe.slice(icon.length).trim()
}

export function composeTribeName(icon: string | null | undefined, name: string | null | undefined): string {
  const cleanName = stripLeadingTribeIcon(name)
  const cleanIcon = SURVIVOR_TRIBE_ICON_CHOICES.includes((icon ?? '') as (typeof SURVIVOR_TRIBE_ICON_CHOICES)[number])
    ? icon ?? ''
    : ''
  return cleanIcon ? `${cleanIcon} ${cleanName || 'Tribe'}`.trim() : (cleanName || 'Tribe')
}

export function withSurvivorVisualTheme(engineSpecV2: unknown, leagueId: string, requestedThemeId?: string | null): object {
  const base = engineSpecV2 && typeof engineSpecV2 === 'object' && !Array.isArray(engineSpecV2)
    ? { ...(engineSpecV2 as Record<string, unknown>) }
    : {}
  const presentation = base.presentation && typeof base.presentation === 'object' && !Array.isArray(base.presentation)
    ? { ...(base.presentation as Record<string, unknown>) }
    : {}
  presentation.visualThemeId = requestedThemeId && requestedThemeId in SURVIVOR_BACKGROUND_THEMES
    ? requestedThemeId
    : (typeof presentation.visualThemeId === 'string' && presentation.visualThemeId in SURVIVOR_BACKGROUND_THEMES
      ? presentation.visualThemeId
      : getRandomSurvivorThemeId())
  return {
    ...base,
    presentation,
    visualThemeId: presentation.visualThemeId,
    visualThemeName: getSurvivorThemeById(String(presentation.visualThemeId), leagueId).name,
  }
}

export function readSurvivorVisualThemeId(engineSpecV2: unknown, leagueId: string): SurvivorBackgroundThemeId {
  if (engineSpecV2 && typeof engineSpecV2 === 'object' && !Array.isArray(engineSpecV2)) {
    const record = engineSpecV2 as Record<string, unknown>
    const nested = record.presentation && typeof record.presentation === 'object' && !Array.isArray(record.presentation)
      ? (record.presentation as Record<string, unknown>).visualThemeId
      : null
    const topLevel = record.visualThemeId
    const candidate = typeof nested === 'string' ? nested : (typeof topLevel === 'string' ? topLevel : null)
    if (candidate && candidate in SURVIVOR_BACKGROUND_THEMES) {
      return candidate as SurvivorBackgroundThemeId
    }
  }
  return pickSurvivorThemeIdForLeague(leagueId)
}
