/**
 * Last words: the reads and the write (rules in ./lastWords.ts).
 *
 * WHO MAY WRITE is decided here, on the server, from the tables: the viewer's own roster
 * (`findViewerRosterId` in the route) must have been chopped (`GuillotineRosterState.choppedAt`), and no later
 * chop may have happened. The page only ever shows what this allows.
 *
 * WHAT IS REFUSED: text the chat would mask (lib/chat-core/censorProfanity.ts, the same word list), because a
 * card of asterisks is not a parting message. It is refused with a reason, not silently cleaned.
 *
 * A message also goes into the league chat ONCE, as the manager's own post, the first time it is written. A
 * rewrite changes the card and does not post again, so a manager cannot fill the chat by editing.
 *
 * A chop that the commissioner undoes takes its last words with it: only a team that is chopped NOW, in the
 * week the message was written for, has one.
 */
import { prisma } from '@/lib/prisma'
import { hasProfanity } from '@/lib/chat-core/censorProfanity'
import { appendEvent } from './GuillotineEventLog'
import { LAST_WORDS_EVENT, lastWordsByRoster, lastWordsWindow, normalizeLastWords } from './lastWords'

export type LastWordsState = {
  /** Every chopped team's standing message, newest chop first. */
  entries: Array<{ rosterId: string; week: number; text: string }>
  /** The viewer's own team, when it has been chopped. `text` null: nothing written yet. */
  mine: { week: number; text: string | null; window: 'open' | 'closed' | 'removed' } | null
}

async function read(leagueId: string) {
  const [states, events] = await Promise.all([
    prisma.guillotineRosterState.findMany({ where: { leagueId, choppedAt: { not: null } }, select: { rosterId: true, choppedInPeriod: true } }),
    prisma.guillotineEventLog.findMany({ where: { leagueId, eventType: LAST_WORDS_EVENT }, select: { metadata: true, createdAt: true } }),
  ])
  const choppedWeek = new Map(states.filter((s) => s.choppedInPeriod != null).map((s) => [s.rosterId, s.choppedInPeriod as number]))
  const latestChopWeek = choppedWeek.size > 0 ? Math.max(...choppedWeek.values()) : null
  const { words, removed } = lastWordsByRoster(events)
  return { choppedWeek, latestChopWeek, words, removed }
}

/** The league's last words and the viewer's own. Never throws; null when it cannot be read. */
export async function loadLastWordsState(leagueId: string, viewerRosterId: string | null): Promise<LastWordsState | null> {
  try {
    const { choppedWeek, latestChopWeek, words, removed } = await read(leagueId)
    const standing = (rosterId: string) => {
      const w = words.get(rosterId)
      return w && choppedWeek.get(rosterId) === w.week ? w : null
    }
    const entries = [...choppedWeek.keys()]
      .flatMap((rosterId) => {
        const w = standing(rosterId)
        return w ? [{ rosterId, week: w.week, text: w.text }] : []
      })
      .sort((a, b) => b.week - a.week || a.rosterId.localeCompare(b.rosterId))
    const myWeek = viewerRosterId ? choppedWeek.get(viewerRosterId) ?? null : null
    const window = lastWordsWindow({ choppedWeek: myWeek, latestChopWeek, removed: viewerRosterId ? removed.has(viewerRosterId) : false })
    const mine = viewerRosterId && myWeek != null && window !== 'not_chopped' ? { week: myWeek, text: standing(viewerRosterId)?.text ?? null, window } : null
    return { entries, mine }
  } catch {
    return null
  }
}

export type SaveLastWordsResult =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 409; code: 'not_chopped' | 'closed' | 'removed' | 'empty' | 'too_long' | 'has_link' | 'not_clean'; error: string }

/** Write or rewrite the viewer's last words. */
export async function saveLastWords(input: { leagueId: string; viewerRosterId: string | null; userId: string; text: unknown }): Promise<SaveLastWordsResult> {
  const { choppedWeek, latestChopWeek, removed, words } = await read(input.leagueId)
  const rosterId = input.viewerRosterId
  const week = rosterId ? choppedWeek.get(rosterId) ?? null : null
  if (!rosterId || week == null) return { ok: false, status: 403, code: 'not_chopped', error: 'Only a manager whose team has been chopped can leave last words.' }
  const window = lastWordsWindow({ choppedWeek: week, latestChopWeek, removed: removed.has(rosterId) })
  if (window === 'removed') return { ok: false, status: 403, code: 'removed', error: 'The commissioner removed your last words, so they cannot be written again.' }
  if (window === 'closed') return { ok: false, status: 409, code: 'closed', error: 'Another team has been chopped since, so your last words can no longer be changed.' }
  const n = normalizeLastWords(input.text)
  if (!n.ok) return { ok: false, status: 400, code: n.error, error: n.message }
  if (hasProfanity(n.value)) return { ok: false, status: 400, code: 'not_clean', error: 'Keep it clean: the whole league reads this.' }

  const first = words.get(rosterId)?.week !== week
  await appendEvent(input.leagueId, LAST_WORDS_EVENT, { rosterId, week, text: n.value, userId: input.userId })
  if (first) {
    // The manager's own chat post, once. The key is the row id, so a second "first" can never post twice.
    // Loaded here and not at the top: the summary route imports this file for its reads, and the chat service
    // brings a large graph with it that a read never needs.
    const { createLeagueChatMessage } = await import('@/lib/league-chat/LeagueChatMessageService')
    await createLeagueChatMessage(input.leagueId, input.userId, `My last words: “${n.value}”`, {
      idempotencyKey: `guillotine-last-words:${input.leagueId}:${rosterId}:w${week}`,
      metadata: { contentType: 'guillotine_last_words', rosterId, weekOrPeriod: week },
    }).catch((e) => console.warn('[last-words] chat post failed', e instanceof Error ? e.message : 'unknown error'))
  }
  return { ok: true }
}

/** The commissioner takes a team's last words down. They stay down. */
export async function removeLastWords(input: { leagueId: string; rosterId: unknown; userId: string }): Promise<{ ok: true } | { ok: false; status: 400 | 404; error: string }> {
  if (typeof input.rosterId !== 'string' || !input.rosterId) return { ok: false, status: 400, error: 'Send the team whose last words to remove.' }
  const { words } = await read(input.leagueId)
  if (!words.has(input.rosterId)) return { ok: false, status: 404, error: 'That team has no last words.' }
  await appendEvent(input.leagueId, LAST_WORDS_EVENT, { rosterId: input.rosterId, removed: true, byUserId: input.userId })
  return { ok: true }
}
