import { beforeEach, describe, expect, it, vi } from 'vitest'
const shell = vi.hoisted(() => vi.fn())
vi.mock('@/lib/prisma', () => ({ prisma: { tournamentShell: { findUnique: shell } } }))
import { assertTournamentCommissioner } from '@/lib/tournament/shellAccess'
beforeEach(() => vi.resetAllMocks())
describe('season-format isolation from legacy operations', () => {
  it.each(['blueprint', 'rules_published'])('blocks legacy commissioner operations for %s', async status => {
    shell.mockResolvedValue({ commissionerId: 'owner', status })
    await expect(assertTournamentCommissioner('t1', 'owner')).rejects.toThrow('FORBIDDEN')
  })
  it('lets the setup route inspect a plan before returning its own conflict response', async () => {
    shell.mockResolvedValue({ commissionerId: 'owner', status: 'rules_published' })
    await expect(assertTournamentCommissioner('t1', 'owner', true)).resolves.toBeUndefined()
  })
  it('preserves legacy active tournament authorization', async () => {
    shell.mockResolvedValue({ commissionerId: 'owner', status: 'active' })
    await expect(assertTournamentCommissioner('t1', 'owner')).resolves.toBeUndefined()
  })
})
