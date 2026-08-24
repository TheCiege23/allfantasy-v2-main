/**
 * Shared HTML builder for email-verification emails.
 *
 * WHY INLINE STYLES + TABLE LAYOUT:
 * Gmail (web), Outlook, and most mobile email clients strip <style> blocks
 * entirely, so any colour living in a CSS class is simply not applied and the
 * element falls back to the client's own defaults. Every colour and layout
 * property must be on the element itself via style="".
 *
 * Every colour is applied on the <td> itself, not just the <body>, so it
 * survives Gmail's aggressive CSS normalisation.
 *
 * The CTA button uses background-color on the <td> (Outlook-safe) AND on
 * the <a> element (Gmail/mobile-safe), so it stays visible in all clients.
 *
 * ⚠ THE CARD IS LIGHT ON A LIGHT PAGE — handoff 16b state 5, which draws the
 * transactional email as a white card rather than the dark one this file used to
 * build. That is not only a style change: it removes the failure mode the old
 * comment here warned about. A dark-card email depends on the client honouring
 * every background it is given, and a client that strips one paints dark text on
 * dark. A light card degrades to black-on-white, which is still readable. Text
 * colours below are therefore explicit dark values, never inherited.
 *
 * ⚠ ONE DESTINATION IN THE WHOLE BODY — the handoff's "no secondary links"
 * rule. The plain-text fallback under the button is the SAME verifyUrl, kept
 * because clients clip long emails and a blocked button then leaves the reader
 * with nothing to click. It is a second copy of the one link, not a second link.
 */

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

/**
 * Returns a display-safe name for the email greeting.
 *
 * Rules (matches the display-privacy policy):
 *   - Prefer username (always alphanumeric, user-chosen).
 *   - Accept displayName only if it contains no "@" (i.e. is not an email).
 *   - Fall back to "there" — never expose an email prefix.
 */
export function resolveEmailSafeName(opts: {
  username?: string | null
  displayName?: string | null
}): string {
  const name =
    opts.username?.trim() ||
    opts.displayName?.trim() ||
    ''
  if (!name || name.includes('@')) return 'there'
  return name // plain text — buildVerificationEmailHtml will HTML-encode it
}

/**
 * Builds high-contrast, email-client-safe HTML for a verification email.
 *
 * All parameters are plain text — they are HTML-escaped internally.
 * The verifyUrl is also escaped for safe insertion into href attributes.
 */
export function buildVerificationEmailHtml(opts: {
  /** H1 heading shown in the email */
  title: string
  /** Body paragraph beneath the heading */
  greeting: string
  /** Full verification URL, including token and any returnTo param */
  verifyUrl: string
  /** Small footer note, e.g. "If you didn't create this account…" */
  footerNote: string
}): string {
  const safeTitle    = escapeHtml(opts.title)
  const safeGreeting = escapeHtml(opts.greeting)
  const safeFooter   = escapeHtml(opts.footerNote)
  // URL: escape & → &amp; for HTML attributes; token remains URL-encoded
  const safeUrl      = escapeHtml(opts.verifyUrl)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background-color:#eef1f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">

  <!-- Outer wrapper — inline background-color so Gmail doesn't substitute its own -->
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
    <tr>
      <td style="background-color:#eef1f7;padding:32px 16px;" align="center">

        <!-- Card -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:520px;background-color:#ffffff;border-radius:14px;">

          <!-- Brand lockup: crest + wordmark, as the handoff draws it.
               The crest is an absolute https URL because a cid: attachment or a
               relative path resolves to nothing in a mail client. width/height
               are attributes as well as styles so Outlook reserves the box, and
               the alt text carries the brand when images are blocked — which is
               the default in most clients on first open. -->
          <tr>
            <td style="padding:28px 32px 8px;">
              <img src="https://www.allfantasy.ai/af-crest.png" width="28" height="28" alt="AllFantasy.ai" style="vertical-align:middle;border:0;display:inline-block;width:28px;height:28px;">
              <span style="vertical-align:middle;padding-left:10px;font-size:19px;font-weight:700;color:#0b1020;letter-spacing:-0.3px;">AllFantasy.ai</span>
            </td>
          </tr>

          <!-- Main content -->
          <tr>
            <td style="padding:12px 32px 28px;">
              <h1 style="margin:0 0 14px;font-size:26px;font-weight:800;color:#0b1020;line-height:1.25;">${safeTitle}</h1>
              <p style="margin:0 0 26px;font-size:15px;line-height:1.6;color:#41496b;">${safeGreeting}</p>

              <!-- CTA button
                   background-color on <td>  = renders in Outlook (Word engine)
                   background-color on <a>   = renders in Gmail / mobile when <td> bg is stripped
                   color:#ffffff on <a>      = white text always explicit — never inherit -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="background-color:#0e7f9b;border-radius:9px;">
                    <a href="${safeUrl}"
                       style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:9px;background-color:#0e7f9b;">
                      Verify email
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:22px 0 0;font-size:13px;color:#5b6485;">This link expires in 1 hour.</p>

              <!-- Plain-text fallback — the SAME destination as the button, shown
                   when the button is clipped or images/styles are blocked. -->
              <p style="margin:26px 0 6px;font-size:12px;color:#5b6485;">
                If the button doesn&apos;t work, copy and paste this link into your browser:
              </p>
              <p style="margin:0;font-size:12px;word-break:break-all;">
                <a href="${safeUrl}" style="color:#0e7f9b;text-decoration:underline;">${safeUrl}</a>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px 26px;border-top:1px solid #e2e6f0;">
              <p style="margin:0;font-size:12px;line-height:1.6;color:#6b7391;">${safeFooter}</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>

</body>
</html>`
}
