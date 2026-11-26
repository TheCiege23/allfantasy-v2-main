'use client'

/**
 * "League type" on the import confirm screen. We detect the type from what the platform reports and
 * from the league's name, but some platforms cannot say: Sleeper has no devy or C2C type at all, so a
 * C2C league there only looks like dynasty. The commissioner fixes it here, before anything is built.
 *
 * Leaving it on the detected type sends nothing. Picking one sends it with the import, where it is
 * saved as a confirmed type (lib/career/leagueTypeConfirmation.ts) so a re-sync cannot undo it.
 */

import { LEAGUE_CONCEPT_OPTIONS } from '@/lib/league/leagueConceptOptions'

/** Pirate needs a second answer (its dynasty or redraft base) that this one picker does not ask. */
export const IMPORT_LEAGUE_TYPE_OPTIONS = LEAGUE_CONCEPT_OPTIONS.filter((o) => o.id !== 'pirate')

export function ImportLeagueTypePicker(props: {
  detectedId: string
  detectedLabel: string
  value: string | null
  onChange: (next: string | null) => void
}) {
  const detected = IMPORT_LEAGUE_TYPE_OPTIONS.find((o) => o.id === props.detectedId)
  return (
    <div className="af-im-league-type" data-testid="import-league-type">
      <label className="af-label" htmlFor="import-league-type-select">
        League type
      </label>
      <select
        id="import-league-type-select"
        value={props.value ?? ''}
        onChange={(e) => props.onChange(e.target.value || null)}
      >
        <option value="">Detected: {detected?.label ?? props.detectedLabel}</option>
        {IMPORT_LEAGUE_TYPE_OPTIONS.filter((o) => o.id !== props.detectedId).map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <p className="af-im-field-help">
        {props.value
          ? 'We’ll set the league up as this type.'
          : 'Read from the platform and the league’s name. Wrong? Pick the right one — Sleeper can’t mark a league as devy or Campus to Canton.'}
      </p>
    </div>
  )
}
