import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { nativeFormatPatch } from '@/lib/league/nativeFormatPatch'
import { GuillotineFirstEntryModal } from '@/components/guillotine/GuillotineFirstEntryModal'
import { existsSync } from 'node:fs'
import path from 'node:path'

const h = vi.hoisted(() => ({ tx: null as any, transaction: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: h.transaction } }))
import { resizeNativeLeague } from '@/lib/league/resizeNativeLeague'

beforeEach(() => {
  localStorage.clear()
  const roster = { id: 'r2', platformUserId: 'open-slot-L-2', playerData: { draftPicks: [] } }
  h.tx = {
    leagueEntrySlot: { findMany: vi.fn().mockResolvedValue([{ id: 's1', slotNumber: 1, rosterId: 'r1', status: 'FILLED' }, { id: 's2', slotNumber: 2, rosterId: 'r2', status: 'OPEN' }]), create: vi.fn(), deleteMany: vi.fn() },
    leagueTeam: { findMany: vi.fn().mockResolvedValue([{ externalId: 'r1', claimedByUserId: 'u1', teamName: 'Owner' }, { externalId: 'r2', claimedByUserId: null }]), create: vi.fn(), deleteMany: vi.fn() },
    roster: { findMany: vi.fn().mockResolvedValue([roster]), create: vi.fn().mockResolvedValue({ id: 'r3', platformUserId: 'open-slot-L-3' }), deleteMany: vi.fn() },
    draftSession: { findMany: vi.fn().mockResolvedValue([{ id: 'd', status: 'pre_draft', slotOrder: [{ slot: 1, rosterId: 'r2', displayName: 'Open' }, { slot: 2, rosterId: 'r1', displayName: 'Owner' }] }]), update: vi.fn() },
    redraftSeason: { findFirst: vi.fn().mockResolvedValue(null) },
    leagueSettings: { updateMany: vi.fn() }, league: { update: vi.fn() },
  }
  h.transaction.mockImplementation(async (fn: any) => fn(h.tx))
})

describe('native league format conversion', () => {
  it('clears Guilly flags and variant while preserving unrelated league settings', () => {
    const patch = nativeFormatPatch('redraft', { inviteCode: 'KEEP', guillotineMode: true, guillotine_mode: true, conceptRules: { concept: 'guillotine', extensions: { note: 'keep' } } })
    expect(patch).toMatchObject({ leagueVariant: 'redraft', guillotineMode: false, survivorMode: false, bestBallMode: false, isDynasty: false,
      settings: { inviteCode: 'KEEP', league_type: 'redraft', guillotine_mode: false, conceptRules: { concept: 'redraft', extensions: { note: 'keep' } } } })
  })
  it('sets only the selected specialty mode', () => {
    expect(nativeFormatPatch('guillotine', {})).toMatchObject({ guillotineMode: true, survivorMode: false, bestBallMode: false })
    expect(nativeFormatPatch('dynasty', {})).toMatchObject({ guillotineMode: false, isDynasty: true })
  })
})

describe('pre-draft team capacity', () => {
  it('expands open seats and synchronizes the draft without disturbing the existing order', async () => {
    await resizeNativeLeague('L', 3, {})
    expect(h.tx.leagueEntrySlot.create).toHaveBeenCalledWith({ data: { leagueId: 'L', slotNumber: 3, rosterId: 'r3', status: 'OPEN' } })
    expect(h.tx.draftSession.update.mock.calls[0][0].data).toMatchObject({ teamCount: 3, slotOrder: [{ slot: 1, rosterId: 'r2' }, { slot: 2, rosterId: 'r1' }, { slot: 3, rosterId: 'r3' }] })
    expect(h.tx.league.update).toHaveBeenCalledWith({ where: { id: 'L' }, data: { leagueSize: 3 } })
  })
  it('refuses to remove a claimed manager seat', async () => {
    h.tx.leagueEntrySlot.findMany.mockResolvedValue([{ id: 's3', slotNumber: 3, rosterId: 'r3', status: 'FILLED' }])
    await expect(resizeNativeLeague('L', 2, {})).rejects.toThrow('Only empty open seats')
    expect(h.tx.league.update).not.toHaveBeenCalled()
    expect(h.tx.roster.deleteMany).not.toHaveBeenCalled()
  })
  it('refuses capacity changes after a draft starts', async () => {
    h.tx.draftSession.findMany.mockResolvedValue([{ status: 'in_progress' }])
    await expect(resizeNativeLeague('L', 3, {})).rejects.toThrow('after drafting starts')
    expect(h.tx.league.update).not.toHaveBeenCalled()
  })
})

describe('Guilly intro on mobile', () => {
  it('uses a shipped video and allows the manager to enter even if media fails', () => {
    const onClose = vi.fn()
    const { container } = render(<GuillotineFirstEntryModal leagueId="L" show onClose={onClose} />)
    const video = container.querySelector('video')!
    expect(existsSync(path.join(process.cwd(), 'public', video.getAttribute('src')!))).toBe(true)
    expect(video.muted).toBe(true)
    expect(video.playsInline).toBe(true)
    expect(video.controls).toBe(true)
    fireEvent.error(video)
    expect(screen.getByRole('status').textContent).toContain('could not load')
    fireEvent.click(screen.getByRole('button', { name: 'Enter league' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
