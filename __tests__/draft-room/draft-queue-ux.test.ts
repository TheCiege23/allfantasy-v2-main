/**
 * Queue tab hierarchy — manual-queue primary, intel + AI options folded.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')

describe('draft queue UX (redraft snake)', () => {
  it('Draft Intelligence accordion defaults collapsed', () => {
    const src = readFileSync(
      resolve(root, 'components/app/draft-room/DraftIntelQueuePanel.tsx'),
      'utf8',
    )
    expect(src).toContain('defaultOpen={false}')
    expect(src).toContain('Draft intelligence')
  })

  it('QueuePanel wraps AI / autopick controls in a disclosure for redraft_snake', () => {
    const src = readFileSync(resolve(root, 'components/app/draft-room/QueuePanel.tsx'), 'utf8')
    expect(src).toContain('data-testid="draft-queue-ai-options"')
    expect(src).toContain('<details')
    expect(src).toContain('draft-queue-ai-reorder-toggle')
    expect(src).toContain('draft-queue-search')
  })

  it('WarRoomPopup supports bottom-left trigger for premium layout', () => {
    const src = readFileSync(resolve(root, 'components/app/draft-room/WarRoomPopup.tsx'), 'utf8')
    expect(src).toContain('triggerPosition')
    expect(src).toContain('data-trigger-position')
    expect(src).toContain('bottom-left')
  })

  it('Draft helper bubble can anchor bottom-left for redraft snake', () => {
    const src = readFileSync(
      resolve(root, 'components/app/draft-room/DraftHelperFloatingBubble.tsx'),
      'utf8',
    )
    expect(src).toContain('data-helper-anchor')
    expect(src).toContain('bottom-left')
  })
})
