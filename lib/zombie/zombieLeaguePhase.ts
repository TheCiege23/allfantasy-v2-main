/**
 * What a Zombie league's `status` means, for explanation surfaces such as Chimmy.
 *
 * Only statuses the code actually writes or checks are described: `setup` (created by the setup
 * engine), `registering` (set when setup finishes), `paused` (commissioner action) and `active`
 * (checked by automation and the UI). Nothing currently WRITES `active`, and weekly automation
 * runs for `registering` leagues too, so `registering` is described by that behaviour rather than
 * by its name. Anything else is reported raw, without inventing a meaning.
 *
 * Pure and client-safe.
 */
export type ZombieLeaguePhase = {
  status: string
  label: string
  meaning: string
  /** True only when the season has clearly not started, so there is no current week to report. */
  beforeSeason: boolean
}

export function describeZombieLeaguePhase(status: string | null | undefined): ZombieLeaguePhase {
  const raw = (status ?? '').trim()
  switch (raw) {
    case 'setup':
      return {
        status: raw,
        label: 'Setup',
        meaning:
          'The league is still being configured. The season has not started, so there are no infections, resource uses or ambushes yet, and the Whisperer may not have been chosen.',
        beforeSeason: true,
      }
    case 'registering':
      return {
        status: raw,
        label: 'Registering',
        meaning:
          'Weekly Zombie automation runs in this state the same as an active league, so weekly results may already exist. Rely on the week and statuses below.',
        beforeSeason: false,
      }
    case 'active':
      return {
        status: raw,
        label: 'In season',
        meaning: 'Weekly Zombie automation is running.',
        beforeSeason: false,
      }
    case 'paused':
      return {
        status: raw,
        label: 'Paused',
        meaning:
          'The commissioner has paused the league. Weekly automation does not run until it is resumed, so nothing new resolves.',
        beforeSeason: false,
      }
    case '':
      return {
        status: 'unknown',
        label: 'Unknown',
        meaning: 'No league status is recorded. Do not assume where the season is.',
        beforeSeason: false,
      }
    default:
      return {
        status: raw,
        label: raw,
        meaning: 'Unrecognised league status. Do not infer what it means.',
        beforeSeason: false,
      }
  }
}
