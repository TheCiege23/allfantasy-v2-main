'use client'

import { useEffect, useRef } from 'react'
import ChimmyChatShell from '@/components/chimmy/ChimmyChatShell'
import type { AIContextSource } from '@/lib/chimmy-chat/types'
import type { CommandCenterViewModel } from '@/lib/league-command-center/types'

/**
 * Chimmy, mounted in place as a right-side drawer on the Command Center.
 *
 * Why in-place rather than a cross-route handoff — all three of the existing
 * handoff paths silently drop the prompt from a standalone `/league/...` route:
 *
 *  1. `openChimmyWithPrompt({ autoSend: false })` dispatches `af-chimmy-prefill`,
 *     which **no component in the app listens for**.
 *  2. `af-chimmy-shortcut` only has a listener inside a mounted `ChimmyChat`,
 *     and the two components that mount one (`DashboardShell`,
 *     `NocturneDashboard`) are dashboard-scoped — neither is mounted here.
 *  3. `/ai-chat?prompt=…` does not work either: `app/ai-chat/page.tsx` renders
 *     `<ChimmyChatShell />` with no props and never reads the query param. The
 *     `?prompt=` handling inside the shell is cleanup for a parent that passes
 *     `initialPrompt`, not a URL reader.
 *
 * Passing `initialPrompt` directly is the one path that is guaranteed to work,
 * and it keeps the user in the league context the chip was about.
 *
 * League context (`leagueId`, `sport`, `season`, `week`, `teamId`) is forwarded
 * so answers are grounded in this league rather than generic.
 */
export interface CommandCenterChimmyProps {
  open: boolean
  onClose: () => void
  viewModel: CommandCenterViewModel
  prompt: string | null
  insightType?: 'matchup' | 'playoff' | 'dynasty' | 'trade' | 'waiver' | 'draft'
  source: AIContextSource
}

export function CommandCenterChimmy({
  open,
  onClose,
  viewModel,
  prompt,
  insightType,
  source,
}: CommandCenterChimmyProps) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  // Escape closes the drawer, and body scroll is locked while it is open.
  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', onKeyDown)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  if (!open) return null

  const season = Number.parseInt(viewModel.league.seasonLabel, 10)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Ask Chimmy"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        justifyContent: 'flex-end',
        background: 'rgba(10, 11, 18, 0.62)',
        backdropFilter: 'blur(3px)',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 'min(460px, 100%)',
          height: '100%',
          background: 'var(--cc-panel)',
          borderLeft: '1px solid var(--cc-border)',
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <ChimmyChatShell
          /*
           * `key` is the prompt so that selecting a different chip while the
           * drawer is already open remounts the shell and re-applies the new
           * prompt. Without it, the shell's `initialPromptApplied` ref would
           * suppress every prompt after the first.
           */
          key={prompt ?? 'cc-chimmy'}
          initialPrompt={prompt ?? undefined}
          clearUrlPromptAfterUse={false}
          leagueId={viewModel.league.leagueId}
          leagueName={viewModel.league.name}
          teamId={viewModel.viewer.teamId}
          sport={viewModel.league.sport}
          season={Number.isFinite(season) ? season : null}
          week={viewModel.league.currentWeek}
          insightType={insightType}
          source={source}
          onClose={onClose}
          compact
          className="rounded-none border-0 flex-1 min-h-0 h-full"
        />
      </div>
    </div>
  )
}

export default CommandCenterChimmy
