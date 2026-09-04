'use client'

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, LayoutGrid, MessageCircle, ListOrdered, User, Sparkles, Users, Shield } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { cn } from '@/lib/utils'

const BOTTOM_DOCK_PREF_KEY = 'af:draft-premium-bottom-dock-expanded'

export type MobileDraftTab = 'board' | 'players' | 'queue' | 'helper' | 'roster' | 'keepers' | 'chat'

export type DraftRoomShellProps = {
  /** Premium ambient gradient for `/draft/[id]/snake` redraft room. */
  surfaceVariant?: 'default' | 'redraft_snake'
  topBar: ReactNode
  managerStrip: ReactNode
  auctionStrip?: ReactNode
  draftBoard: ReactNode
  playerPanel: ReactNode
  queuePanel: ReactNode
  chatPanel: ReactNode
  helperPanel?: ReactNode
  rosterPanel?: ReactNode
  keeperPanel?: ReactNode
  mobileStickyBar?: ReactNode
  mobileTab: MobileDraftTab
  onMobileTabChange: (tab: MobileDraftTab) => void
  /**
   * Premium layout: top board, left team, center column (often pool + auxiliary tabs).
   * Optional bottom dock when `bottomBar` is provided.
   */
  layout?: 'classic' | 'premium'
  /** Left column — your team / AI badges (desktop premium) */
  teamPanel?: ReactNode
  /** Center column — usually player pool + queue stacked */
  centerColumn?: ReactNode
  /** Bottom dock — optional secondary strip below the main zones (desktop premium). */
  bottomBar?: ReactNode
}

const MOBILE_TAB_I18N: Record<MobileDraftTab, string> = {
  board: 'draftRoom.shell.mobile.board',
  players: 'draftRoom.shell.mobile.players',
  queue: 'draftRoom.shell.mobile.queue',
  helper: 'draftRoom.shell.mobile.ai',
  roster: 'draftRoom.shell.mobile.roster',
  keepers: 'draftRoom.shell.mobile.keepers',
  chat: 'draftRoom.shell.mobile.chat',
}

const MOBILE_TABS = [
  { id: 'board' as const, icon: LayoutGrid },
  { id: 'players' as const, icon: User },
  { id: 'chat' as const, icon: MessageCircle },
  { id: 'queue' as const, icon: ListOrdered },
  { id: 'helper' as const, icon: Sparkles },
  { id: 'roster' as const, icon: Users },
  { id: 'keepers' as const, icon: Shield },
]

