'use client'

import type { ReactNode } from 'react'
import { Bot, ChevronLeft, ChevronRight } from 'lucide-react'
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
  /** Desktop: collapse left chat rail — center column expands. */
  leftRailCollapsed?: boolean
  onLeftRailExpand?: () => void
  onLeftRailCollapse?: () => void
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
  /** Desktop shell preset. Balanced uses adjacent 40/35/25 columns for league/dashboard views. */
  layoutMode?: 'legacy-rail-clamp' | 'balanced-three-panel'
  /**
   * Drop the permanent left chat rail entirely (balanced-three-panel only) so the center workspace
   * reclaims that column — for surfaces that move chat into a floating/on-demand panel instead
   * (Dashboard V2 Phase 2.5). Default false: every existing consumer keeps the left rail unchanged.
   * When true, `leftPanel` is ignored and the left `<aside>` is not rendered.
   */
  hideLeftRail?: boolean
  /**
   * Drop the right rail entirely (balanced-three-panel only) so the center workspace reclaims that
   * column — symmetric to `hideLeftRail`, for surfaces that rehome the rail's affordances elsewhere
   * (Dashboard V2 Phase 3.8D moves profile/Create/Import into the header). Default false: every
   * existing consumer keeps the right rail unchanged. When true, `rightPanel` is ignored and the
   * right `<aside>` is not rendered.
   */
  hideRightRail?: boolean
}

/**
 * All four static column combinations for balanced-three-panel.
 * Must be literal strings — Tailwind's JIT scanner cannot detect dynamically constructed class names.
 */
