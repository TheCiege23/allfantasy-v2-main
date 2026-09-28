import { escapeHtml } from '@/lib/trade-intel/tradeGradeEmail'

/**
 * The email for "somebody messaged you" — a DM or a huddle.
 *
 * PURE. Same visual family as `renderDigestEmail` (Nocturne dark, tables, inline styles, solid
 * hexes), but its own shell because this one carries a per-recipient UNSUBSCRIBE link and that
 * shell does not.
 *
 * 🛑 EVERY STRING FROM A USER IS ESCAPED HERE, AT THE LEAF. The sender's display name, the huddle
 * title and the message preview are all typed by people, and the result is sent through
 * `sendTemplatedEmail`, which ships the HTML as-is. A display name of `<img src=x onerror=…>` must
 * arrive as text.
 *
 * ⚠ THE SUBJECT IS HEADER-SHAPED. A newline in a display name becomes a newline in a mail header,
 * so the subject is flattened to one line before anything else sees it.
 */

const BG = '#0b0b0f'
const CARD = '#15151c'
const BORDER = '#262631'
const TEXT = '#ffffff'
const MUTED = '#a1a1aa'
const FAINT = '#71717a'
const FONT = "system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif"

export type DirectMessageEmailInput = {
  senderName: string
  /** Already built by `buildMessagePreview` — plain text, not HTML. */
  preview: string
  /** A huddle's title; null for a 1:1 DM. */
  threadTitle?: string | null
  isGroup: boolean
  /** Absolute URL that opens this conversation. */
  conversationUrl: string
  /** Absolute origin, for the preferences link. */
  baseUrl: string
  /** Per-recipient signed unsubscribe link. Omitted when no address was available to sign. */
  unsubscribeUrl?: string | null
}

function oneLine(value: string, max: number): string {
  const flat = value.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(flat)
  return chars.length <= max ? flat : `${chars.slice(0, max - 1).join('')}…`
}

export function buildDirectMessageEmailSubject(input: Pick<DirectMessageEmailInput, 'senderName' | 'threadTitle' | 'isGroup'>): string {
  const sender = oneLine(input.senderName || 'Someone', 60)
  const title = input.threadTitle ? oneLine(input.threadTitle, 60) : ''
  if (!input.isGroup) return `${sender} sent you a message`
  return title ? `${sender} posted in ${title}` : `${sender} posted in your huddle`
}

export function buildDirectMessageEmail(input: DirectMessageEmailInput): { subject: string; html: string } {
  const subject = buildDirectMessageEmailSubject(input)
  const sender = oneLine(input.senderName || 'Someone', 60)
  const eyebrow = input.isGroup ? 'Huddle message' : 'Direct message'
  const preview = input.preview.trim() || 'sent a message'

  const unsubscribe = input.unsubscribeUrl
    ? ` · <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:${MUTED};text-decoration:underline">Unsubscribe</a>`
    : ''

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BG}">
<div style="background:${BG};padding:24px 12px;font-family:${FONT};color:${TEXT}">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto">
    <tr>
      <td style="padding-bottom:14px">
        <div style="font-size:11px;letter-spacing:0.10em;text-transform:uppercase;color:${FAINT};font-weight:700">${escapeHtml(eyebrow)}</div>
        <div style="font-size:21px;font-weight:800;color:${TEXT};margin-top:5px;line-height:1.25">${escapeHtml(subject)}</div>
      </td>
    </tr>
    <tr>
      <td style="padding:14px 16px;background:${CARD};border:1px solid ${BORDER};border-radius:14px;font-size:15px;line-height:1.6;color:${TEXT}">
        <div style="font-size:12px;color:${FAINT};font-weight:700;margin-bottom:4px">${escapeHtml(sender)}</div>
        <div>${escapeHtml(preview)}</div>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding:20px 0 6px 0">
        <a href="${escapeHtml(input.conversationUrl)}" style="display:inline-block;background:#ffffff;color:#0b0b0f;text-decoration:none;font-weight:800;font-size:14px;padding:12px 20px;border-radius:12px">Open conversation</a>
      </td>
    </tr>
    <tr>
      <td align="center" style="padding:4px 0 10px 0;font-size:12px;color:${MUTED}">Don't leave them on read.</td>
    </tr>
    <tr>
      <td style="padding-top:16px;border-top:1px solid ${BORDER};color:${FAINT};font-size:11px;line-height:1.7">You get this because someone messaged you on AllFantasy.ai and you haven't read it yet. We send at most one email per conversation an hour.<br>AllFantasy.ai · <a href="${escapeHtml(`${input.baseUrl}/settings?tab=notifications`)}" style="color:${MUTED};text-decoration:underline">Change preferences</a>${unsubscribe}</td>
    </tr>
  </table>
</div>
</body>
</html>`

  return { subject, html }
}
