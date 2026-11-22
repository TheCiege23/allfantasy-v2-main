// @vitest-environment node
/**
 * A league with seats run by Chimmy can still draw its Whisperer: Chimmy sits the draw out instead of
 * blocking it (lib/zombie/beta2025RoleWorkflows.ts `whispererDrawSeats`).
 */
import { describe, expect, it } from 'vitest'
import { whispererDrawSeats } from '@/lib/zombie/beta2025RoleWorkflows'

const users = new Set(['u1', 'u2'])
const chimmy = (id: string, n: number) => ({ id, platformUserId: `open-slot-L-${n}` })
const open = chimmy
const run = (...ids: string[]) => new Set(ids)

describe('whispererDrawSeats', () => {
  it('🛑 one manager and three Chimmy seats: the draw runs, and only the manager is in it', () => {
    expect(whispererDrawSeats([{ id: 'r1', platformUserId: 'u1' }, chimmy('r2', 2), chimmy('r3', 3), chimmy('r4', 4)], users, run('r2', 'r3', 'r4'), 4)).toEqual({ ok: true, managerRosterIds: ['r1'] })
  })
  it('a full league of managers is unchanged', () => {
    expect(whispererDrawSeats([{ id: 'r1', platformUserId: 'u1' }, { id: 'r2', platformUserId: 'u2' }], users, run(), 2)).toEqual({ ok: true, managerRosterIds: ['r1', 'r2'] })
  })
  it('an empty seat nobody runs still blocks the draw', () => {
    const out = whispererDrawSeats([{ id: 'r1', platformUserId: 'u1' }, chimmy('r2', 2), open('r3', 3)], users, run('r2'), 3)
    expect(out).toEqual({ ok: false, error: 'Fill every seat with a manager, or hand it to Chimmy, before the Whisperer draw.' })
  })
  it('a missing seat, or one manager holding two, blocks it', () => {
    expect(whispererDrawSeats([{ id: 'r1', platformUserId: 'u1' }], users, run(), 2).ok).toBe(false)
    expect(whispererDrawSeats([{ id: 'r1', platformUserId: 'u1' }, { id: 'r2', platformUserId: 'u1' }], users, run(), 2).ok).toBe(false)
  })
  it('Chimmy alone cannot hold the role', () => {
    expect(whispererDrawSeats([chimmy('r1', 1), chimmy('r2', 2)], users, run('r1', 'r2'), 2)).toEqual({ ok: false, error: 'The Whisperer draw needs at least one manager: Chimmy cannot accept the role.' })
  })
})
