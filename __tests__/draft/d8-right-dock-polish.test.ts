/**
 * D.8 — Right dock visual polish (Commit 23)
 *
 * Source-level invariants locking the visual improvements made to
 * DraftRightDockTabs, QueuePanel, and AutopickMeToggle.
 * No rendering, no DB, no network. All assertions use readFileSync + regex.
 *
 * Goals locked here:
 *   1.  Active tab underline uses from-cyan-400 → to-violet-400 gradient (fixes d6-1).
 *   2.  Tab header button is compact (py-1).
 *   3.  Queue panel header padding is py-1 (reduced from py-1.5).
 *   4.  Queue filter bar uses p-1 gap-1 (reduced from p-1.5 gap-1.5).
 *   5.  Queue items use min-h-[44px] touch target (was min-h-[46px]).
 *   6.  AutopickMeToggle container uses py-1 (reduced from py-1.5).
 *   7.  Tab testids are preserved (no regression).
 *   8.  Queue drag reorder GripVertical handle preserved.
 *   9.  DraftChatPanel data-testid preserved (no regression).
 *  10.  Away mode toggle data-testid preserved.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

const dockSrc = read('components/app/draft-room/DraftRightDockTabs.tsx')
const queueSrc = read('components/app/draft-room/QueuePanel.tsx')
const toggleSrc = read('components/app/draft-room/AutopickMeToggle.tsx')
const chatSrc = read('components/app/draft-room/DraftChatPanel.tsx')

// ---------------------------------------------------------------------------
// 1. Active tab underline — cyan→violet gradient (fixes pre-existing d6-1 gap)
// ---------------------------------------------------------------------------

describe('DraftRightDockTabs — active tab gradient underline (Commit 23)', () => {
  it('active underline span uses from-cyan-400', () => {
    expect(dockSrc).toMatch(/from-cyan-400/)
  })

  it('active underline span uses to-violet-400', () => {
    expect(dockSrc).toMatch(/to-violet-400/)
  })

  it('active underline uses bg-gradient-to-r (not the old solid bg-cyan-300/90)', () => {
    expect(dockSrc).toMatch(/bg-gradient-to-r from-cyan-400 to-violet-400/)
    expect(dockSrc).not.toMatch(/bg-cyan-300\/90/)
  })

  it('active underline still carries the ambient glow shadow', () => {
    expect(dockSrc).toMatch(/shadow-\[0_0_10px_rgba\(34,211,238/)
  })
})

// ---------------------------------------------------------------------------
// 2. Tab header compact padding
// ---------------------------------------------------------------------------

describe('DraftRightDockTabs — compact tab header (Commit 23)', () => {
  it('tab button has py-1 (no taller vertical padding)', () => {
    expect(dockSrc).toMatch(/py-1 text-\[8px\] font-semibold/)
  })

  it('tab button font size is text-[8px] uppercase (Sleeper-style density)', () => {
    expect(dockSrc).toMatch(/text-\[8px\] font-semibold uppercase tracking-\[0\.14em\]/)
  })
})

// ---------------------------------------------------------------------------
// 3. Queue panel header — reduced padding
// ---------------------------------------------------------------------------

describe('QueuePanel — compact header (Commit 23)', () => {
  it('queue header row uses px-2.5 py-1 (reduced from py-1.5)', () => {
    expect(queueSrc).toMatch(/border-b px-2\.5 py-1 \$\{rs/)
  })

  it('old py-1.5 header is gone', () => {
    expect(queueSrc).not.toMatch(/border-b px-2\.5 py-1\.5/)
  })
})

// ---------------------------------------------------------------------------
// 4. Queue filter bar — tighter spacing
// ---------------------------------------------------------------------------

describe('QueuePanel — compact filter bar (Commit 23)', () => {
  it('filter bar uses gap-1 (reduced from gap-1.5)', () => {
    expect(queueSrc).toMatch(/grid-cols-1 gap-1 border-b/)
  })

  it('filter bar uses p-1 (reduced from p-1.5)', () => {
    expect(queueSrc).toMatch(/border-white\/\[0\.06\] p-1 sm:grid-cols-2/)
  })

  it('old gap-1.5 filter bar is gone', () => {
    expect(queueSrc).not.toMatch(/grid-cols-1 gap-1\.5 border-b/)
  })
})

// ---------------------------------------------------------------------------
// 5. Queue items — touch target at 44px (not 46px), drag preserved
// ---------------------------------------------------------------------------

describe('QueuePanel — queue item touch target (Commit 23)', () => {
  it('queue item className has px-2.5 py-1 text-[11px] min-h-[44px] (all on one class string)', () => {
    expect(queueSrc).toMatch(/px-2\.5 py-1 text-\[11px\] min-h-\[44px\]/)
  })

  it('old px-2.5 py-1.5 ... min-h-[46px] combo is gone', () => {
    expect(queueSrc).not.toMatch(/px-2\.5 py-1\.5 text-\[11px\] min-h-\[46px\]/)
  })

  it('queue items still carry the draft-live-queue-item class', () => {
    expect(queueSrc).toMatch(/draft-live-queue-item/)
  })
})

// ---------------------------------------------------------------------------
// 6. AutopickMeToggle — compact container
// ---------------------------------------------------------------------------

describe('AutopickMeToggle — compact container (Commit 23)', () => {
  it('container uses px-3 py-1 (reduced from py-1.5)', () => {
    expect(toggleSrc).toMatch(/gap-2 border-b border-white\/\[0\.06\] px-3 py-1"/)
  })

  it('old py-1.5 on the container is gone', () => {
    expect(toggleSrc).not.toMatch(/border-white\/\[0\.06\] px-3 py-1\.5/)
  })

  it('autopick-me-toggle testid is preserved on the container', () => {
    expect(toggleSrc).toMatch(/data-testid="autopick-me-toggle"/)
  })
})

// ---------------------------------------------------------------------------
// 7. Tab testids — preserved (no regression)
// ---------------------------------------------------------------------------

describe('DraftRightDockTabs — testid regression (Commit 23)', () => {
  it('section root data-testid is preserved', () => {
    expect(dockSrc).toMatch(/data-testid=\{testIdBase\}/)
  })

  it('tablist data-testid is preserved', () => {
    expect(dockSrc).toMatch(/data-testid=\{`\$\{testIdBase\}-tablist`\}/)
  })

  it('per-tab button data-testid template is preserved', () => {
    expect(dockSrc).toMatch(/data-testid=\{`\$\{testIdBase\}-tab-\$\{tab\.id\}`\}/)
  })
})

// ---------------------------------------------------------------------------
// 8. Queue drag reorder — GripVertical handle and DnD wiring preserved
// ---------------------------------------------------------------------------

describe('QueuePanel — drag reorder preserved (Commit 23)', () => {
  it('GripVertical icon is still imported and rendered in queue items', () => {
    expect(queueSrc).toMatch(/GripVertical/)
  })

  it('queue items are draggable={canReorderVisually}', () => {
    expect(queueSrc).toMatch(/draggable=\{canReorderVisually\}/)
  })

  it('move-up button data-testid template is preserved', () => {
    expect(queueSrc).toMatch(/data-testid=\{`draft-queue-move-up-\$/)
  })

  it('move-down button data-testid template is preserved', () => {
    expect(queueSrc).toMatch(/data-testid=\{`draft-queue-move-down-\$/)
  })
})

// ---------------------------------------------------------------------------
// 9. DraftChatPanel — no regression
// ---------------------------------------------------------------------------

describe('DraftChatPanel — no regression (Commit 23)', () => {
  it('data-testid="draft-chat-panel" is still on the section root', () => {
    expect(chatSrc).toMatch(/data-testid="draft-chat-panel"/)
  })

  it('chat send button data-testid is preserved', () => {
    expect(chatSrc).toMatch(/data-testid="draft-chat-send"/)
  })

  it('chat message input data-testid is preserved', () => {
    expect(chatSrc).toMatch(/data-testid="draft-chat-input"/)
  })
})

// ---------------------------------------------------------------------------
// 10. Away mode toggle — preserved
// ---------------------------------------------------------------------------

describe('QueuePanel — away mode toggle preserved (Commit 23)', () => {
  it('away mode toggle data-testid is present', () => {
    expect(queueSrc).toMatch(/data-testid="draft-queue-away-toggle"/)
  })

  it('auto-pick from queue toggle data-testid is present', () => {
    expect(queueSrc).toMatch(/data-testid="draft-queue-autopick-toggle"/)
  })

  it('autopick mode Standard/AI Queue buttons are preserved in AutopickMeToggle', () => {
    expect(toggleSrc).toMatch(/data-testid="autopick-mode-standard"/)
    expect(toggleSrc).toMatch(/data-testid="autopick-mode-ai-queue"/)
  })
})
