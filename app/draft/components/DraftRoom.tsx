'use client'

import type { ComponentProps } from 'react'
import { DraftShell } from './DraftShell'

/**
 * Full-viewport draft chrome (no AppShell / league sidebars).
 * Uses the existing draft engine (`DraftShell` + `draftRoomStateRow`).
 *
 * 🛑 THE FRAME SCROLLS (2026-11-16). A `fixed` element never scrolls the page, so without
 * `overflow-y-auto` everything below the first screen — on a phone the Queue / Roster / Chat / AI
 * panel, under the board and the player list — could not be reached at all.
 */
export function DraftRoom(props: ComponentProps<typeof DraftShell>) {
  return (
    <div
      className="fixed inset-0 z-[100] flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain bg-[#0d1117] text-[#e6edf3]"
      data-testid="draft-room-frame"
    >
      <DraftShell {...props} />
    </div>
  )
}
