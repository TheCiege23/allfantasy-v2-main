import type Stripe from 'stripe'

/**
 * Commissioner Partner Codes — the Stripe Connect calls themselves, with no database.
 *
 * lib/partner-codes/connect.ts wraps these with the AllFantasy records; the sandbox drill
 * (scripts/partner-connect-sandbox-drill.ts) calls them directly. Keeping the calls here, in one
 * place, means the drill exercises exactly what production sends.
 *
 * Readiness is ALWAYS the v2 capability path:
 *   configuration.recipient.capabilities.stripe_balance.stripe_transfers.status === 'active'
 * (never the deprecated v1 payouts_enabled / charges_enabled).
 */

export type TransfersStatus = 'active' | 'pending' | 'restricted' | 'unsupported' | 'none'

export type V2Account = {
  id: string
  configuration?: { recipient?: { capabilities?: { stripe_balance?: { stripe_transfers?: { status?: string } } } } | null } | null
}

export function transfersStatusOf(account: V2Account | null | undefined): TransfersStatus {
  const s = account?.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status
  return s === 'active' || s === 'pending' || s === 'restricted' || s === 'unsupported' ? s : 'none'
}

/**
 * A v2 RECIPIENT account (receives transfers only), Express dashboard, platform collects fees and losses.
 * Stripe REQUIRES contact_email whenever configuration.recipient is set (found by the sandbox drill,
 * 2026-11-23: "If configuration.recipient is supplied, the Account must have a contact email").
 */
export async function createRecipientAccount(stripe: Stripe, args: { ownerUserId: string; email: string; displayName: string }): Promise<V2Account> {
  return (await stripe.v2.core.accounts.create(
    {
      display_name: args.displayName.slice(0, 100),
      contact_email: args.email,
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
}

export async function retrieveTransfersStatus(stripe: Stripe, accountId: string): Promise<TransfersStatus> {
  const account = (await stripe.v2.core.accounts.retrieve(accountId, { include: ['configuration.recipient'] })) as unknown as V2Account
  return transfersStatusOf(account)
}

/** Stripe-hosted onboarding (or "update my details" once onboarded). */
export async function createOnboardingLink(stripe: Stripe, args: { accountId: string; baseUrl: string; update: boolean }): Promise<string> {
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

export type TransferOutcome =
  | { ok: true; transferId: string; alreadySent: boolean }
  | {
      ok: false
      code: string | null
      insufficientBalance: boolean
      /** Stripe answered with a definite refusal (no transfer was made), so the next try may use a new key. */
      definite: boolean
    }

export function payoutTransferGroup(payoutId: string): string {
  return `partner-payout-${payoutId}`
}

/**
 * The transfer itself. Never throws, and can never pay a statement twice:
 *
 *  1. It first asks Stripe whether a transfer already exists in this statement's transfer group. If one
 *     does (a crash after sending, a retry, a second admin), that transfer is the answer.
 *  2. Otherwise it sends with idempotency key `partner-payout-<id>-a<attempt>`. A double click shares the
 *     key, so Stripe makes one transfer.
 *
 * Why the attempt number (found by the sandbox drill, 2026-11-23): Stripe stores a FAILED response under
 * its idempotency key for 24 hours too, so with a key of the payout id alone, a statement that failed once
 * (an empty balance, say) replayed that failure on every retry for a day, even after the problem was fixed.
 * The caller bumps `attempt` only after a DEFINITE refusal (step 1 covers the uncertain cases).
 */
export async function createPayoutTransfer(
  stripe: Stripe,
  args: { payoutId: string; accountId: string; amountCents: number; periodMonth: string; partnerCodeId: string; attempt: number },
): Promise<TransferOutcome> {
  const group = payoutTransferGroup(args.payoutId)
  try {
    const existing = await stripe.transfers.list({ transfer_group: group, limit: 1 })
    const prior = existing.data.find((t) => !t.reversed)
    if (prior) return { ok: true, transferId: prior.id, alreadySent: true }
    const transfer = await stripe.transfers.create(
      {
        amount: args.amountCents,
        currency: 'usd',
        destination: args.accountId,
        transfer_group: group,
        description: `AllFantasy Partner Code commission, ${args.periodMonth}`,
        metadata: { af_partner_payout_id: args.payoutId, af_partner_code_id: args.partnerCodeId, period: args.periodMonth },
      },
      { idempotencyKey: `${group}-a${args.attempt}` },
    )
    return { ok: true, transferId: transfer.id, alreadySent: false }
  } catch (error) {
    const code = (error as { code?: string })?.code ?? null
    const type = (error as { type?: string })?.type
    // Never pass Stripe's own message on: it can name key details and internal ids. Log the code.
    console.error('[partner-codes] transfer failed', { payoutId: args.payoutId, code, type })
    // A connection or Stripe-side error may or may not have created a transfer: keep the same key so a
    // retry replays it instead of risking a second one. Anything else is a definite refusal.
    const definite = type !== 'StripeConnectionError' && type !== 'StripeAPIError' && type !== 'StripeIdempotencyError'
    return { ok: false, code, insufficientBalance: code === 'balance_insufficient', definite }
  }
}
