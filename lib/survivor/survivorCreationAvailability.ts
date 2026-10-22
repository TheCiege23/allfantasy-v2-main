/** New Survivor league creation rollout. Existing leagues remain playable in every sport. */
export const SURVIVOR_CREATION_SPORTS = ['NBA', 'NFL'] as const

export function isSurvivorCreationSportAvailable(sport: string): boolean {
  return (SURVIVOR_CREATION_SPORTS as readonly string[]).includes(sport.trim().toUpperCase())
}

/** Sports where a fresh create starts on Survivor. NFL can create Survivor but starts on Guillotine. */
export const SURVIVOR_DEFAULT_FORMAT_SPORTS = ['NBA'] as const

export function isSurvivorDefaultFormatSport(sport: string): boolean {
  return (SURVIVOR_DEFAULT_FORMAT_SPORTS as readonly string[]).includes(sport.trim().toUpperCase())
}

export const SURVIVOR_CREATION_UNAVAILABLE_MESSAGE =
  'New Survivor leagues are available for NBA and NFL during the pilot. Other sports will be added after their season flows are ready.'

/** Do not accept buy-ins while Survivor is a preview and unattended hosting is disabled. */
export const SURVIVOR_PAID_CREATION_ENABLED = false
export const SURVIVOR_PAID_CREATION_UNAVAILABLE_MESSAGE =
  'Survivor pilot leagues are free while full-season hosting is being certified.'
