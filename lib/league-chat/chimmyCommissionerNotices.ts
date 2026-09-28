/**
 * The words for the governance notices Chimmy posts for the commissioner. PURE.
 *
 * The AI Commissioner's alerts reach league chat as Chimmy (lib/league-chat/chimmyMoments.ts):
 *   - `commissionerNoticeText` — one alert, when the commissioner presses "Send notice";
 *   - `commissionerAlertsText` — the automatic cycle's summary, when notices are set to chat.
 *
 * Brand voice: the post is Chimmy's, so it never carries an "AI" label. The old copy was
 * "[AI Commissioner] headline: summary" and "AI Commissioner generated N new alert(s). Top: [high] …".
 * Alert text comes from several generators, so a stray "AI Commissioner" or bare "AI" inside it is
 * reworded here rather than trusted to every one of them.
 *
 * ─── NAMES, NEVER IDS ───────────────────────────────────────────────────────────────────────────
 *
 * 🛑 THE STORED ALERT TEXT CARRIES INTERNAL IDS, AND IT IS RIGHT TO. The governance generators write
 * "Manager 7 has shown no recent activity for 12 days." (a platform roster id) and "Trade
 * 1123581321345589 has a value delta near 63%…" / "Flagging trade ckx…" (a provider transaction id, an
 * internal row id). That is the commissioner's own record, and the ids are what the panel links on —
 * they stay in `ai_commissioner_alerts` untouched. But posted into LEAGUE chat, as it did once notices
 * moved there, it read to every member as noise at best and as an id leak at worst.
 *
 * So the CHAT copy is rewritten through `namesInNoticeText`: a manager id becomes their team or
 * display name, then their username, then "a manager" (lib/league-chat/commissionerNoticeNames.ts
 * resolves them — never an email, never a phone number); a trade id becomes "a trade with <partner>".
 * Anything that still looks like an internal id after that (a UUID, a cuid, a long digit run, an
 * email) is scrubbed, because a generator added next year will not know about this file.
 */

export type NoticeAlert = {
  headline: string
  summary?: string | null
  /** As stored on the alert — roster ids, provider team keys or owner names. */
  relatedManagerIds?: readonly string[] | null
  /** As stored on the alert — the trade row's id. */
  relatedTradeId?: string | null
}

/**
 * Who the ids in an alert are, resolved server-side (`resolveCommissionerNoticeNames`).
 *   managers  id as stored → a name fit for league chat ("a manager" when nothing better is on file)
 *   trades    stored trade id → the other ids that name the same trade in text (its provider
 *             transaction id) and the name of the manager on the other side, when known
 */
export type NoticeNames = {
  managers?: Readonly<Record<string, string>>
  trades?: Readonly<Record<string, { refs?: readonly string[]; partner?: string | null }>>
}

/** The fallback when an id resolves to nobody we can name. */
export const UNNAMED_MANAGER = 'a manager'

/** "[AI Commissioner] …" → "…"; "(the) AI Commissioner" / a bare "AI" → "Chimmy". */
export function inChimmysVoice(text: string): string {
  return String(text ?? '')
    .replace(/\[\s*AI\s+Commissioner\s*\]\s*:?\s*/gi, '')
    .replace(/\b(?:the\s+)?AI\s+Commissioner\b/gi, 'Chimmy')
    .replace(/\bAI\b/g, 'Chimmy')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Upper-case the first letter when the word it replaces started the sentence with one. */
function matchCase(replacement: string, original: string): string {
  if (!replacement) return replacement
  const upper = original.charAt(0) === original.charAt(0).toUpperCase()
  return upper ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement
}

/** Shapes nobody should ever read in league chat. */
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const CUID = 'c[a-z0-9]{20,}'
const LONG_DIGITS = '\\d{7,}'
const PROVIDER_KEY = '\\d+\\.l\\.\\d+(?:\\.t\\.\\d+)?'
const ID_LIKE = `(?:${UUID}|${CUID}|${PROVIDER_KEY}|${LONG_DIGITS}|\\d+)`
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}/g
/** The id ends here: not mid-word, and not the head of a dotted key ("461.l.12345"). A full stop is fine. */
const ID_END = '(?![\\w-]|\\.\\w)'
const ID_START = '(?<![\\w.-])'

