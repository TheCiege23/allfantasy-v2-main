import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')

describe('G56 draft room customer experience', () => {
  it('makes queue size and destructive clearing explicit', () => {
    const queue = readFileSync(resolve(root, 'components/app/draft-room/QueuePanel.tsx'), 'utf8')
    const room = readFileSync(resolve(root, 'components/app/draft-room/DraftRoomPageClient.tsx'), 'utf8')

    expect(queue).toContain('data-testid="draft-queue-count"')
    expect(queue).toContain('data-testid="draft-queue-clear-confirmation"')
    expect(queue).toContain('data-testid="draft-queue-clear-confirm"')
    expect(room).toContain('onClear={handleClearQueue}')
    expect(room).toContain('handleQueueSave([])')
  })

  it('announces current pick changes and labels round navigation', () => {
    const board = readFileSync(resolve(root, 'components/app/draft-room/DraftBoard.tsx'), 'utf8')

    expect(board).toContain('data-testid="draft-board-live-status"')
    expect(board).toContain('aria-live="polite"')
    expect(board).toContain('aria-label="Previous draft round"')
    expect(board).toContain('aria-label="Next draft round"')
    expect(board).toContain("aria-current={currentOwnerSlot === entry.slot ? 'true' : undefined}")
  })

  it('shows the real player-pool loading stage instead of a fixed placeholder', () => {
    const playerPanel = readFileSync(resolve(root, 'components/app/draft-room/PlayerPanel.tsx'), 'utf8')

    expect(playerPanel).toContain('loadingMessage?: string | null')
    expect(playerPanel).toContain("loadingMessage?.trim() || 'Loading player pool...'")
  })

  it('uses customer-safe Draft Assist labels and an actionable empty state', () => {
    const helper = readFileSync(resolve(root, 'components/app/draft-room/DraftHelperIntelligence.tsx'), 'utf8')

    expect(helper).toContain("name: 'Draft assistant'")
    expect(helper).toContain("name: 'Live recommendations'")
    expect(helper).toContain("name: 'Market rankings'")
    expect(helper).toContain("name: 'Smart queue'")
    expect(helper).toContain('Draft guidance is getting ready')
    expect(helper).not.toContain("name: 'Live Brain'")
  })
})
