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
 */

export type NoticeAlert = { headline: string; summary?: string | null }

/** "[AI Commissioner] …" → "…"; "(the) AI Commissioner" / a bare "AI" → "Chimmy". */
export function inChimmysVoice(text: string): string {
  return String(text ?? '')
    .replace(/\[\s*AI\s+Commissioner\s*\]\s*:?\s*/gi, '')
    .replace(/\b(?:the\s+)?AI\s+Commissioner\b/gi, 'Chimmy')
    .replace(/\bAI\b/g, 'Chimmy')
    .replace(/\s+/g, ' ')
    .trim()
}

function sentence(text: string): string {
  const t = inChimmysVoice(text)
  if (!t) return ''
  return /[.!?]$/.test(t) ? t : `${t}.`
}

/** One alert the commissioner chose to share with the league. */
export function commissionerNoticeText(alert: NoticeAlert): string {
  const parts = [sentence(alert.headline), sentence(alert.summary ?? '')].filter(Boolean)
  return parts.length > 0 ? `From the commissioner's desk: ${parts.join(' ')}` : ''
}

/** The automatic cycle's summary: how many new things the commissioner has to look at, and the top one. */
export function commissionerAlertsText(alerts: NoticeAlert[]): string {
  if (alerts.length === 0) return ''
  const top = inChimmysVoice(alerts[0]!.headline).replace(/[.!?]+$/, '')
  return alerts.length === 1
    ? `The commissioner has one new thing to look at: ${top}.`
    : `The commissioner has ${alerts.length} new things to look at. Top of the list: ${top}.`
}
