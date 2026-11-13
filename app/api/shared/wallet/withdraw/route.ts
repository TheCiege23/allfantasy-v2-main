import { NextRequest, NextResponse } from 'next/server'
import { resolvePlatformUser } from '@/lib/platform/current-user'
import { createWalletLedgerEntry, getPlatformWalletSummary } from '@/lib/platform/wallet-service'
import { leagueMoneyRefusal } from '@/lib/monetization/leagueEntryFeeKillSwitch'

/**
 * POST /api/shared/wallet/withdraw — a payout request against the platform wallet balance.
 *
 * 🛑 BEHIND THE SAME SWITCH AS LEAGUE MONEY. AllFantasy holds no user money: deposits are already
 * disabled (./deposit), so the only balance this could draw on is one nobody paid in. While
 * `ALLFANTASY_LEAGUE_ENTRY_FEE_ENABLED` is off it refuses, like every league-money route; the ledger
 * rows already written are kept.
 */
export async function POST(req: NextRequest) {
  const moneyOff = leagueMoneyRefusal('wallet withdrawals')
  if (moneyOff) return NextResponse.json({ error: moneyOff.error, code: moneyOff.code }, { status: moneyOff.status })
  const user = await resolvePlatformUser()
  if (!user.appUserId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json().catch(() => ({}))
  const amount = Number(body?.amount || 0)
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Invalid withdrawal amount' }, { status: 400 })
  }

  const summary = await getPlatformWalletSummary(user.appUserId)
  if (summary.balance < amount) {
    return NextResponse.json({ error: 'Insufficient balance' }, { status: 400 })
  }

  const result = await createWalletLedgerEntry({
    userId: user.appUserId,
    entryType: 'withdrawal',
    amountCents: Math.round(amount * 100),
    status: 'pending',
    description: 'Withdrawal request',
    refProduct: 'shared',
  })

  if (!result.ok) {
    return NextResponse.json({ error: result.error || 'Withdrawal failed' }, { status: 500 })
  }

  return NextResponse.json({ status: 'ok', transactionId: result.id, state: 'pending' })
}
