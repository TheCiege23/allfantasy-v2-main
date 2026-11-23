import "server-only"

import { buildVerificationEmailHtml } from "@/lib/email/verification-email-html"
import { createSupportSignInLinkToken, type SupportGuestBuyer } from "@/lib/monetization/supportGuestAccount"

/**
 * The welcome email's subject and HTML. Pure, so the copy is testable.
 *
 * It names the account's sign-in details (email and username — either works on the sign-in
 * page) so a supporter can sign in on their own later.
 *
 * ⚠ A NEW ACCOUNT'S PASSWORD IS IN IT, BY THE OWNER'S DECISION (2026-11-23). Supporters who don't
 * play want something to write down, as most sites give them. The trade-off was weighed then: the
 * password sits readable in the inbox, but anyone who can read that inbox can already reset it.
 * Only `buyer.initialPassword` is ever shown — set on the one webhook pass that MADE the account,
 * never stored. Without it (an existing account, or a retry that cannot recover it) the email
 * offers "choose a password" instead, which goes to the normal forgot-password page.
 */
export function buildSupportWelcomeEmail(input: {
  buyer: Pick<SupportGuestBuyer, "email" | "username" | "created" | "initialPassword">
  signInUrl: string
  setPasswordUrl: string
  duplicate?: boolean
  buildHtml?: typeof buildVerificationEmailHtml
}): { subject: string; html: string } {
  const { buyer, duplicate } = input
  // Never on the double-payment email: that is someone else's existing account.
  const password = !duplicate && buyer.created && buyer.initialPassword ? buyer.initialPassword : null
  const greeting = duplicate
    ? "Thank you! This email already pays for AllFantasy Pro, so we did not charge you twice — the new payment has been refunded in full."
    : buyer.created
      ? "Thank you for supporting AllFantasy! You're all set — there's nothing else you need to do. If you ever want to look around, here is how to sign in."
      : "Thank you for supporting AllFantasy! Your monthly support is now on your existing account."
  const html = (input.buildHtml ?? buildVerificationEmailHtml)({
    title: duplicate ? "You're already a supporter" : "Thank you!",
    greeting,
    details: [
      { label: "Sign in with", value: buyer.email },
      { label: "Your username", value: buyer.username },
      ...(password ? [{ label: "Your password", value: password }] : []),
    ],
    verifyUrl: input.signInUrl,
    buttonLabel: "Sign in to AllFantasy",
    secondaryLink: password
      ? { label: "Forgot it later? Choose a new one here", url: input.setPasswordUrl }
      : { label: "Prefer a password? Choose one here", url: input.setPasswordUrl },
    footerNote: password
      ? "Keep this email: you can sign in any time with your email or username and the password above, and change the password in Settings → Security. The button signs you in once. To cancel your monthly support, sign in and open Settings → Billing, or email support@allfantasy.ai."
      : "The sign-in button works once. You can also sign in any time with your email and a password you choose. To cancel your monthly support, sign in and open Settings → Billing, or email support@allfantasy.ai.",
  })
  return { subject: duplicate ? "You're already supporting AllFantasy" : "Thank you for supporting AllFantasy", html }
}

/**
 * The thank-you email after a no-account support checkout, carrying a one-tap sign-in link
 * (lib/monetization/supportGuestAccount). Sent to the address the account HOLDS — for an
 * existing account that is its owner's inbox, which is the whole point.
 *
 * Never throws: the payment and the plan are already recorded, and a failed email must not
 * make Stripe retry the webhook. Logs the provider's message only — never the address or link.
 */
export async function sendSupportWelcomeEmail(
  buyer: SupportGuestBuyer,
  opts: { checkoutSessionId: string; duplicate?: boolean },
): Promise<boolean> {
  try {
    const rawToken = await createSupportSignInLinkToken(buyer.userId)
    const { getDeploymentLinkOrigin } = await import("@/lib/site-public-origin")
    const { USER_FACING_SITE_ORIGIN } = await import("@/lib/auth/user-facing-site-origin")
    const origin = getDeploymentLinkOrigin() || USER_FACING_SITE_ORIGIN
    const signInUrl = `${origin}/support/sign-in?token=${encodeURIComponent(rawToken)}`

    const { buildEmailIdempotencyKey } = await import("@/lib/email/idempotency")
    const { getResendClient, resendSendError } = await import("@/lib/resend-client")
    const { client, fromEmail } = getResendClient()

    const { subject, html } = buildSupportWelcomeEmail({
      buyer,
      signInUrl,
      setPasswordUrl: `${origin}/forgot-password?method=email`,
      duplicate: opts.duplicate,
      buildHtml: buildVerificationEmailHtml,
    })
    const result = await client.emails.send(
      { from: fromEmail || "AllFantasy.ai <noreply@allfantasy.ai>", to: buyer.email, subject, html },
      { idempotencyKey: buildEmailIdempotencyKey("support-welcome", opts.checkoutSessionId) },
    )
    const sendError = resendSendError(result)
    if (sendError) {
      console.error(`[support-guest] welcome email rejected by provider: ${sendError}`)
      return false
    }
    return true
  } catch (error) {
    console.error(`[support-guest] welcome email failed: ${error instanceof Error ? error.message : "unknown error"}`)
    return false
  }
}
