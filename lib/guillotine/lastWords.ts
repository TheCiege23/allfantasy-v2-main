/**
 * Last words: the parting message a chopped manager leaves the league (owner's "fun" list, 2026-11-25; the
 * idea is ESPN Knockout's). The moment a team is cut is the moment its manager would otherwise close the app.
 * This gives them one thing to do, and gives the league something to read beside the chop.
 *
 * The rules, kept small on purpose:
 *   - one message per chopped team, written by that team's manager;
 *   - short, plain text: no links to click, no markup, nothing that can break a card;
 *   - it can be rewritten until the NEXT chop happens (a typo is not forever), then it is history;
 *   - the commissioner can remove one, and a removed message cannot be written again.
 *
 * Stored as `last_words` events in the guillotine event log (append-only, no schema change): the newest event
 * for a team is its message, and a `removed` event ends it. Pure, so the Chop page can import it. The reads
 * and the write are in ./lastWordsStore.ts.
 */

export const LAST_WORDS_MAX = 200
export const LAST_WORDS_EVENT = 'last_words' as const

export type LastWords = {
  rosterId: string
  /** The week the team was chopped in. */
  week: number
  text: string
  /** ISO time it was written (the newest version). */
  at: string
}

export type LastWordsError = 'empty' | 'too_long' | 'has_link'

const LINK = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|net|org|io|gg|co|xyz|app|me|tv|ly)\b/i

/**
 * Clean what a manager typed. Line breaks and runs of spaces become single spaces (it is shown on one card),
 * control characters are dropped, and it is refused when empty, too long, or carrying a link.
 */
export function normalizeLastWords(raw: unknown): { ok: true; value: string } | { ok: false; error: LastWordsError; message: string } {
  const text = String(typeof raw === 'string' ? raw : '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u2028\u2029\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return { ok: false, error: 'empty', message: 'Write something first.' }
  if ([...text].length > LAST_WORDS_MAX) return { ok: false, error: 'too_long', message: `Keep it to ${LAST_WORDS_MAX} characters.` }
  if (LINK.test(text)) return { ok: false, error: 'has_link', message: 'Last words cannot include a link.' }
  return { ok: true, value: text }
}

type StoredEvent = { metadata: unknown; createdAt: Date | string }

const record = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/**
 * Each chopped team's standing message, from the league's `last_words` events in any order. The newest event
 * for a team wins; a `removed` one means the team has none, and nothing written before OR after it counts.
 */
export function lastWordsByRoster(events: ReadonlyArray<StoredEvent>): { words: Map<string, LastWords>; removed: Set<string> } {
  const sorted = [...events].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  const words = new Map<string, LastWords>()
  const removed = new Set<string>()
  for (const e of sorted) {
    const m = record(e.metadata)
    const rosterId = typeof m.rosterId === 'string' ? m.rosterId : ''
    if (!rosterId) continue
    if (m.removed === true) {
      removed.add(rosterId)
      words.delete(rosterId)
      continue
    }
    if (removed.has(rosterId)) continue
    const text = typeof m.text === 'string' ? m.text : ''
    const week = typeof m.week === 'number' && Number.isInteger(m.week) ? m.week : null
    if (!text || week == null) continue
    words.set(rosterId, { rosterId, week, text, at: new Date(e.createdAt).toISOString() })
  }
  return { words, removed }
}

export type LastWordsWindow = 'open' | 'closed' | 'removed' | 'not_chopped'

/**
 * May this team's manager write (or rewrite) its last words now?
 *
 * `choppedWeek` is the week the team was cut (null: it is still alive) and `latestChopWeek` the most recent
 * week any team was cut. The window is open while those are the same week: once a later chop has happened,
 * the league has moved on and the message is history.
 */
export function lastWordsWindow(input: { choppedWeek: number | null; latestChopWeek: number | null; removed: boolean }): LastWordsWindow {
  if (input.choppedWeek == null) return 'not_chopped'
  if (input.removed) return 'removed'
  if (input.latestChopWeek != null && input.latestChopWeek > input.choppedWeek) return 'closed'
  return 'open'
}
