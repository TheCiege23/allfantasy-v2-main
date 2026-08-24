import { escapeHtml } from '@/lib/trade-intel/tradeGradeEmail'

/**
 * Minimal designed shell for digest-style emails (weekly recap, morning
 * briefing) — the same visual family as tradeGradeEmail (22a) and
 * draftEmails (22b): Nocturne dark, tables not flex, inline styles only,
 * solid hexes (Outlook's Word engine drops rgba), 640px max, no external
 * assets.
 *
 * Sent through `sendTemplatedEmail`, which sends HTML as-is — so THE CALLER
 * OWNS LEAF ESCAPING of `bodyHtml`. Chrome strings (eyebrow, title, sub, CTA
 * label) are escaped here. Never hand `bodyHtml` raw user input.
 */

const BG = '#0b0b0f'
const CARD = '#15151c'
const BORDER = '#262631'
const TEXT = '#ffffff'
const MUTED = '#a1a1aa'
const FAINT = '#71717a'
const FONT = "system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif"

export function renderDigestEmail(params: {
  eyebrow: string
  title: string
  sub?: string | null
  /** Leaf-escaped HTML. The caller owns escaping — see the module header. */
  bodyHtml: string
  cta?: { href: string; label: string } | null
  /** Absolute origin for the footer preferences link. Omit and the link is left out. */
  baseUrl?: string | null
}): string {
  const { eyebrow, title, sub, bodyHtml, cta, baseUrl } = params
  const ctaRow = cta
    ? `
    <tr>
      <td align="center" style="padding:20px 0 6px 0">
        <a href="${escapeHtml(cta.href)}" style="display:inline-block;background:#ffffff;color:#0b0b0f;text-decoration:none;font-weight:800;font-size:14px;padding:12px 20px;border-radius:12px">${escapeHtml(cta.label)}</a>
      </td>
    </tr>`
    : ''
  const prefsLink = baseUrl
    ? ` · <a href="${escapeHtml(`${baseUrl}/settings?tab=notifications`)}" style="color:${MUTED};text-decoration:underline">Change preferences</a>`
    : ''
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BG}">
<div style="background:${BG};padding:24px 12px;font-family:${FONT};color:${TEXT}">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto">
    <tr>
      <td style="padding-bottom:14px">
        <div style="font-size:11px;letter-spacing:0.10em;text-transform:uppercase;color:${FAINT};font-weight:700">${escapeHtml(eyebrow)}</div>
        <div style="font-size:21px;font-weight:800;color:${TEXT};margin-top:5px;line-height:1.25">${escapeHtml(title)}</div>
        ${sub ? `<div style="font-size:13px;color:${MUTED};margin-top:3px">${escapeHtml(sub)}</div>` : ''}
      </td>
    </tr>
    <tr>
      <td style="padding:14px 16px;background:${CARD};border:1px solid ${BORDER};border-radius:14px;font-size:13px;line-height:1.7;color:${MUTED}">${bodyHtml}</td>
    </tr>
    ${ctaRow}
    <tr>
      <td style="padding-top:16px;border-top:1px solid ${BORDER};color:${FAINT};font-size:11px;line-height:1.7">AllFantasy.ai${prefsLink}</td>
    </tr>
  </table>
</div>
</body>
</html>`
}
