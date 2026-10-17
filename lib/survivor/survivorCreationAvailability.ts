/** New Survivor league creation rollout. Existing leagues remain playable in every sport. */
export const SURVIVOR_CREATION_SPORTS = ['NBA'] as const

export function isSurvivorCreationSportAvailable(sport: string): boolean {
  return (SURVIVOR_CREATION_SPORTS as readonly string[]).includes(sport.trim().toUpperCase())
}

export const SURVIVOR_CREATION_UNAVAILABLE_MESSAGE =
  'New Survivor leagues are available for NBA during the pilot. Other sports will be added after their season flows are ready.'

/** Do not accept buy-ins while NBA Survivor is a preview and unattended hosting is disabled. */
export const SURVIVOR_PAID_CREATION_ENABLED = false
export const SURVIVOR_PAID_CREATION_UNAVAILABLE_MESSAGE =
  'NBA Survivor pilot leagues are free while full-season hosting is being certified.'