/**
 * Rewrite one alert's text for league chat: names for the ids this alert names, then a scrub for any
 * id-shaped token left over. PURE.
 */
export function namesInNoticeText(text: string, alert: NoticeAlert, names: NoticeNames = {}): string {
  let out = String(text ?? '')

  // ── Trades: "Trade <ref>" / "trade <ref>" → "A trade with Sam's Squad" ──
  const tradeId = typeof alert.relatedTradeId === 'string' ? alert.relatedTradeId.trim() : ''
  if (tradeId) {
    const info = names.trades?.[tradeId]
    const refs = [tradeId, ...(info?.refs ?? [])].map((r) => String(r).trim()).filter(Boolean)
    const partner = info?.partner?.trim() || null
    const phrase = partner ? `a trade with ${partner}` : 'a recent trade'
    for (const ref of refs) {
      out = out.replace(new RegExp(`\\b(trade)\\s+${escapeRegExp(ref)}${ID_END}`, 'gi'), (_m, word: string) =>
        matchCase(phrase, word),
      )
    }
  }

  // ── Managers: "Manager <id>" → their name; any other bare mention of the id → their name ──
  for (const raw of alert.relatedManagerIds ?? []) {
    const id = String(raw ?? '').trim()
    if (!id) continue
    const found = names.managers?.[id]?.trim()
    // "a manager" from the resolver is the fallback too, and follows the sentence's casing.
    const resolved = found && found !== UNNAMED_MANAGER ? found : ''
    const name = resolved || UNNAMED_MANAGER
    // A real name keeps its own casing; only the generic fallback follows the sentence.
    const say = (word: string) => (resolved ? resolved : matchCase(UNNAMED_MANAGER, word))
    out = out.replace(new RegExp(`\\b(manager)\\s+${escapeRegExp(id)}${ID_END}`, 'gi'), (_m, word: string) => say(word))
    // A long, unmistakable id mentioned without the word "manager" (never a short number, which
    // could be a count of days).
    if (id.length >= 6) out = out.replace(new RegExp(`${ID_START}${escapeRegExp(id)}${ID_END}`, 'g'), name)
  }

  // ── The scrub: whatever a generator we have not met yet wrote ──
  out = out
    .replace(new RegExp(`\\b(manager)\\s+${ID_LIKE}${ID_END}`, 'gi'), (_m, word: string) => matchCase(UNNAMED_MANAGER, word))
    .replace(new RegExp(`\\b(trade)\\s+${ID_LIKE}${ID_END}`, 'gi'), (_m, word: string) => matchCase('a recent trade', word))
    .replace(new RegExp(`\\b(?:${UUID}|${CUID}|${PROVIDER_KEY}|${LONG_DIGITS})\\b`, 'gi'), '')
    .replace(EMAIL, UNNAMED_MANAGER)
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  return out
}

function sentence(text: string, alert: NoticeAlert, names: NoticeNames): string {
  const t = inChimmysVoice(namesInNoticeText(text, alert, names))
  if (!t) return ''
  return /[.!?]$/.test(t) ? t : `${t}.`
}

/** One alert the commissioner chose to share with the league — names, never ids. */
export function commissionerNoticeText(alert: NoticeAlert, names: NoticeNames = {}): string {
  const parts = [sentence(alert.headline, alert, names), sentence(alert.summary ?? '', alert, names)].filter(Boolean)
  return parts.length > 0 ? `From the commissioner's desk: ${parts.join(' ')}` : ''
}

/** The automatic cycle's summary: how many new things the commissioner has to look at, and the top one. */
export function commissionerAlertsText(alerts: NoticeAlert[], names: NoticeNames = {}): string {
  if (alerts.length === 0) return ''
  const first = alerts[0]!
  const top = inChimmysVoice(namesInNoticeText(first.headline, first, names)).replace(/[.!?]+$/, '')
  return alerts.length === 1
    ? `The commissioner has one new thing to look at: ${top}.`
    : `The commissioner has ${alerts.length} new things to look at. Top of the list: ${top}.`
}
