'use client'

import '@/components/core-app/af-core.css'
import './af-draft-room.css'
import { useMessages } from '@/components/i18n/useMessages'
import { draftRoomRedesignMessages } from '@/lib/core-app/messages/draftRoomRedesign'

type DraftRoomMode = 'offline' | 'autopick' | 'mock'

/**
 * Which explanation, if any, the room shows above the board. Offline outranks auto-pick: in an
 * offline draft the commissioner enters every pick, so a viewer's auto-pick never fires.
 */
export function resolveDraftRoomMode(input: {
  executionMode?: string | null
  viewerAutopickEnabled?: boolean | null
  isMock?: boolean
}): DraftRoomMode | null {
  if (input.isMock) return 'mock'
  if (input.executionMode === 'offline') return 'offline'
  if (input.viewerAutopickEnabled) return 'autopick'
  return null
}

export function DraftModeBanner({ mode, isCommissioner = false }: { mode: DraftRoomMode | null; isCommissioner?: boolean }) {
  const m = useMessages(draftRoomRedesignMessages)
  if (!mode) return null
  const label = mode === 'offline' ? m.modeOfflineLabel : mode === 'autopick' ? m.modeAutopickLabel : m.modeMockLabel
  const body =
    mode === 'offline'
      ? isCommissioner
        ? m.modeOfflineCommissioner
        : m.modeOfflineMember
      : mode === 'autopick'
        ? m.modeAutopickBody
        : m.modeMockBody
  return (
    <div
      className="af-core af-dr af-dr-banner"
      data-mode={mode}
      data-testid={mode === 'offline' ? 'draft-room-offline-banner' : `draft-room-${mode}-banner`}
      role="status"
    >
      <span className="af-dr-banner-tag">{label}</span>
      <p className="af-dr-banner-body">{body}</p>
    </div>
  )
}
