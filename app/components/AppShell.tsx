'use client'

import type { ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { cn } from '@/lib/utils'

export type AppShellProps = {
  children: ReactNode
  /** Left column: typically `<LeftChatPanel … />` */
  leftPanel: ReactNode
  /** Right column: typically `<RightControlPanel … />` — hidden when `rightRailCollapsed` */
  rightPanel: ReactNode
  /** Merged onto the root layout div (e.g. `data-dashboard-user-id`) */
  rootProps?: React.HTMLAttributes<HTMLDivElement> & { 'data-dashboard-user-id'?: string }
  /** Desktop: collapse My Leagues rail — center column expands. */
  rightRailCollapsed?: boolean
  onRightRailExpand?: () => void
  /** e.g. league count — shown on the collapsed strip */
  rightRailCollapsedHint?: string
  /**
   * When true, center column is transparent and side rails use glass (for `SpecialtyLeagueAtmosphere` behind shell).
   */
  immersive?: boolean
  /**
   * Root height: default full viewport. Use a calc when the shell is nested under `GlobalAppShell` (header + mobile tabs).
   */
  rootClassName?: string
  /**
   * Renders only the center `children` full width/height (no side chat / My Leagues rails).
   * Used when the same league hub is embedded in the dashboard center panel (see `?embed=1` on `/league/[id]`).
   */
  embedCenterOnly?: boolean
}

/**
 * Single source of truth for the 3-panel layout (chat | workspace | My Leagues).
 * Adjust widths only here so dashboard, league, and future pages stay aligned.
 */
export default function AppShell({
  children,
  leftPanel,
  rightPanel,
  rootProps,
  rightRailCollapsed = false,
  onRightRailExpand,
  rightRailCollapsedHint,
  immersive = false,
  rootClassName,
  embedCenterOnly = false,
}: AppShellProps) {
  if (embedCenterOnly) {
    return (
      <div
        className={cn(
          'flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden text-[var(--text)]',
          rootClassName ?? 'h-full',
        )}
        style={{ background: 'var(--bg)' }}
        data-af-embed-center="1"
        {...rootProps}
      >
        {children}
      </div>
    )
  }

  const leftRailClass = immersive
    ? 'border-r border-white/[0.08] bg-[#070b14]/80 backdrop-blur-xl'
    : 'border-[var(--border)]'
  const rightRailClass = immersive
    ? 'border-l border-white/[0.08] bg-[#070b14]/80 backdrop-blur-xl'
    : 'border-[var(--border)]'
  const centerBg = immersive ? { background: 'transparent' as const } : { background: 'var(--bg)' }
  const rootBg = immersive ? { background: 'transparent' as const } : { background: 'var(--bg)' }

  return (
    <div
      className={cn(
        'flex w-full min-h-0 overflow-hidden text-[var(--text)]',
        rootClassName ?? 'h-screen',
        immersive && 'relative z-[1]',
      )}
      style={rootBg}
      data-af-immersive={immersive ? '1' : undefined}
      {...rootProps}
    >
      {/* Left chat rail */}
      <aside
        className={cn(
          'hidden h-full w-[45%] min-h-0 flex-shrink-0 flex-col overflow-hidden transition-[width] duration-200 ease-out md:flex',
          leftRailClass,
        )}
        style={immersive ? undefined : { background: 'var(--panel2)' }}
      >
        {leftPanel}
      </aside>

      {/* Center workspace — grows when right rail is collapsed */}
      <div
        className={cn(
          // flex-1 below md so the center column gets height when side rails are display:none
          'flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden transition-[flex] duration-200 ease-out',
          rightRailCollapsed ? 'md:min-w-0 md:flex-1' : 'md:w-[35%] md:flex-none',
        )}
        style={centerBg}
      >
        {children}
      </div>

      {/* Right: My Leagues — full strip or slim expand control */}
      <aside
        className={cn(
          'hidden h-full min-h-0 flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-out md:flex',
          rightRailCollapsed ? 'w-12 max-w-[3rem]' : 'w-[20%] max-w-[20%]',
          rightRailClass,
        )}
        style={immersive ? undefined : { background: 'var(--panel2)' }}
        data-testid="app-shell-right-rail"
      >
        {rightRailCollapsed ? (
          <div className="flex h-full w-full flex-col items-center gap-2 border-l border-white/[0.06] bg-[#0a0a1f] py-3">
            <button
              type="button"
              onClick={onRightRailExpand}
              className="inline-flex h-10 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-white/80 transition hover:bg-white/[0.08]"
              aria-label="Expand My Leagues"
              title="Expand My Leagues"
              data-testid="myleagues-rail-expand"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </button>
            {rightRailCollapsedHint ? (
              <span
                className="max-w-[2.5rem] text-center text-[9px] font-bold uppercase leading-tight text-white/35 [writing-mode:vertical-rl] [text-orientation:mixed]"
                title={rightRailCollapsedHint}
              >
                {rightRailCollapsedHint}
              </span>
            ) : null}
          </div>
        ) : (
          rightPanel
        )}
      </aside>
    </div>
  )
}
