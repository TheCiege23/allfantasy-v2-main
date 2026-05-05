/**
 * User-facing ADP / AllFantasy ADP copy — keep system vs internal aggregate clearly labeled.
 */

export const ADP_LABEL_SYSTEM = 'ADP'
export const ADP_LABEL_AI = 'AI ADP'

export const TOOLTIP_SYSTEM_ADP =
  'Imported / consensus average draft position when available from your data provider. Lower is earlier.'

export const TOOLTIP_AI_ADP =
  'AllFantasy ADP — aggregated from real completed drafts in this app that match this sport and league context. Separate from imported ADP.'

/** When the AI ADP segment has no snapshot rows yet */
export const AI_ADP_NOT_ENOUGH_DATA = 'Not enough AllFantasy draft data yet'

/** When commissioner enables AI ADP but API returns empty segment */
export const AI_ADP_UNAVAILABLE_FRIENDLY = AI_ADP_NOT_ENOUGH_DATA

export function formatAiAdpUnavailableBanner(serverMessage: string | null | undefined): string {
  const m = String(serverMessage ?? '').trim()
  if (!m) return AI_ADP_NOT_ENOUGH_DATA
  if (/unavailable|not ready|no snapshot/i.test(m)) return AI_ADP_NOT_ENOUGH_DATA
  return m
}

export function systemAdpCellTitle(hasValue: boolean): string {
  if (hasValue) return `${ADP_LABEL_SYSTEM}: ${TOOLTIP_SYSTEM_ADP}`
  return `${ADP_LABEL_SYSTEM}: No imported ADP for this player in the current pool.`
}

export function aiAdpCellTitle(input: {
  hasValue: boolean
  lowSample?: boolean
  sampleSize?: number | null
}): string {
  if (!input.hasValue) {
    return `${ADP_LABEL_AI}: ${AI_ADP_NOT_ENOUGH_DATA}.`
  }
  let s = `${ADP_LABEL_AI}: ${TOOLTIP_AI_ADP}`
  if (input.sampleSize != null) s += ` Sample size: ${input.sampleSize}.`
  if (input.lowSample) s += ' Low sample — value will firm up as more drafts complete.'
  return s
}
