/**
 * The support inbox (owner's call 2026-11-15: "build the support inbox") — the rules and the words, with
 * no I/O, so the server, the help page, the admin page and the tests all read the same ones.
 *
 * A support conversation is a `PlatformChatThread` with `threadType: 'support'`, created by the member,
 * with NO members: every chat inbox lists threads by membership, so a support thread can never appear in
 * one, and it is reached only through /api/support (its creator) and /api/admin/support (an admin).
 * No new table, so no migration.
 *
 * Each message carries `metadata.support`: who wrote it (`from`), and on a status change the `event`.
 * The status is read back from those events, never stored beside them, so it cannot drift.
 */

export const SUPPORT_THREAD_TYPE = 'support'

export const SUPPORT_TOPICS = ['account', 'billing', 'league', 'bug', 'idea', 'other'] as const
export type SupportTopic = (typeof SUPPORT_TOPICS)[number]

export const SUPPORT_MESSAGE_MAX = 4000
/** A member can open this many conversations a day, and send this many messages. Generous for a person, a wall for a script. */
export const SUPPORT_THREADS_PER_DAY = 5
export const SUPPORT_MESSAGES_PER_DAY = 40

export type SupportFrom = 'member' | 'staff'
export type SupportEvent = 'opened' | 'closed' | 'reopened'
export type SupportMeta = { from: SupportFrom; event?: SupportEvent; topic?: SupportTopic; pagePath?: string }

export type SupportStatus = 'needs_reply' | 'answered' | 'closed'

export function isSupportTopic(v: unknown): v is SupportTopic {
  return typeof v === 'string' && (SUPPORT_TOPICS as readonly string[]).includes(v)
}

/** The message as sent, trimmed; null when empty or too long (the caller says which). */
export function cleanSupportMessage(v: unknown): { ok: true; text: string } | { ok: false; error: 'empty' | 'too_long' } {
  const text = typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : ''
  if (!text) return { ok: false, error: 'empty' }
  if (text.length > SUPPORT_MESSAGE_MAX) return { ok: false, error: 'too_long' }
  return { ok: true, text }
}

/** Only a same-site path is kept: the page the member was on, for context. Never a full URL. */
export function cleanPagePath(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const p = v.trim().slice(0, 300)
  return p.startsWith('/') && !p.startsWith('//') ? p : undefined
}

export function readSupportMeta(metadata: unknown): SupportMeta | null {
  const s = metadata && typeof metadata === 'object' ? (metadata as Record<string, unknown>).support : null
  if (!s || typeof s !== 'object') return null
  const r = s as Record<string, unknown>
  if (r.from !== 'member' && r.from !== 'staff') return null
  return {
    from: r.from,
    ...(r.event === 'opened' || r.event === 'closed' || r.event === 'reopened' ? { event: r.event } : {}),
    ...(isSupportTopic(r.topic) ? { topic: r.topic } : {}),
    ...(typeof r.pagePath === 'string' ? { pagePath: r.pagePath } : {}),
  }
}

/**
 * Where a conversation stands, from its messages oldest first:
 *   closed      — the last status event was a close, and nobody has written since;
 *   needs_reply — open, and the last thing said was the member's;
 *   answered    — open, and the last thing said was ours.
 * Anyone writing into a closed conversation reopens it.
 */
export function supportStatus(messages: ReadonlyArray<{ metadata: unknown }>): SupportStatus {
  let closed = false
  let lastFrom: SupportFrom | null = null
  for (const m of messages) {
    const meta = readSupportMeta(m.metadata)
    if (!meta) continue
    if (meta.event === 'closed') {
      closed = true
      continue
    }
    if (meta.event === 'reopened') closed = false
    if (meta.event && meta.event !== 'opened') continue
    lastFrom = meta.from
    closed = false
  }
  if (closed) return 'closed'
  return lastFrom === 'staff' ? 'answered' : 'needs_reply'
}

export function supportThreadTitle(topic: SupportTopic, text: string): string {
  const first = text.split('\n')[0]!.trim()
  const short = first.length > 70 ? `${first.slice(0, 69).trimEnd()}…` : first
  return `${SUPPORT_TOPIC_LABELS.en[topic]}: ${short}`
}

export const SUPPORT_TOPIC_LABELS: Record<'en' | 'es', Record<SupportTopic, string>> = {
  en: { account: 'My account', billing: 'Billing and AF Pro', league: 'A league or import', bug: 'Something is broken', idea: 'An idea', other: 'Something else' },
  es: { account: 'Mi cuenta', billing: 'Pagos y AF Pro', league: 'Una liga o importación', bug: 'Algo no funciona', idea: 'Una idea', other: 'Otra cosa' },
}

export const SUPPORT_STATUS_LABELS: Record<'en' | 'es', Record<SupportStatus, string>> = {
  en: { needs_reply: 'Waiting for us', answered: 'We replied', closed: 'Closed' },
  es: { needs_reply: 'Esperando respuesta', answered: 'Respondimos', closed: 'Cerrada' },
}

/** The name every staff message shows. A member never sees which admin wrote. */
export const SUPPORT_STAFF_NAME = 'AllFantasy Support'