const BALANCED_COLS = {
  // left open, right open: chat 40%, workspace 35%, My Leagues 25%
  both:       'md:[grid-template-columns:minmax(280px,40fr)_minmax(0,35fr)_minmax(240px,25fr)]',
  // left collapsed, right open: preserve workspace/right 35/25 ratio.
  leftOnly:   'md:[grid-template-columns:3rem_minmax(0,35fr)_minmax(240px,25fr)]',
  // left open, right collapsed: preserve chat/workspace 40/35 ratio.
  rightOnly:  'md:[grid-template-columns:minmax(280px,40fr)_minmax(0,35fr)_3rem]',
  // both collapsed
  none:       'md:[grid-template-columns:3rem_minmax(0,1fr)_3rem]',
  // hideLeftRail: no chat column — workspace takes all remaining width, My Leagues a compact
  // 240-340px rail (Phase 2.5 floating comms). NOTE: center must be the flexible 1fr column and
  // My Leagues an explicit width cap — using an fr ratio like 1fr:25fr collapses the workspace.
  noLeftBoth: 'md:[grid-template-columns:minmax(0,1fr)_minmax(240px,340px)]',
  // hideLeftRail + right collapsed: workspace full width + slim My Leagues strip.
  noLeftRightCollapsed: 'md:[grid-template-columns:minmax(0,1fr)_3rem]',
  // hideRightRail + hideLeftRail: single full-width workspace column (Phase 3.8D dashboard).
  noLeftNoRight: 'md:[grid-template-columns:minmax(0,1fr)]',
  // hideRightRail only (left rail kept): chat + workspace, no My Leagues column.
  leftNoRight: 'md:[grid-template-columns:minmax(280px,40fr)_minmax(0,60fr)]',
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
  leftRailCollapsed = false,
  onLeftRailExpand,
  onLeftRailCollapse,
  immersive = false,
  rootClassName,
  embedCenterOnly = false,
  layoutMode = 'legacy-rail-clamp',
  hideLeftRail = false,
  hideRightRail = false,
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
  const balancedDesktopLayout = layoutMode === 'balanced-three-panel'

  // Use static class literals so Tailwind's JIT scanner can detect all variants.
  const balancedDesktopColumns = !balancedDesktopLayout ? '' :
    hideRightRail ? (hideLeftRail ? BALANCED_COLS.noLeftNoRight : BALANCED_COLS.leftNoRight) :
    hideLeftRail ? (rightRailCollapsed ? BALANCED_COLS.noLeftRightCollapsed : BALANCED_COLS.noLeftBoth) :
    leftRailCollapsed && rightRailCollapsed ? BALANCED_COLS.none :
    leftRailCollapsed ? BALANCED_COLS.leftOnly :
    rightRailCollapsed ? BALANCED_COLS.rightOnly :
    BALANCED_COLS.both

  return (
    <div
      className={cn(
        'w-full min-h-0 overflow-hidden text-[var(--text)]',
        rootClassName ?? 'h-screen',
        balancedDesktopLayout ? `grid grid-cols-1 ${balancedDesktopColumns}` : 'flex',
        immersive && 'relative z-[1]',
      )}
      style={rootBg}
      data-af-immersive={immersive ? '1' : undefined}
      data-af-layout-mode={balancedDesktopLayout ? 'balanced-three-panel' : 'legacy-rail-clamp'}
      data-af-left-collapsed={leftRailCollapsed ? '1' : undefined}
      data-af-right-collapsed={rightRailCollapsed ? '1' : undefined}
      {...rootProps}
    >
      {/* Left chat rail — slim strip when collapsed; omitted entirely when hideLeftRail
          (Phase 2.5 floating comms reclaims this column). */}
      {hideLeftRail ? null : (
      <aside
        className={cn(
          balancedDesktopLayout
            ? 'hidden h-full min-h-0 flex-col overflow-hidden md:flex md:min-w-0'
            : 'hidden h-full min-h-0 flex-shrink-0 flex-col overflow-hidden transition-[width] duration-200 ease-out md:flex md:w-[clamp(300px,24vw,360px)]',
          leftRailCollapsed && 'w-12 max-w-[3rem]',
          leftRailClass,
        )}
        style={immersive ? undefined : { background: 'var(--panel2)' }}
        data-testid="app-shell-left-rail"
      >
        {leftRailCollapsed ? (
          <div className="flex h-full w-full flex-col items-center gap-2 border-r border-white/[0.06] bg-[#0a0a1f] py-3">
            <button
              type="button"
              onClick={onLeftRailExpand}
              className="inline-flex h-10 w-9 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-white/80 transition hover:bg-white/[0.08]"
              aria-label="Open league panel"
              title="Open league panel"
              data-testid="chat-rail-expand"
            >
              <Bot className="h-5 w-5" aria-hidden />
            </button>
          </div>
        ) : (
          <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden">
            {onLeftRailCollapse ? (
              <button
                type="button"
                onClick={onLeftRailCollapse}
                className="absolute right-1 top-1 z-10 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-white/[0.08] bg-black/40 text-white/40 transition hover:text-white/70"
                aria-label="Collapse league panel"
                title="Collapse league panel"
                data-testid="chat-rail-collapse"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
              </button>
            ) : null}
            {leftPanel}
          </div>
        )}
      </aside>
      )}

      {/* Center workspace — grows when side rails are collapsed */}
      <main
        className={cn(
          balancedDesktopLayout
            ? 'flex min-h-0 min-w-0 w-full flex-col overflow-hidden'
            : 'flex min-h-0 min-w-0 w-full flex-1 flex-col overflow-hidden transition-[flex] duration-200 ease-out',
          !balancedDesktopLayout && (rightRailCollapsed ? 'md:min-w-0 md:flex-1' : 'md:min-w-0 md:flex-1 xl:min-w-[640px]'),
        )}
        style={centerBg}
      >
        {children}
      </main>

      {/* Right: My Leagues — full strip or slim expand control; omitted entirely when hideRightRail
          (Phase 3.8D rehomes the rail's affordances into the header). */}
      {hideRightRail ? null : (
      <aside
        className={cn(
          balancedDesktopLayout
            ? 'hidden h-full min-h-0 overflow-hidden md:flex md:min-w-0'
            : 'hidden h-full min-h-0 flex-shrink-0 overflow-hidden transition-[width] duration-200 ease-out md:flex',
          rightRailCollapsed ? 'w-12 max-w-[3rem]' : balancedDesktopLayout ? 'w-full' : 'w-[clamp(280px,22vw,340px)]',
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
      )}
    </div>
  )
}
