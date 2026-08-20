/**
 * Phase 5I — lightweight locks for real-device QA follow-ups (pick submit busy, mobile padding, resync a11y).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

describe('Phase 5I — pick submitting wired to pool UI', () => {
  const client = read('components/app/draft-room/DraftRoomPageClient.tsx')
  const panel = read('components/app/draft-room/PlayerPanel.tsx')
  const sleeper = read('components/app/draft-room/SleeperPoolTable.tsx')
  const modal = read('components/app/draft-room/PlayerDetailModal.tsx')

  it('passes pickSubmitting into SportAwareDraftRoom', () => {
    expect(client).toMatch(/pickSubmitting=\{pickSubmitting\}/)
  })

  it('PlayerPanel exposes pickSubmitting on props and list row', () => {
    expect(panel).toMatch(/pickSubmitting\?: boolean/)
    expect(panel).toMatch(/pickSubmitting=\{pickSubmitting\}/)
    expect(panel).toMatch(/aria-busy=\{pickSubmitting/)
    expect(panel).toMatch(/aria-label=\{/)
  })

  it('SleeperPoolTable draft control respects pickSubmitting', () => {
    expect(sleeper).toMatch(/disabled=\{!canDraft \|\| drafted \|\| pickSubmitting\}/)
    expect(sleeper).toMatch(/aria-busy=\{pickSubmitting && canDraft && !drafted\}/)
  })

  it('PlayerDetailModal Draft button supports pickSubmitting', () => {
    expect(modal).toMatch(/pickSubmitting = false/)
    expect(modal).toMatch(/disabled=\{pickSubmitting\}/)
    expect(modal).toMatch(/aria-busy=\{pickSubmitting\}/)
  })
})

describe('Phase 5I — mobile shell + resync accessibility', () => {
  it('DraftRoomShell mobile content uses safe-area-aware bottom padding', () => {
    const shell = read('components/app/draft-room/DraftRoomShell.tsx')
    expect(shell).toMatch(/safe-area-inset-bottom/)
    expect(shell).toMatch(/draft-mobile-content/)
  })

  it('DraftTopBar resync exposes aria-busy and aria-label', () => {
    const top = read('components/app/draft-room/DraftTopBar.tsx')
    expect(top).toMatch(/aria-busy=\{resyncLoading\}/)
    expect(top).toMatch(/aria-label=\{/)
  })

  it('mobile quick actions have explicit aria-label', () => {
    const client = read('components/app/draft-room/DraftRoomPageClient.tsx')
    expect(client).toMatch(/aria-label="Open player search"/)
    expect(client).toMatch(/aria-label="Open draft queue"/)
  })

  it('pick submitting banner sets aria-busy', () => {
    const client = read('components/app/draft-room/DraftRoomPageClient.tsx')
    expect(client).toMatch(/aria-busy="true"[\s\S]{0,120}data-testid="draft-pick-submitting-banner"/)
  })
})
