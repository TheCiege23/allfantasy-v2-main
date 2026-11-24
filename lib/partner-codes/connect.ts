import 'server-only'
import type Stripe from 'stripe'
import { prisma } from '@/lib/prisma'

/**
 * Commissioner Partner Codes — paying commissioners through Stripe Connect.
 *
 * Each commissioner gets a v2 connected account configured as a RECIPIENT (it only receives
 * transfers from us; it never takes payments), with the Express dashboard so they can see their
 * payouts. We pay with separate transfers from AllFantasy's Stripe balance, on our schedule.
 * Stripe's hosted onboarding collects identity, bank details and US tax info, which replaces
 * the hand-kept W-9.
 *
 * Readiness is ALWAYS the v2 capability path, re-checked before money moves:
 *   configuration.recipient.capabilities.stripe_balance.stripe_transfers.status === 'active'
 * (never the deprecated v1 payouts_enabled / charges_enabled).
 *
 * The platform needs Connect enabled in the Stripe Dashboard. That is a one-time step by the owner;
 * until it is done, account creation fails and the page says payouts aren't available yet.
 */

export type TransfersStatus = 'active' | 'pending' | 'restricted' | 'unsupported' | 'none'

type V2Account = {
  id: string
  configuration?: { recipient?: { capabilities?: { stripe_balance?: { stripe_transfers?: { status?: string } } } } | null } | null
}

export function transfersStatusOf(account: V2Account | null | undefined): TransfersStatus {
  const s = account?.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status
  return s === 'active' || s === 'pending' || s === 'restricted' || s === 'unsupported' ? s : 'none'
}

/** Read the account from Stripe and store its status (and, once active, that tax info is on file). */
export async function refreshConnectStatus(stripe: Stripe, ownerUserId: string): Promise<TransfersStatus> {
  const profile = await prisma.partnerTaxProfile.findUnique({ where: { ownerUserId } })
  if (!profile?.stripeAccountId) return 'none'
  const account = (await stripe.v2.core.accounts.retrieve(profile.stripeAccountId, { include: ['configuration.recipient'] })) as unknown as V2Account
  const status = transfersStatusOf(account)
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
export async function ensureConnectedAccount(stripe: Stripe, args: { ownerUserId: string; email: string | null; displayName: string }): Promise<string> {
  const existing = await prisma.partnerTaxProfile.findUnique({ where: { ownerUserId: args.ownerUserId } })
  if (existing?.stripeAccountId) return existing.stripeAccountId
  const account = (await stripe.v2.core.accounts.create(
    {
      display_name: args.displayName.slice(0, 100),
      ...(args.email ? { contact_email: args.email } : {}),
      dashboard: 'express',
      identity: { country: 'us' },
      defaults: { responsibilities: { fees_collector: 'application', losses_collector: 'application' } },
      configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } },
      include: ['configuration.recipient'],
      metadata: { af_user_id: args.ownerUserId, af_program: 'partner_codes' },
    } as Stripe.V2.Core.AccountCreateParams,
    // Two clicks on "Set up payouts" must not make two accounts.
    { idempotencyKey: `partner-connect-account-${args.ownerUserId}` },
  )) as unknown as V2Account
  await prisma.partnerTaxProfile.upsert({
    where: { ownerUserId: args.ownerUserId },
    create: { ownerUserId: args.ownerUserId, stripeAccountId: account.id, stripeTransfersStatus: transfersStatusOf(account) },
    update: { stripeAccountId: account.id, stripeTransfersStatus: transfersStatusOf(account) },
  })
  return account.id
}

/** Stripe-hosted onboarding (or "update my details" once onboarded). */
export async function onboardingLink(stripe: Stripe, args: { accountId: string; baseUrl: string; update: boolean }): Promise<string> {
  const urls = {
    configurations: ['recipient' as const],
    refresh_url: `${args.baseUrl}/partner-code?payouts=refresh`,
    return_url: `${args.baseUrl}/partner-code?payouts=return`,
  }
  const link = await stripe.v2.core.accountLinks.create({
    account: args.accountId,
    use_case: args.update
      ? { type: 'account_update', account_update: urls }
      : { type: 'account_onboarding', account_onboarding: urls },
  } as Stripe.V2.Core.AccountLinkCreateParams)
  return (link as unknown as { url: string }).url
}

/** A one-time link into their Express dashboard, where they see deposits to their bank. */
export async function dashboardLink(stripe: Stripe, accountId: string): Promise<string> {
  const link = await stripe.accounts.createLoginLink(accountId)
  return link.url
}

export type SendResult =
  | { ok: true; transferId: string }
  | { ok: false; reason: 'not_ready' | 'no_account' | 'insufficient_balance' | 'stripe_error'; message: string }

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
export async function sendPayoutTransfer(stripe: Stripe, payout: { id: string; ownerUserId: string; totalCents: number; periodMonth: string; partnerCodeId: string }): Promise<SendResult> {
  const profile = await prisma.partnerTaxProfile.findUnique({ where: { ownerUserId: payout.ownerUserId } })
  if (!profile?.stripeAccountId) return { ok: false, reason: 'no_account', message: SEND_ERROR_COPY.no_account }
  const status = await refreshConnectStatus(stripe, payout.ownerUserId)
  if (status !== 'active') return { ok: false, reason: 'not_ready', message: SEND_ERROR_COPY.not_ready }
  try {
    const transfer = await stripe.transfers.create(
      {
        amount: payout.totalCents,
        currency: 'usd',
        destination: profile.stripeAccountId,
        transfer_group: `partner-payout-${payout.id}`,
        description: `AllFantasy Partner Code commission, ${payout.periodMonth}`,
        metadata: { af_partner_payout_id: payout.id, af_partner_code_id: payout.partnerCodeId, period: payout.periodMonth },
      },
      { idempotencyKey: `partner-payout-${payout.id}` },
    )
    return { ok: true, transferId: transfer.id }
  } catch (error) {
    const code = (error as { code?: string })?.code
    if (code === 'balance_insufficient') return { ok: false, reason: 'insufficient_balance', message: SEND_ERROR_COPY.insufficient_balance }
    // Never pass Stripe's own message on: it can name key details and internal ids. Log it, show the code.
    console.error('[partner-codes] transfer failed', { payoutId: payout.id, code, type: (error as { type?: string })?.type })
    return { ok: false, reason: 'stripe_error', message: `${SEND_ERROR_COPY.stripe_error} (${code ?? 'unknown'})` }
  }
}
