/**
 * Zombie League Background Theme Configuration
 * 10 unique zombie-apocalypse themed backgrounds for commissioners and leagues
 */

export type ZombieBackgroundTheme = 
  | 'graveyard-dawn'
  | 'abandoned-hospital'
  | 'infested-city'
  | 'dark-forest'
  | 'underground-bunker'
  | 'decrepit-mansion'
  | 'wasteland-arena'
  | 'plague-laboratory'
  | 'tomb-chamber'
  | 'quarantine-zone'

export interface ZombieThemeMetadata {
  id: ZombieBackgroundTheme
  name: string
  description: string
  gradientClass: string
  accentColor: string
  textVariant: 'light' | 'dark'
}

export const ZOMBIE_BACKGROUND_THEMES: Record<ZombieBackgroundTheme, ZombieThemeMetadata> = {
  'graveyard-dawn': {
    id: 'graveyard-dawn',
    name: 'Graveyard Dawn',
    description: 'Misty graveyard with tombstones under breaking dawn',
    gradientClass: 'bg-gradient-to-br from-slate-900 via-purple-900 to-red-950',
    accentColor: '#a78bfa',
    textVariant: 'light',
  },
  'abandoned-hospital': {
    id: 'abandoned-hospital',
    name: 'Abandoned Hospital',
    description: 'Decay and rot in a forsaken medical facility',
    gradientClass: 'bg-gradient-to-br from-green-950 via-slate-900 to-gray-900',
    accentColor: '#4ade80',
    textVariant: 'light',
  },
  'infested-city': {
    id: 'infested-city',
    name: 'Infested City',
    description: 'Urban sprawl consumed by the undead horde',
    gradientClass: 'bg-gradient-to-br from-orange-950 via-red-900 to-slate-950',
    accentColor: '#fb923c',
    textVariant: 'light',
  },
  'dark-forest': {
    id: 'dark-forest',
    name: 'Dark Forest',
    description: 'Ancient woods shrouded in shadow and decay',
    gradientClass: 'bg-gradient-to-br from-emerald-950 via-slate-900 to-black',
    accentColor: '#10b981',
    textVariant: 'light',
  },
  'underground-bunker': {
    id: 'underground-bunker',
    name: 'Underground Bunker',
    description: 'Last stronghold deep beneath the surface',
    gradientClass: 'bg-gradient-to-br from-gray-900 via-slate-900 to-cyan-950',
    accentColor: '#06b6d4',
    textVariant: 'light',
  },
  'decrepit-mansion': {
    id: 'decrepit-mansion',
    name: 'Decrepit Mansion',
    description: 'Grand halls overtaken by rot and despair',
    gradientClass: 'bg-gradient-to-br from-violet-950 via-gray-900 to-red-950',
    accentColor: '#d946ef',
    textVariant: 'light',
  },
  'wasteland-arena': {
    id: 'wasteland-arena',
    name: 'Wasteland Arena',
    description: 'Post-apocalyptic battle grounds under dead sky',
    gradientClass: 'bg-gradient-to-br from-yellow-950 via-orange-900 to-gray-950',
    accentColor: '#eab308',
    textVariant: 'light',
  },
  'plague-laboratory': {
    id: 'plague-laboratory',
    name: 'Plague Laboratory',
    description: 'Scientific facility where it all began',
    gradientClass: 'bg-gradient-to-br from-lime-950 via-red-900 to-slate-950',
    accentColor: '#84cc16',
    textVariant: 'light',
  },
  'tomb-chamber': {
    id: 'tomb-chamber',
    name: 'Tomb Chamber',
    description: 'Ancient burial site awakening the dead',
    gradientClass: 'bg-gradient-to-br from-amber-950 via-slate-900 to-black',
    accentColor: '#f59e0b',
    textVariant: 'light',
  },
  'quarantine-zone': {
    id: 'quarantine-zone',
    name: 'Quarantine Zone',
    description: 'Sealed off and left to fate',
    gradientClass: 'bg-gradient-to-br from-red-950 via-pink-950 to-purple-950',
    accentColor: '#ec4899',
    textVariant: 'light',
  },
}

export const ZOMBIE_THEME_LIST = Object.values(ZOMBIE_BACKGROUND_THEMES)

export function getRandomZombieTheme(): ZombieBackgroundTheme {
  const themes = Object.keys(ZOMBIE_BACKGROUND_THEMES) as ZombieBackgroundTheme[]
  return themes[Math.floor(Math.random() * themes.length)]
}

/**
 * The scene art for a theme (`public/zombie/bg/<id>.svg`, 1600×600, from the design handoff). Every theme
 * id has one; the gradient class stays as the fallback behind it.
 */
export function zombieThemeImageSrc(themeId: ZombieBackgroundTheme): string {
  return `/zombie/bg/${themeId}.svg`
}

export function getZombieTheme(themeId: string | null | undefined): ZombieThemeMetadata | null {
  if (!themeId || !(themeId in ZOMBIE_BACKGROUND_THEMES)) return null
  return ZOMBIE_BACKGROUND_THEMES[themeId as ZombieBackgroundTheme] ?? null
}
