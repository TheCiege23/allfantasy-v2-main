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
