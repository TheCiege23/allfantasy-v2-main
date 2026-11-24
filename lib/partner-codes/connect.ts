import 'server-only'
import type Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import { createOnboardingLink, createPayoutTransfer, createRecipientAccount, retrieveTransfersStatus, transfersStatusOf, type TransfersStatus } from './connectStripe'

/**
 * Commissioner Partner Codes — paying commissioners through Stripe Connect.
 *
 * Each commissioner gets a v2 connected account configured as a RECIPIENT (it only receives
 * transfers from us; it never takes payments), with the Express dashboard so they can see their
 * payouts. We pay with separate transfers from AllFantasy's Stripe balance, on our schedule.
 * Stripe's hosted onboarding collects identity, bank details and US tax info, which replaces
 * the hand-kept W-9.
 *
 * The Stripe calls themselves live in ./connectStripe (no database), which the sandbox drill
 * (scripts/partner-connect-sandbox-drill.ts) runs against a test sandbox. This file adds the
 * AllFantasy records around them.
 *
 * The platform needs Connect enabled in the Stripe Dashboard ("Marketplace" model). That is a
 * one-time step by the owner; until it is done, account creation fails and the page says payouts
 * aren't available yet.
 */

export { transfersStatusOf, type TransfersStatus }

/** Read the account from Stripe and store its status (and, once active, that tax info is on file). */
export async function refreshConnectStatus(stripe: Stripe, ownerUserId: string): Promise<TransfersStatus> {
  const profile = await prisma.partnerTaxProfile.findUnique({ where: { ownerUserId } })
  if (!profile?.stripeAccountId) return 'none'
  const status = await retrieveTransfersStatus(stripe, profile.stripeAccountId)
  await prisma.partnerTaxProfile.update({
    where: { ownerUserId },
    data: {
      stripeTransfersStatus: status,
      stripeStatusCheckedAt: new Date(),
      // Stripe only activates transfers once it has verified identity and collected US tax info.
      ...(status === 'active' ? { w9Status: 'verified', payoutMethod: 'stripe_connect' } : {}),
    },
  })
  return status
}

/** The commissioner's connected account, created on first use. */
export class PayoutSetupNeedsEmailError extends Error {
  constructor() {
    super('Add an email address to your AllFantasy account to set up payouts')
    this.name = 'PayoutSetupNeedsEmailError'
  }
}

export async function ensureConnectedAccount(stripe: Stripe, args: { ownerUserId: string; email: string | null; displayName: string }): Promise<string> {
  const existing = await prisma.partnerTaxProfile.findUnique({ where: { ownerUserId: args.ownerUserId } })
  if (existing?.stripeAccountId) return existing.stripeAccountId
  // Stripe requires a contact email on a recipient account; members who signed up by phone may have none.
  const email = args.email?.trim()
  if (!email) throw new PayoutSetupNeedsEmailError()
  const account = await createRecipientAccount(stripe, { ...args, email })
  await prisma.partnerTaxProfile.upsert({
    where: { ownerUserId: args.ownerUserId },
    create: { ownerUserId: args.ownerUserId, stripeAccountId: account.id, stripeTransfersStatus: transfersStatusOf(account) },
    update: { stripeAccountId: account.id, stripeTransfersStatus: transfersStatusOf(account) },
  })
  return account.id
}

/** Stripe-hosted onboarding (or "update my details" once onboarded). */
export async function onboardingLink(stripe: Stripe, args: { accountId: string; baseUrl: string; update: boolean }): Promise<string> {
  return createOnboardingLink(stripe, args)
}

/** A one-time link into their Express dashboard, where they see deposits to their bank. */
export async function dashboardLink(stripe: Stripe, accountId: string): Promise<string> {
  const link = await stripe.accounts.createLoginLink(accountId)
  return link.url
}

export type SendResult =
  | { ok: true; transferId: string }
  | { ok: false; reason: 'not_ready' | 'no_account' | 'insufficient_balance' | 'stripe_error'; message: string; definite: boolean }

export const SEND_ERROR_COPY: Record<Exclude<SendResult, { ok: true }>['reason'], string> = {
  no_account: "They haven't set up payouts yet",
  not_ready: "Their Stripe payout account isn't active yet",
  insufficient_balance: "Not enough available balance in AllFantasy's Stripe account. Retry once funds are available",
  stripe_error: 'Stripe refused the transfer',
}

/**
 * Move a statement's money to the commissioner. Re-checks readiness first, and uses the payout id
 * as the idempotency key, so a double click, a retry or a crash between "sent" and "recorded" can
 * never pay twice: Stripe returns the original transfer.
 */
export async function sendPayoutTransfer(stripe: Stripe, payout: { id: string; ownerUserId: string; totalCents: number; periodMonth: string; partnerCodeId: string; transferAttempts?: number }): Promise<SendResult> {
  const profile = await prisma.partnerTaxProfile.findUnique({ where: { ownerUserId: payout.ownerUserId } })
  // Refused before Stripe is called: nothing was attempted, so these never use up an attempt.
  if (!profile?.stripeAccountId) return { ok: false, reason: 'no_account', message: SEND_ERROR_COPY.no_account, definite: false }
  const status = await refreshConnectStatus(stripe, payout.ownerUserId)
  if (status !== 'active') return { ok: false, reason: 'not_ready', message: SEND_ERROR_COPY.not_ready, definite: false }
  const out = await createPayoutTransfer(stripe, {
    payoutId: payout.id,
    accountId: profile.stripeAccountId,
    amountCents: payout.totalCents,
    periodMonth: payout.periodMonth,
    partnerCodeId: payout.partnerCodeId,
    attempt: payout.transferAttempts ?? 0,
  })
  if (out.ok) return { ok: true, transferId: out.transferId }
  if (out.insufficientBalance) return { ok: false, reason: 'insufficient_balance', message: SEND_ERROR_COPY.insufficient_balance, definite: out.definite }
  return { ok: false, reason: 'stripe_error', message: `${SEND_ERROR_COPY.stripe_error} (${out.code ?? 'unknown'})`, definite: out.definite }
}
