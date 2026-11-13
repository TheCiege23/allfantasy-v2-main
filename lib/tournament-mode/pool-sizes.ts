/**
 * Tournament hub participant pools.
 *
 * Legacy tiers (72 / 144 / 216) were exact multiples of 12 managers × N feeders.
 * New Create-League-v2 tiers (32 / 64 / 96 / 128 / 160 / 192 / 224) let commissioners
 * pick tighter brackets; `computeLeagueCount(pool, 12)` floors the division so any
 * remainder managers land in a partial feeder during scheduling.
 */
export const TOURNAMENT_PARTICIPANT_POOL_SIZES_EXTENDED = [
  32,
  64,
  72,
  96,
  128,
  144,
  160,
  192,
  216,
  224,
] as const

