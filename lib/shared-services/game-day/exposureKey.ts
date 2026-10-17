import { rosterIdSpaceOf } from '@/lib/core-app/rosterIdSpace'

/**
 * The key one player is merged under across a user's leagues: his id IN ITS OWN ID SPACE.
 *
 * 🛑 THIS WAS THE BARE ID, AND THE SAME NUMBER IS A DIFFERENT PERSON IN EACH SPACE. A native NHL
 * roster holds Rolling Insights ids, and 13 of the 18 on the one production NHL roster reachable by
 * `computeUserPlayerExposure` ARE NFL Sleeper ids for somebody else (1332 = Ifeanyi Momah,
 * 2026-09-29); an ESPN or Fleaflicker id collides the same way. Merged on the bare id, two people
 * became one "player" with the sum of their leagues, and every Sleeper-keyed reader downstream named
 * or injured the wrong one. Sleeper and native leagues share Sleeper's space (`rosterIdSpaceOf`),
 * split by sport; each foreign platform is its own.
 *
 * Its own module so a test that mocks the exposure service does not silently drop the join key.
 */
export function exposureKey(platform: string | null | undefined, sport: string | null | undefined, playerId: string): string {
  const space = rosterIdSpaceOf(platform) === 'sleeper' ? 'sleeper' : String(platform ?? '').trim().toLowerCase()
  return `${space}:${String(sport ?? 'NFL').toUpperCase()}:${playerId}`
}
