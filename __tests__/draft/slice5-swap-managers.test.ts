import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf8')

describe('Slice 5 — swapDraftManagers engine contract', () => {
  const src = read('lib/live-draft-engine/DraftSessionService.ts')

  it('exports swapDraftManagers with structured result type', () => {
    expect(src).toMatch(/export type SwapDraftManagersResult/)
    expect(src).toMatch(/export async function swapDraftManagers/)
  })

  it('rejects same-slot swap with INVALID_SWAP_SAME_SLOT', () => {
    expect(src).toMatch(/code: 'INVALID_SWAP_SAME_SLOT'/)
    expect(src).toMatch(/fromSlot === toSlot/)
  })

  it('rejects unknown slots with SWAP_SLOT_NOT_FOUND', () => {
    expect(src).toMatch(/code: 'SWAP_SLOT_NOT_FOUND'/)
  })

  it('allows pre_draft, in_progress, and paused; rejects others with INVALID_STATUS', () => {
    expect(src).toMatch(/session\.status !== 'pre_draft'[\s\S]+?session\.status !== 'in_progress'[\s\S]+?session\.status !== 'paused'/)
    expect(src).toMatch(/code: 'INVALID_STATUS'/)
  })

  it('updates slotOrder ONLY — never touches DraftPick rows', () => {
    expect(src).toMatch(/slotOrder: nextSlotOrder/)
    // Surgical check: the swap function block must not call into draftPick.update / delete / create.
    const fn = src.split('export async function swapDraftManagers')[1]?.split('export async function completeDraftSession')[0] ?? ''
    expect(fn).not.toMatch(/draftPick\.(update|delete|create)/)
    expect(fn).toMatch(/draftPickAuditLog\.create/)
    expect(fn).toMatch(/draftSession\.update/)
  })

  it('does NOT change session status, timer, or pausedRemainingSeconds', () => {
    const fn = src.split('export async function swapDraftManagers')[1]?.split('export async function completeDraftSession')[0] ?? ''
    expect(fn).not.toMatch(/status: '/)
    expect(fn).not.toMatch(/timerEndAt:/)
    expect(fn).not.toMatch(/pausedRemainingSeconds/)
  })

  it('writes audit log entry with action=swap_manager and required metadata', () => {
    const fn = src.split('export async function swapDraftManagers')[1]?.split('export async function completeDraftSession')[0] ?? ''
    expect(fn).toMatch(/action: 'swap_manager'/)
    expect(fn).toMatch(/fromSlot,\s*\n\s*toSlot,/)
    expect(fn).toMatch(/fromRosterId: fromEntry\.rosterId/)
    expect(fn).toMatch(/toRosterId: toEntry\.rosterId/)
    expect(fn).toMatch(/effectiveFromOverall/)
  })
})

describe('Slice 5 — controls route action wiring', () => {
  const src = read('app/api/leagues/[leagueId]/draft/controls/route.ts')

  it('imports swapDraftManagers and adds swap_manager to ALLOWED_ACTIONS', () => {
    expect(src).toMatch(/swapDraftManagers,/)
    expect(src).toMatch(/'swap_manager',/)
  })

  it('action handler validates fromSlot/toSlot are integers (returns 400 SWAP_SLOT_NOT_FOUND)', () => {
    expect(src).toMatch(/Number\.isInteger\(fromSlot\)[\s\S]+?Number\.isInteger\(toSlot\)/)
    expect(src).toMatch(/code: 'SWAP_SLOT_NOT_FOUND'/)
  })

  it('returns 409 on INVALID_STATUS, 400 on INVALID_SWAP_SAME_SLOT', () => {
    expect(src).toMatch(/result\.code === 'INVALID_STATUS'\s*\?\s*409/)
  })
})

describe('Slice 5 — Swap Managers modal UI', () => {
  const src = read('components/app/draft-room/SwapManagerModal.tsx')

  it('exposes from/to slot dropdowns + confirm/cancel testids', () => {
    expect(src).toMatch(/data-testid="swap-manager-from-slot"/)
    expect(src).toMatch(/data-testid="swap-manager-to-slot"/)
    expect(src).toMatch(/data-testid="swap-manager-confirm"/)
    expect(src).toMatch(/data-testid="swap-manager-cancel"/)
  })

  it('disables confirm when slots match (UI guard before server)', () => {
    expect(src).toMatch(/sameSlot = fromSlot != null && toSlot != null && fromSlot === toSlot/)
    expect(src).toMatch(/disabled=\{submitting \|\| sameSlot \|\| slotOrder\.length < 2\}/)
  })

  it('passes fromSlot + toSlot in onAction swap_manager payload', () => {
    expect(src).toMatch(/onAction\('swap_manager', \{ fromSlot, toSlot \}\)/)
  })
})

describe('Slice 5 — Swap Managers entry point lives in commissioner control center', () => {
  const src = read('components/app/draft-room/CommissionerControlCenterModal.tsx')

  it('imports SwapManagerModal and renders behind a dedicated button', () => {
    expect(src).toMatch(/import \{ SwapManagerModal \} from '\.\/SwapManagerModal'/)
    expect(src).toMatch(/data-testid="draft-commissioner-open-swap-manager"/)
    expect(src).toMatch(/<SwapManagerModal\s+leagueId=\{leagueId\}/)
  })
})
