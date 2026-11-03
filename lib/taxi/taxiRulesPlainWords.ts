/**
 * The taxi squad settings in plain words, for the "What this changes" panel beside the taxi editor
 * (app/league/[leagueId]/components/settings/TaxiSquadSettingsSection.tsx). Pure and client-safe.
 *
 * Each line is a dictionary key plus its placeholders (lib/i18n/translations.ts, Spanish in
 * translations-es-parity.ts). What each line claims is what the roster validator enforces —
 * `validateTaxiSectionAgainstLeague` in lib/roster-lineup-engine/rosterValidationService.ts:
 *   - `taxiSlots` 0 turns the taxi squad off (no checks run at all);
 *   - `taxiAllowNonRookies` false refuses any player with more than 0 years of experience;
 *   - `taxiYearsLimit` N > 0 refuses a player with more than N years; 0 means no cap.
 * So when the taxi is rookie-only the experience cap never comes into play, and the panel says so
 * rather than describing a limit that cannot bite.
 */

export type TaxiRuleLine = { key: string; vars?: Record<string, string | number> }

export function taxiRulesInPlainWords(input: {
  slots: number
  yearsLimit: number
  allowNonRookies: boolean
}): TaxiRuleLine[] {
  const slots = Math.max(0, Math.floor(input.slots))
  if (slots === 0) return [{ key: 'taxiPanel.off' }]

  const lines: TaxiRuleLine[] = [
    slots === 1 ? { key: 'taxiPanel.slotsOne' } : { key: 'taxiPanel.slots', vars: { count: slots } },
  ]
  if (!input.allowNonRookies) {
    lines.push({ key: 'taxiPanel.rookiesOnly' })
    return lines
  }
  const years = Math.max(0, Math.floor(input.yearsLimit))
  if (years === 0) lines.push({ key: 'taxiPanel.yearsAny' })
  else if (years === 1) lines.push({ key: 'taxiPanel.yearsOne' })
  else lines.push({ key: 'taxiPanel.years', vars: { count: years } })
  return lines
}

/** The teams that hold more taxi players than `slots` — the ones a lower count would leave over. */
export function teamsOverTaxiLimit(held: ReadonlyArray<{ teamName: string; count: number }>, slots: number): string[] {
  return held.filter((t) => t.count > slots).map((t) => t.teamName)
}
