/**
 * Where a Chimmy question was asked, as the question row records it (`chimmy_context_runs.intent`,
 * see ./chatQuestion.ts). Pure and client-safe on purpose: the drawer's thumbs up/down tags its
 * rating with the same words, so a rating joins to its question without a second vocabulary.
 *
 * The drawer names its /core screen (`drawer:<screen>`); every other caller its `source`
 * (`messages_ai` is the /chimmy/chat page).
 */
export function questionEntry(args: { source?: string | null; coreSurface?: string | null }): string {
  const surface = typeof args.coreSurface === 'string' ? args.coreSurface.trim() : ''
  if (surface) return `drawer:${surface}`.slice(0, 48)
  const source = typeof args.source === 'string' ? args.source.trim() : ''
  return (source || 'unknown').slice(0, 48)
}
