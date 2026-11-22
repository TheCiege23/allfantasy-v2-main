/**
 * A survivor game phase in words, for a screen. The stored values (`pre_merge`, `post_swap`, ...) are
 * keys, and the commissioner's command center printed them raw. A value not listed here is shown with
 * its underscores as spaces, so a new phase never appears as a key.
 */
const WORDS: Record<string, string> = {
  pre_draft: 'Before the draft',
  drafting: 'Drafting',
  tribe: 'Tribes',
  pre_merge: 'Before the merge',
  post_swap: 'After the tribe swap',
  merge: 'The merge',
  merged: 'After the merge',
  post_merge: 'After the merge',
  jury: 'Jury',
  finale: 'Finale',
  complete: 'Season over',
}

export function survivorPhaseWords(phase: string | null | undefined): string | null {
  const key = String(phase ?? '').trim()
  if (!key) return null
  const known = WORDS[key.toLowerCase()]
  if (known) return known
  const spaced = key.replace(/_+/g, ' ').trim()
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : null
}
