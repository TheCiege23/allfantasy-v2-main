/**
 * User-facing ADP / AllFantasy ADP copy — keep system vs internal aggregate clearly labeled.
 */

export const ADP_LABEL_SYSTEM = 'ADP'
export const ADP_LABEL_AI = 'AI ADP'
export const ADP_LABEL_AF = 'AF ADP'

/**
 * AF Blue — the AllFantasy brand blue. Same token and fallback the Connect Leagues surface uses
 * (`var(--af-blue, #3b82f6)`); #3b82f6 on the draft room's dark navy is ~5:1, which clears WCAG AA
 * for the 11-12px table text it is used at.
 */
export const AF_BLUE = 'var(--af-blue, #3b82f6)'

export const TOOLTIP_AF_ADP =
  'AllFantasy ADP — blends market ADP with real completed drafts from imported leagues and from AllFantasy leagues. Each draft source counts more the more drafts stand behind it.'

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

/*
 * A cross-size value is a PROJECTION, not a measurement, and the reader is owed that word.
 * lib/adp/crossSizeAdp.ts normalises picks from other league sizes to rounds and projects them
 * into this one. The arithmetic is exact, but it still describes drafts that happened at a
 * different size - it cannot know this size's own tier breaks or positional runs. Rendering it
 * identically to a measured value would present an estimate with the authority of an
 * observation, which is the honest-degradation failure this codebase names elsewhere.
 */
function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

/**
 * Explain an AF ADP figure by what actually went into it, so a reader can tell "mostly the market"
 * from "mostly 400 of our drafts". Shares come from the blend itself and already sum to 1.
 */
export function afAdpCellTitle(input: {
  hasValue: boolean
  contributions?: { market: number; imported: number; af: number } | null
  importedSampleSize?: number | null
  ownSampleSize?: number | null
}): string {
  if (!input.hasValue) return `${ADP_LABEL_AF}: No market ADP or completed drafts for this player yet.`
  const c = input.contributions
  if (!c) return `${ADP_LABEL_AF}: ${TOOLTIP_AF_ADP}`
  const parts: string[] = []
  if (c.market > 0) parts.push(`market ${pct(c.market)}`)
  if (c.imported > 0)
    parts.push(
      `imported leagues ${pct(c.imported)}${input.importedSampleSize != null ? ` (${input.importedSampleSize} drafts)` : ''}`,
    )
  if (c.af > 0)
    parts.push(`AllFantasy leagues ${pct(c.af)}${input.ownSampleSize != null ? ` (${input.ownSampleSize} drafts)` : ''}`)
  return `${ADP_LABEL_AF}: ${TOOLTIP_AF_ADP} This number: ${parts.join(', ')}.`
}

export function aiAdpCellTitle(input: {
  hasValue: boolean
  lowSample?: boolean
  sampleSize?: number | null
  source?: 'exact' | 'cross_size' | null
  contributingTeamCounts?: number[] | null
}): string {
  if (!input.hasValue) {
    return `${ADP_LABEL_AI}: ${AI_ADP_NOT_ENOUGH_DATA}.`
  }
  if (input.source === 'cross_size') {
    const sizes = (input.contributingTeamCounts ?? []).filter((n) => Number.isFinite(n))
    const from =
      sizes.length > 0
        ? ` Projected from ${sizes.join(", ")}-team drafts.`
        : ' Projected from drafts at other league sizes.'
    let t = `${ADP_LABEL_AI}: estimated for your league size.${from}`
    t +=
      ' No drafts at your exact size yet, so this is normalised by round rather than measured.'
    if (input.sampleSize != null) t += ` Picks behind it: ${input.sampleSize}.`
    return t
  }
  let s = `${ADP_LABEL_AI}: ${TOOLTIP_AI_ADP}`
  if (input.sampleSize != null) s += ` Sample size: ${input.sampleSize}.`
  if (input.lowSample) s += ' Low sample - value will firm up as more drafts complete.'
  return s
}
