import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ ledger: vi.fn(async () => ({ ok: true, id: 'tx1' })) }))
vi.mock('@/lib/platform/current-user', () => ({ resolvePlatformUser: async () => ({ appUserId: 'u1' }) }))
vi.mock('@/lib/platform/wallet-service', () => ({ getPlatformWalletSummary: async () => ({ balance: 100 }), createWalletLedgerEntry: h.ledger }))

import { POST } from '@/app/api/shared/wallet/withdraw/route'
import { LEAGUE_ENTRY_FEE_ENV_VAR } from '@/lib/monetization/leagueEntryFeeKillSwitch'

const req = () => new Request('http://x/api/shared/wallet/withdraw', { method: 'POST', body: JSON.stringify({ amount: 20 }) }) as never
const prior = process.env[LEAGUE_ENTRY_FEE_ENV_VAR]

describe('🛑 wallet withdrawals follow the money switch', () => {
  beforeEach(() => h.ledger.mockClear())
  afterEach(() => {
    if (prior === undefined) delete process.env[LEAGUE_ENTRY_FEE_ENV_VAR]
    else process.env[LEAGUE_ENTRY_FEE_ENV_VAR] = prior
  })

  it('refuses and writes nothing while AllFantasy holds no money', async () => {
    delete process.env[LEAGUE_ENTRY_FEE_ENV_VAR]
    const res = await POST(req())
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'league_entry_fee_disabled' })
    expect(h.ledger).not.toHaveBeenCalled()
  })

  it('positive control: with the switch on, the request is filed as before', async () => {
    process.env[LEAGUE_ENTRY_FEE_ENV_VAR] = 'true'
    const res = await POST(req())
    expect(res.status).toBe(200)
    expect(h.ledger).toHaveBeenCalledTimes(1)
  })
})
