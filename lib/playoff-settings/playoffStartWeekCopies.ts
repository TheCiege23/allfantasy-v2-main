/**
 * Write a league's playoff start week into every settings-JSON copy of it, so they say what the
 * `League.playoffStartWeek` column says.
 *
 * 🛑 THE COLUMN AND THE JSON DISAGREED AT CREATION, AND THE RESOLVER READS WHICHEVER IS SET.
 * `resolvePlayoffStartWeek` reads the column first and the JSON copies only when it is null — so a
 * disagreement is silent until something reads a copy directly (the Season Outlook, the standings
 * board, Chimmy). Measured on new leagues before this: best ball NBA/NHL/MLB wrote the column from the
 * best-ball regular season (21/22/23) beside the sport default (23/25/24) in every copy; survivor left
 * the column NULL beside `playoffSettings.playoffStartWeek` 26 and `playoff_structure` 22 — so the
 * resolver read 22, inside a season that runs to week 25; guillotine, zombie and roto left it NULL
 * beside the sport default.
 *
 * `week` null (a format with no bracket) clears the copies, so the resolver and every direct reader
 * agree there is no chosen week. A copy is written only where its block exists, except
 * `playoff_structure`, which the resolver reads first and so is always written.
 *
 * Pure (no prisma): creation and the Exile Island league builder share it.
 */

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function withPlayoffStartWeekCopies(settings: Record<string, unknown>, week: number | null): Record<string, unknown> {
  const next: Record<string, unknown> = { ...settings }
  next.playoff_structure = { ...(record(settings.playoff_structure) ?? {}), playoff_start_week: week }
  const playoffSettings = record(settings.playoffSettings)
  if (playoffSettings) next.playoffSettings = { ...playoffSettings, playoffStartWeek: week, playoff_start_week: week }
  if (Object.prototype.hasOwnProperty.call(settings, 'playoffStartWeek')) next.playoffStartWeek = week
  if (Object.prototype.hasOwnProperty.call(settings, 'playoff_start_week')) next.playoff_start_week = week
  const foundation = record(settings.foundation_defaults)
  const foundationPlayoff = record(foundation?.playoff)
  if (foundation && foundationPlayoff) {
    next.foundation_defaults = { ...foundation, playoff: { ...foundationPlayoff, playoffStartWeek: week, playoff_start_week: week } }
  }
  // The schedule hands over to the playoffs in the week the bracket opens. With no bracket the
  // transition point is left as the schedule default had it.
  if (week != null) {
    if (settings.schedule_playoff_transition_point != null) next.schedule_playoff_transition_point = week
    const nextFoundation = record(next.foundation_defaults)
    const schedule = record(nextFoundation?.schedule)
    if (nextFoundation && schedule && schedule.playoff_transition_point != null) {
      next.foundation_defaults = { ...nextFoundation, schedule: { ...schedule, playoff_transition_point: week } }
    }
  }
  return next
}

/** Every JSON copy's week, for checking agreement: `undefined` where the copy is absent. */
export function readPlayoffStartWeekCopies(settings: unknown): Record<string, unknown> {
  const s = record(settings) ?? {}
  const ps = record(s.playoffSettings)
  const fd = record(record(s.foundation_defaults)?.playoff)
  return {
    'playoff_structure.playoff_start_week': record(s.playoff_structure)?.playoff_start_week,
    'playoffSettings.playoffStartWeek': ps?.playoffStartWeek,
    'playoffSettings.playoff_start_week': ps?.playoff_start_week,
    playoffStartWeek: s.playoffStartWeek,
    playoff_start_week: s.playoff_start_week,
    'foundation_defaults.playoff.playoffStartWeek': fd?.playoffStartWeek,
    'foundation_defaults.playoff.playoff_start_week': fd?.playoff_start_week,
  }
}