export function DraftRoomShell({
  surfaceVariant = 'default',
  topBar,
  managerStrip,
  draftBoard,
  playerPanel,
  queuePanel,
  chatPanel,
  helperPanel,
  rosterPanel,
  keeperPanel,
  mobileStickyBar,
  auctionStrip,
  mobileTab,
  onMobileTabChange,
  layout = 'classic',
  teamPanel,
  centerColumn,
  bottomBar,
}: DraftRoomShellProps) {
  const { t } = useLanguage()
  const [bottomDockExpanded, setBottomDockExpanded] = useState(true)
  const allowPremiumDockCollapse = surfaceVariant !== 'redraft_snake'

  useEffect(() => {
    if (!allowPremiumDockCollapse) {
      setBottomDockExpanded(true)
      return
    }
    try {
      const v = window.localStorage.getItem(BOTTOM_DOCK_PREF_KEY)
      if (v === '0') setBottomDockExpanded(false)
    } catch {
      /* ignore */
    }
  }, [allowPremiumDockCollapse])

  const persistBottomDock = useCallback((expanded: boolean) => {
    const nextExpanded = allowPremiumDockCollapse ? expanded : true
    setBottomDockExpanded(nextExpanded)
    if (!allowPremiumDockCollapse) return
    try {
      window.localStorage.setItem(BOTTOM_DOCK_PREF_KEY, nextExpanded ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [allowPremiumDockCollapse])

  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null
    touchStartY.current = e.touches[0]?.clientY ?? null
  }, [])

  const handleTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartX.current === null || touchStartY.current === null) return
      const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current
      const dy = (e.changedTouches[0]?.clientY ?? 0) - touchStartY.current
      touchStartX.current = null
      touchStartY.current = null
      if (Math.abs(dx) < 50 || Math.abs(dx) <= Math.abs(dy) * 2) return
      const tabs = MOBILE_TABS.filter(
        (tab) =>
          (tab.id !== 'helper' || helperPanel) &&
          (tab.id !== 'roster' || rosterPanel) &&
          (tab.id !== 'keepers' || keeperPanel)
      )
      const idx = tabs.findIndex((t) => t.id === mobileTab)
      if (idx === -1) return
      const nextIdx = dx < 0 ? Math.min(idx + 1, tabs.length - 1) : Math.max(idx - 1, 0)
      if (nextIdx !== idx) onMobileTabChange(tabs[nextIdx]!.id)
    },
    [helperPanel, rosterPanel, keeperPanel, mobileTab, onMobileTabChange]
  )

  const visibleTabs = MOBILE_TABS.filter(
    (tab) =>
      (tab.id !== 'helper' || helperPanel) &&
      (tab.id !== 'roster' || rosterPanel) &&
      (tab.id !== 'keepers' || keeperPanel)
  )
  const primaryMobileTabs = visibleTabs.filter((tab) => tab.id === 'board' || tab.id === 'players')
  const secondaryMobileTabs = visibleTabs.filter((tab) => tab.id !== 'board' && tab.id !== 'players')

  /**
   * D.6 — when `layout='premium'` is set, we render the premium grid even if
   * `teamPanel` is null. The previous behavior required `teamPanel` to be
   * truthy, which was fine while the War Room lived in the left aside; D.6
   * moves the War Room into a floating popup, so the left aside collapses
   * and the centerColumn takes the full width.
   */
  const premiumDesktop = layout === 'premium' && Boolean(centerColumn)
  const centerMain = centerColumn ?? (
    <>
      <div className="min-h-0 flex-[3] overflow-hidden">{playerPanel}</div>
      <div className="min-h-[200px] flex-[2] overflow-auto border-t border-white/8 md:min-h-[220px]">{queuePanel}</div>
    </>
  )

  const surfaceClass =
    surfaceVariant === 'redraft_snake'
      ? 'flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-gradient-to-b from-[#0d1530] via-[#0b1224] to-[#070b18] text-white shadow-[inset_0_1px_0_rgba(125,211,252,0.06)]'
      : 'flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[#0b1020] text-white'

  return (
    <div className={surfaceClass} data-testid="draft-room-shell">
      {topBar}
      {managerStrip}

      {/* Desktop — premium 4-zone + bottom dock */}
      {premiumDesktop ? (
        <>
          {/*
            Both desktop layout branches use the same `draft-desktop-layout`
            testid so e2e tests (draft-room, auction, c2c, devy, cpu-ai-drafter,
            draft-asset-pipeline, draft-import) can scope `.getByTestId('draft-board')`
            inside it regardless of which variant the parent picks. The premium
            variant is picked when layout="premium" plus teamPanel and centerColumn
            are provided — otherwise we fall through to the legacy 2-row layout below.
          */}
          <div className="hidden min-h-0 flex-1 flex-col overflow-hidden md:flex" data-testid="draft-desktop-layout">
          {auctionStrip && (
            <div className="shrink-0 border-b border-white/8 bg-[#060d1f]">{auctionStrip}</div>
          )}
          {/* D.6.2 — board zone grows when the bottom dock is collapsed.
              Expanded:  ~52vh cap so dock has ~48vh; matches Sleeper proportions.
              Collapsed: flex-1 — board fills the entire screen below the top bar. */}
          <div
            className={cn(
              /*
               * ⚠ `min-h-[160px]` AND NOT `shrink-0`. The board used to refuse to shrink
               * while capped at 60vh, and the bottom dock is shrink-0 too — so in this
               * fixed-height column the player pool was the only flexible item and
               * absorbed the entire deficit. Measured at 1280x720 in the auction layout:
               * the pool's scroll container was 20px tall and its first row rendered at
               * y=871, below a 720px viewport, so `document.elementFromPoint` at that
               * row's centre returned null. The pool was unusable, not merely awkward.
               * The board now yields space down to a floor instead of starving it.
               */
              'min-h-[160px] overflow-auto overscroll-contain [overflow-anchor:none] border-b',
              bottomDockExpanded ? 'max-h-[min(60vh,720px)]' : 'min-h-0 max-h-[unset] flex-1',
              surfaceVariant === 'redraft_snake'
                ? 'border-cyan-500/15 bg-[linear-gradient(180deg,rgba(10,22,44,0.98),rgba(6,12,22,0.99))] shadow-[inset_0_-1px_0_rgba(34,211,238,0.06)]'
                : 'border-white/[0.06] bg-[#0d1428]',
            )}
            data-testid="draft-premium-board-zone"
            data-dock-expanded={bottomDockExpanded ? 'true' : 'false'}
          >
            {draftBoard}
          </div>
          {/* D.6.2 — collapse arrow toggle between the board and the dock.
              Two stacked chevrons that flip direction based on state. Click → toggle. */}
          {allowPremiumDockCollapse ? (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => persistBottomDock(!bottomDockExpanded)}
                data-testid="draft-dock-collapse-toggle"
                data-expanded={bottomDockExpanded ? 'true' : 'false'}
                aria-expanded={bottomDockExpanded}
                aria-label={bottomDockExpanded ? 'Collapse bottom dock' : 'Expand bottom dock'}
                title={bottomDockExpanded ? 'Collapse bottom dock' : 'Expand bottom dock'}
                className="absolute left-1/2 top-0 z-20 inline-flex h-8 w-12 -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center rounded-full border border-white/15 bg-[#0a1228] text-white/85 shadow-[0_8px_22px_rgba(0,0,0,0.45)] transition hover:border-cyan-400/35 hover:text-cyan-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40"
              >
                <ChevronUp className={cn('h-3 w-3', bottomDockExpanded ? 'opacity-90' : 'opacity-30')} />
                <ChevronDown className={cn('h-3 w-3 -mt-0.5', bottomDockExpanded ? 'opacity-30' : 'opacity-90')} />
              </button>
            </div>
          ) : null}
          <div
            className={cn(
              /*
               * `min-h-[300px]` gives the pool a floor. `min-h-0` explicitly PERMITTED the
               * collapse measured above — it is the standard flexbox escape hatch, and
               * here it was the thing letting a sibling squeeze this to 20px.
               */
              'flex min-h-[300px] overflow-hidden',
              bottomDockExpanded ? 'flex-1' : 'hidden',
            )}
            data-testid="draft-premium-main-zones"
            data-dock-expanded={bottomDockExpanded ? 'true' : 'false'}
          >
            {teamPanel ? (
              <aside
                data-testid="draft-premium-team-aside"
                className={`w-[min(280px,22vw)] shrink-0 overflow-y-auto border-r bg-[#0d1428] ${
                  surfaceVariant === 'redraft_snake' ? 'border-cyan-500/10 shadow-[inset_-1px_0_0_rgba(34,211,238,0.05)]' : 'border-white/8'
                }`}
              >
                {teamPanel}
              </aside>
            ) : null}
            <div
              className={`flex min-w-0 flex-1 flex-col overflow-hidden border-r bg-[#0f1a32] ${
                surfaceVariant === 'redraft_snake' ? 'border-cyan-500/10' : 'border-white/8'
              }`}
            >
              {centerMain}
            </div>
          </div>
          {bottomBar ? (
            <div
              /*
               * ⚠ SHRINKABLE, WITH A FLOOR — BUT ONLY WHILE EXPANDED. This was `shrink-0`
               * at up to 30vh, so on a short screen it kept its full height and the
               * deficit fell entirely on the player pool, which is the primary surface
               * and the one measured collapsed to 20px. A secondary dock should yield
               * before the pool does.
               *
               * The floor MUST NOT apply when collapsed. The inner dock animates to
               * `max-h-0`, so an unconditional `min-h` would hold 120px of empty space
               * open and quietly defeat the collapse control this wrapper is built
               * around — trading one layout bug for another.
               */
              className={cn(
                'relative border-t border-white/10 bg-[#040915]',
                bottomDockExpanded ? 'min-h-[120px]' : 'shrink-0',
              )}
              data-testid="draft-premium-bottom-dock-wrap"
            >
              {allowPremiumDockCollapse ? (
                <div className="pointer-events-none absolute left-1/2 top-0 z-20 -translate-x-1/2 -translate-y-1/2">
                  <button
                    type="button"
                    onClick={() => persistBottomDock(!bottomDockExpanded)}
                    className="pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/15 bg-[#0a1228] text-white/80 shadow-lg shadow-black/40 transition hover:bg-white/10 hover:text-white"
                    aria-expanded={bottomDockExpanded}
                    aria-controls="draft-premium-bottom-dock"
                    data-testid="draft-bottom-dock-toggle"
                    title={bottomDockExpanded ? t('draftRoom.shell.hideBottomDock') : t('draftRoom.shell.showBottomDock')}
                  >
                    {bottomDockExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                  </button>
                </div>
              ) : null}
              <div
                id="draft-premium-bottom-dock"
                className={cn(
                  'flex w-full overflow-hidden transition-[max-height] duration-200 ease-out',
                  bottomDockExpanded ? 'max-h-[min(220px,30vh)]' : 'max-h-0',
                )}
                data-testid="draft-premium-bottom-dock"
              >
                <div
                  className={cn(
                    'flex w-full min-h-0 overflow-hidden',
                  bottomDockExpanded ? 'h-[min(220px,30vh)] min-h-[150px]' : 'h-0 min-h-0',
                  )}
                >
                  {bottomBar}
                </div>
              </div>
              {allowPremiumDockCollapse && !bottomDockExpanded ? (
                <button
                  type="button"
                  onClick={() => persistBottomDock(true)}
                  className="flex w-full items-center justify-center gap-2 border-t border-white/8 bg-[#050c1d] py-2 text-[11px] font-medium text-cyan-100/90 hover:bg-white/5"
                  data-testid="draft-bottom-dock-restore"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                  {t('draftRoom.shell.restoreBottomDock')}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        </>
      ) : (
        <div className="hidden min-h-0 flex-1 flex-col overflow-hidden md:flex" data-testid="draft-desktop-layout">
          {auctionStrip && <div className="shrink-0 border-b border-white/8 bg-[#060d1f]">{auctionStrip}</div>}
          <div className="min-h-[180px] flex-[2] overflow-auto overscroll-contain [overflow-anchor:none] border-b border-white/8 bg-[#050c1d]">
            {draftBoard}
          </div>
          <div className="flex min-h-0 flex-1 overflow-hidden border-b border-white/8">
            <div className="min-w-0 flex-[3] overflow-hidden border-r border-white/8">{playerPanel}</div>
            <div className="min-w-0 flex-[2] overflow-hidden">{queuePanel}</div>
          </div>
          <div className="min-h-0 w-full min-h-[min(22vh,280px)] flex-[1.2] overflow-hidden border-t border-white/8">
            {chatPanel}
          </div>
        </div>
      )}

      {/* Mobile */}
      <div
        className="flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-hidden md:hidden"
        data-testid="draft-mobile-layout"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {/*
          F.2 — mobile pane uses `overflow-y-auto` (NOT `overflow-auto`) so wide
          children like the Sleeper player table and the snake draft board can't
          bleed horizontal scroll out to the whole page. Each individual wide
          panel wraps its own children in `overflow-x-auto` containers below.
        */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth" data-testid="draft-mobile-scroll-root">
          {mobileStickyBar && (
            <div className="sticky top-0 z-10 shrink-0 border-b border-white/10 bg-[#040915]/95 backdrop-blur-sm">
              {mobileStickyBar}
            </div>
          )}
          {auctionStrip && mobileTab === 'board' && (
            <div className="shrink-0 border-b border-white/10 bg-[#050c1d]">{auctionStrip}</div>
          )}
          <div
            key={mobileTab}
            className="min-h-[220px] min-w-0 p-2.5 pb-12 text-sm transition-opacity duration-150 sm:p-3 sm:pb-14"
            data-testid="draft-mobile-content"
            data-active-tab={mobileTab}
          >
            {/* F.2 — Board and Players are the only tabs whose internal content
                exceeds typical mobile widths (snake grid + 18-column table).
                Wrapping them in their own `overflow-x-auto min-w-0` container
                keeps the horizontal scroll INSIDE the tab pane. */}
            {mobileTab === 'board' && (
              <div
                className="min-w-0 overflow-x-auto overscroll-x-contain scroll-smooth"
                data-testid="draft-mobile-board-scroll"
              >
                {draftBoard}
              </div>
            )}
            {mobileTab === 'players' && (
              <div
                className="overflow-hidden rounded-t-2xl border border-white/12 bg-[linear-gradient(180deg,rgba(9,17,34,0.96),rgba(7,12,24,0.98))] shadow-[0_-10px_30px_rgba(0,0,0,0.35)]"
                data-testid="draft-mobile-players-sheet"
              >
                <div className="flex justify-center py-2" aria-hidden>
                  <span className="h-1 w-10 rounded-full bg-white/25" />
                </div>
                <div
                  className="min-w-0 overflow-x-auto overscroll-x-contain scroll-smooth"
                  data-testid="draft-mobile-players-scroll"
                >
                  {playerPanel}
                </div>
              </div>
            )}
            {mobileTab === 'queue' && queuePanel}
            {mobileTab === 'chat' && chatPanel}
            {helperPanel && mobileTab === 'helper' && helperPanel}
            {rosterPanel && mobileTab === 'roster' && rosterPanel}
            {keeperPanel && mobileTab === 'keepers' && keeperPanel}
          </div>
        </div>
        {secondaryMobileTabs.length > 0 ? (
          <div
            className="safe-area-bottom border-t border-white/10 bg-[#060d1f]/95 px-2 pb-1 pt-1"
            data-testid="draft-mobile-quick-dock"
          >
            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {secondaryMobileTabs.map(({ id, icon: Icon }) => {
                const label = t(MOBILE_TAB_I18N[id])
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onMobileTabChange(id)}
                    data-testid={`draft-mobile-tab-${id}`}
                    className={`inline-flex min-h-[38px] shrink-0 touch-manipulation items-center gap-1.5 rounded-full border px-3 text-[10px] font-medium transition active:scale-[0.98] ${
                      mobileTab === id
                        ? 'border-cyan-400/45 bg-cyan-500/15 text-cyan-100'
                        : 'border-white/15 bg-black/20 text-white/70'
                    }`}
                    aria-pressed={mobileTab === id}
                    aria-label={label}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span>{label}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}
        <nav
          className="safe-area-bottom flex shrink-0 border-t border-cyan-400/20 bg-[#070f21]/95"
          data-testid="draft-mobile-primary-nav"
          aria-label={t('draftRoom.shell.aria.draftSections')}
        >
          {primaryMobileTabs.map(({ id, icon: Icon }) => {
            const label = t(MOBILE_TAB_I18N[id])
            return (
              <button
                key={id}
                type="button"
                onClick={() => onMobileTabChange(id)}
                data-testid={`draft-mobile-tab-${id}`}
                className={`flex min-h-[48px] flex-1 touch-manipulation flex-col items-center justify-center gap-0.5 py-2 text-[11px] active:scale-[0.98] ${
                  mobileTab === id
                    ? 'bg-cyan-500/12 text-cyan-100 shadow-[inset_0_1px_0_rgba(34,211,238,0.2)]'
                    : 'text-white/65 hover:text-white/85'
                }`}
                aria-pressed={mobileTab === id}
                aria-label={label}
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden />
                <span>{label}</span>
              </button>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
