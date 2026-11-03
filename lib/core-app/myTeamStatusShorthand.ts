/**
 * The injury designation, in the shorthand managers actually use (My team's status column).
 *
 * Moved out of components/core-app/screens/MyTeam.tsx unchanged so it can be tested, with three
 * designations the football-first table did not know — all three are what an NBA / NHL / MLB feed
 * actually sends, and all three used to fall through to the "first three letters" rule:
 *
 *   "Day-To-Day"   → was "DAY" with no tone (read as a word, not a status) → DTD, warn
 *   "Game-Time Decision" / "GTD" → was "GAM"                               → GTD, warn
 *   "10-Day IL" / "Injured List" / "IL" → was "10-" / "INJ" / "IL", toneless → IL, bad
 *
 * THE FULL WORDS WERE THE WIDEST THING ON THE ROW. "NO DESIGNATION" is fourteen characters carrying
 * one bit of information. The full word survives as the title and the aria-label, so nothing is lost
 * for anyone who does not know the shorthand or is using a screen reader.
 */
export type StatusTone = 'ok' | 'warn' | 'bad' | 'none'

export function statusShorthand(status: string): { short: string; tone: StatusTone; full: string } {
  const t = status.trim().toLowerCase()
  if (t.includes('did not practice') || t === 'dnp') return { short: 'DNP', tone: 'warn', full: status }
  if (t.includes('injured reserve') || t === 'ir') return { short: 'IR', tone: 'bad', full: status }
  // MLB's injured list ("10-Day IL", "60-day IL", "IL15"). Before day-to-day, which "10-day" resembles.
  if (t.includes('injured list') || t === 'il' || /(^|[^a-z])il ?\d*$/.test(t)) return { short: 'IL', tone: 'bad', full: status }
  if (t.includes('suspend')) return { short: 'SUS', tone: 'bad', full: status }
  if (t.includes('pup')) return { short: 'PUP', tone: 'bad', full: status }
  if (t.includes('day-to-day') || t.includes('day to day') || t === 'dtd') return { short: 'DTD', tone: 'warn', full: status }
  if (t.includes('game-time') || t.includes('game time') || t === 'gtd') return { short: 'GTD', tone: 'warn', full: status }
  if (t.includes('doubt')) return { short: 'D', tone: 'bad', full: status }
  if (t.includes('question')) return { short: 'Q', tone: 'warn', full: status }
  if (t.includes('out')) return { short: 'O', tone: 'bad', full: status }
  if (t.includes('probable')) return { short: 'P', tone: 'ok', full: status }
  /* ⚠ BEFORE 'active', WHICH IT CONTAINS. "Inactive" used to fall through to the
     line below and render as a green H for Healthy. */
  if (t.includes('inactive')) return { short: 'INA', tone: 'bad', full: status }
  if (t.includes('active') || t.includes('healthy')) return { short: 'H', tone: 'ok', full: 'Healthy' }
  /* An unfamiliar designation is shown as-is rather than given an invented
     letter, because a wrong abbreviation is worse than a long one. */
  return { short: status.slice(0, 3).toUpperCase(), tone: 'none', full: status }
}
