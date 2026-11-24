/**
 * Commissioner Partner Codes — Stripe Connect drill, against a TEST sandbox only.
 *
 * Runs the exact Stripe calls production uses (lib/partner-codes/connectStripe.ts), with no
 * database, so the payout path can be proven before Connect is turned on for real.
 *
 *   npx tsx scripts/partner-connect-sandbox-drill.ts create    make a recipient account + onboarding link
 *   npx tsx scripts/partner-connect-sandbox-drill.ts link      a fresh onboarding link (they expire)
 *   npx tsx scripts/partner-connect-sandbox-drill.ts status    its stripe_transfers status
 *   npx tsx scripts/partner-connect-sandbox-drill.ts fund 5000 add $50 of test money to the platform balance
 *   npx tsx scripts/partner-connect-sandbox-drill.ts pay 3512  send a $35.12 "statement" twice: must be ONE transfer
 *   npx tsx scripts/partner-connect-sandbox-drill.ts broke     send more than the balance: must be refused, named
 *
 * Key: STRIPE_SANDBOX_SECRET_KEY from the environment or this checkout's .env.local.
 * 🛑 Refuses anything that is not a TEST key (sk_test_ / rk_test_). It never reads STRIPE_SECRET_KEY,
 * and it never prints the key. Drill state (the test account id) lives in the system temp folder.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Stripe from 'stripe'
import {
  createOnboardingLink,
  createPayoutTransfer,
  createRecipientAccount,
  payoutTransferGroup,
  retrieveTransfersStatus,
} from '../lib/partner-codes/connectStripe'

const STATE = path.join(os.tmpdir(), 'af-partner-connect-drill.json')

function sandboxKey(): string {
  let key = process.env.STRIPE_SANDBOX_SECRET_KEY?.trim()
  if (!key) {
    const file = path.join(process.cwd(), '.env.local')
    if (fs.existsSync(file)) {
      const line = fs.readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith('STRIPE_SANDBOX_SECRET_KEY='))
      key = line?.slice('STRIPE_SANDBOX_SECRET_KEY='.length).trim().replace(/^["']|["']$/g, '')
    }
  }
  if (!key) throw new Error('Set STRIPE_SANDBOX_SECRET_KEY (in .env.local) to your sandbox secret key.')
  if (!/^(sk|rk)_test_/.test(key)) throw new Error('Refusing: STRIPE_SANDBOX_SECRET_KEY is not a TEST key. This drill only runs in a sandbox.')
  return key
}

function readState(): { accountId?: string; run?: string } {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8'))
  } catch {
    return {}
  }
}

function writeState(s: { accountId?: string; run?: string }) {
  fs.writeFileSync(STATE, JSON.stringify(s, null, 2))
}

async function main() {
  const [cmd, arg] = process.argv.slice(2)
  // The app's own API version (lib/stripe-client.ts), so the drill speaks what production speaks.
  const stripe = new Stripe(sandboxKey(), { apiVersion: '2026-02-25.clover' })
  const me = await stripe.accounts.retrieve()
  console.log(`sandbox platform: ${me.id} (${me.settings?.dashboard?.display_name ?? 'unnamed'})`)

  if (cmd === 'create') {
    const run = `drill-${Date.now()}`
    const account = await createRecipientAccount(stripe, { ownerUserId: run, email: `${run}@example.com`, displayName: 'Drill Commissioner' })
    writeState({ accountId: account.id, run })
    console.log(`account: ${account.id}`)
    console.log(`stripe_transfers: ${await retrieveTransfersStatus(stripe, account.id)} (expected: not active yet)`)
    const again = await createRecipientAccount(stripe, { ownerUserId: run, email: `${run}@example.com`, displayName: 'Drill Commissioner' })
    console.log(`same key, second create: ${again.id === account.id ? 'SAME account (good: no duplicates)' : `DIFFERENT account ${again.id} (BAD)`}`)
    const link = await createOnboardingLink(stripe, { accountId: account.id, baseUrl: 'http://localhost:3774', update: false })
    console.log(`onboarding link (open it, use Stripe's test-data options):\n${link}`)
    return
  }

  const { accountId, run } = readState()
  if (!accountId) throw new Error('Run "create" first.')

  if (cmd === 'link') {
    // Account links expire after a few minutes; make a fresh one.
    console.log(await createOnboardingLink(stripe, { accountId, baseUrl: 'http://localhost:3774', update: false }))
    return
  }

  if (cmd === 'group') {
    // Every transfer recorded for one drill statement: proves a retry made no second payment.
    const group = payoutTransferGroup(`${run}-po-${arg ?? '1'}`)
    const list = await stripe.transfers.list({ transfer_group: group, limit: 10 })
    console.log(`transfers in ${group}: ${list.data.length} -> ${list.data.map((t) => `${t.id} $${(t.amount / 100).toFixed(2)}`).join(', ')}`)
    return
  }

  if (cmd === 'status') {
    console.log(`account ${accountId}: stripe_transfers = ${await retrieveTransfersStatus(stripe, accountId)}`)
    return
  }

  if (cmd === 'fund') {
    const amount = Number(arg) || 5000
    // Stripe's published test payment method whose funds are available immediately.
    const pi = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      payment_method: 'pm_card_bypassPending',
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      description: 'Partner Codes drill: fund the sandbox platform balance',
    })
    const bal = await stripe.balance.retrieve()
    console.log(`funded ${pi.status}; available USD: ${bal.available.find((b) => b.currency === 'usd')?.amount ?? 0} cents`)
    return
  }

  if (cmd === 'pay') {
    const amountCents = Number(arg) || 3512
    const status = await retrieveTransfersStatus(stripe, accountId)
    console.log(`stripe_transfers = ${status}${status === 'active' ? '' : ' (the app would refuse to send here)'}`)
    const payout = { payoutId: `${run}-po-${process.argv[4] ?? '1'}`, accountId, amountCents, periodMonth: '2026-10', partnerCodeId: 'drill', attempt: Number(process.argv[5] ?? 0) }
    const first = await createPayoutTransfer(stripe, payout)
    const second = await createPayoutTransfer(stripe, payout)
    console.log('first send :', first)
    console.log('second send:', second)
    if (first.ok && second.ok) console.log(first.transferId === second.transferId ? 'ONE transfer for two sends (good)' : 'TWO transfers (BAD)')
    return
  }

  if (cmd === 'broke') {
    const out = await createPayoutTransfer(stripe, { payoutId: `${run}-po-${process.argv[4] ?? 'broke'}`, accountId, amountCents: Number(arg) || 99_999_999, periodMonth: '2026-10', partnerCodeId: 'drill', attempt: Number(process.argv[5] ?? 0) })
    console.log('over-balance send:', out, out.ok ? '(BAD: it went through)' : out.insufficientBalance ? '(good: named as insufficient balance)' : '(refused, different reason)')
    return
  }

  throw new Error('Commands: create | link | status | fund [cents] | pay [cents] | broke')
}

main().catch((error) => {
  // Stripe errors are printed by type/code only: their messages can carry key details.
  const e = error as { type?: string; code?: string; message?: string; raw?: { message?: string } }
  if (e?.type?.startsWith('Stripe')) console.error(`[drill] Stripe ${e.type}${e.code ? ` (${e.code})` : ''}: ${(e.raw?.message ?? '').replace(/(sk|rk)_(test|live)_[A-Za-z0-9]+/g, '[key]')}`)
  else console.error(`[drill] ${e?.message ?? error}`)
  process.exit(1)
})
