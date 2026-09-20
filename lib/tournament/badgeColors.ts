/**
 * Deterministic initials-badge colours for the tournament hub.
 *
 * 🛑 DETERMINISTIC, NOT RANDOM, AND SHARED BY BOTH SCREENS. A commissioner
 * recognises their twenty leagues by colour long before they read the name, so
 * the same league must get the same tile on every render and on every screen.
 * A palette picked at render time re-colours the board on each refresh, which
 * reads as the data having changed.
 *
 * ⚠ ONE COPY OF THE HASH. Two implementations of this rule drift — the create
 * screen and the standings board would then disagree about the same league —
 * which is why this is a module rather than a helper pasted into each client.
 */

export type BadgeColor = { bg: string; fg: string }

/** Six tiles that all clear AA against their own foreground on a dark page. */
export const BADGE_COLORS: readonly BadgeColor[] = [
  { bg: '#123244', fg: '#7fd8d8' },
  { bg: '#3a1f0a', fg: '#ff9d4d' },
  { bg: '#0d2740', fg: '#7fc4ff' },
  { bg: '#3a0f13', fg: '#ff8a94' },
  { bg: '#14213a', fg: '#ff9daf' },
  { bg: '#2a2118', fg: '#ffcc4d' },
]

/**
 * ⚠ `>>> 0` ON EVERY STEP, not just the result. Without it the intermediate
 * overflows into a negative 32-bit int and `% length` then yields a negative
 * index — `BADGE_COLORS[-2]` is `undefined`, and the tile renders unstyled for
 * whichever names happen to land there.
 */
function hashString(value: string): number {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash
}

/** Stable colour for a name — used for manager avatars, where order shifts. */
export function badgeColorForName(name: string): BadgeColor {
  return BADGE_COLORS[hashString(name) % BADGE_COLORS.length]
}

/** Stable colour for a fixed position — used for league tiles within a list. */
export function badgeColorForIndex(index: number): BadgeColor {
  return BADGE_COLORS[((index % BADGE_COLORS.length) + BADGE_COLORS.length) % BADGE_COLORS.length]
}

/** "KBI Beast Gold" -> "KB". Word initials, for league and tournament tiles. */
export function initialsForName(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
  /* A name of only punctuation still needs a tile rather than an empty circle. */
  return initials || name.slice(0, 2).toUpperCase() || '—'
}

/**
 * "martinbrundle14" -> "MA". Letters only, for manager handles.
 *
 * ⚠ Handles are one token with digits in them, so word-initials would return a
 * single letter for most of the field. These take the first two LETTERS.
 */
export function avatarInitialsForName(name: string): string {
  const letters = name.replace(/[^a-zA-Z]/g, '').slice(0, 2).toUpperCase()
  return letters || name.slice(0, 2).toUpperCase() || '—'
}
