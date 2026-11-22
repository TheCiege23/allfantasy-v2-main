/**
 * The text a commissioner copies to paste into their league's own chat, shaped for where it is
 * going. Pure and client-safe.
 *
 * Plain text only: none of the host platforms render markdown in league chat. Sleeper's chat shows
 * emoji, so it gets a megaphone; the others get the bare line, so nothing arrives as a box glyph.
 */
export function formatForPlatform(text: string, platform: string | null | undefined): string {
  const clean = text
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return String(platform ?? '').toLowerCase() === 'sleeper' ? `📣 ${clean}` : clean
}

/** Display names for the platforms an imported league can come from. */
export function platformDisplayName(platform: string | null | undefined): string {
  const p = String(platform ?? '').toLowerCase()
  const names: Record<string, string> = {
    sleeper: 'Sleeper',
    espn: 'ESPN',
    yahoo: 'Yahoo',
    mfl: 'MFL',
    myfantasyleague: 'MFL',
    fleaflicker: 'Fleaflicker',
    fantrax: 'Fantrax',
    nfl: 'NFL.com',
  }
  return names[p] ?? (p ? p.charAt(0).toUpperCase() + p.slice(1) : 'your platform')
}

/**
 * A whole week of storylines as one block to paste into another platform's league chat: a heading,
 * then each matchup with its lines. Plain text, one line per storyline, a blank line between matchups.
 */
export function formatWeekForPlatform(
  input: { heading: string; sections: ReadonlyArray<{ title: string; lines: readonly string[] }> },
  platform: string | null | undefined,
): string {
  const blocks = input.sections
    .map((section) => ({ title: section.title.trim(), lines: section.lines.map((line) => formatForPlatform(line, null)).filter(Boolean) }))
    .filter((section) => section.lines.length > 0)
    .map((section) => [section.title, ...section.lines.map((line) => `- ${line}`)].join('\n'))
  if (blocks.length === 0) return ''
  return [formatForPlatform(input.heading, platform), ...blocks].join('\n\n')
}

/** Rivalry week's pairings as text to paste into a league chat. */
export function formatRivalryWeekForPlatform(
  input: {
    heading: string
    byeLabel: string
    pairs: ReadonlyArray<{ homeName: string; awayName: string | null; reasons?: readonly string[]; context?: string | null }>
  },
  platform: string | null | undefined,
): string {
  const lines = input.pairs.map((pair) => {
    if (!pair.awayName) return `${pair.homeName} - ${input.byeLabel}`
    const why = [...(pair.reasons ?? []), ...(pair.context ? [pair.context] : [])].join(', ')
    return why ? `${pair.homeName} vs ${pair.awayName} (${why})` : `${pair.homeName} vs ${pair.awayName}`
  })
  if (lines.length === 0) return ''
  return [formatForPlatform(input.heading, platform), ...lines].join('\n')
}
