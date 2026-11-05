import { expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  identities: vi.fn().mockResolvedValue([{ providerPlayerId: 'known', displayName: 'Directory Name' }]),
  snapshot: vi.fn().mockResolvedValue({ roster: [
    { fantraxId: 'known', name: 'Older Name' },
    { fantraxId: 'missing', name: ' Saved Name ' },
    { fantraxId: 'unrequested', name: 'Other Player' },
  ] }),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {
  playerProviderIdentity: { findMany: db.identities },
  fantraxLeague: { findUnique: db.snapshot },
} }))

import { lookupProviderIdentityNames } from '@/lib/core-app/providerIdentityNames'

it('fills missing Fantrax names from the exact league snapshot by player ID', async () => {
  const names = await lookupProviderIdentityNames('fantrax', 'NCAAB', ['known', 'missing'], 'snapshot-id')
  expect(db.snapshot).toHaveBeenCalledWith({ where: { id: 'snapshot-id' }, select: { roster: true } })
  expect([...names]).toEqual([
    ['known', { name: 'Directory Name' }],
    ['missing', { name: 'Saved Name' }],
  ])
})
