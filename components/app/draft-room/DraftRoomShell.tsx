'use client'

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, LayoutGrid, MessageCircle, ListOrdered, User, Sparkles, Users, Shield, Radar, MoreHorizontal } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { cn } from '@/lib/utils'
import type { TraySnap } from '@/lib/draft-room/mobileTraySnap'
import { DraftMobileTray } from './DraftMobileTray'
import './draft-mobile.css'

const BOTTOM_DOCK_PREF_KEY = 'af:draft-premium-bottom-dock-expanded'

export type MobileDraftTab = 'board' | 'players' | 'queue' | 'intel' | 'helper' | 'roster' | 'keepers' | 'chat'

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
  /** "Before your next pick" lookahead. Omitted for auctions, which have no pick order. */
  intelPanel?: ReactNode
  rosterPanel?: ReactNode
  keeperPanel?: ReactNode
  mobileStickyBar?: ReactNode
  /** Floating control pinned above the mobile tab bars, so it never covers a tab. */
  mobileDockAccessory?: ReactNode
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
  intel: 'draftRoom.shell.mobile.intel',
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
  { id: 'intel' as const, icon: Radar },
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
  intelPanel,
  rosterPanel,
  keeperPanel,
  mobileStickyBar,
  mobileDockAccessory,
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
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false)
  useEffect(() => { setMobileToolsOpen(false) }, [mobileTab])
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)')
    const closeOnDesktop = () => { if (desktop.matches) setMobileToolsOpen(false) }
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])
  const selectMobileTab = (tab: MobileDraftTab) => {
    setMobileToolsOpen(false)
    onMobileTabChange(tab)
  }
  const allowPremiumDockCollapse = surfaceVariant !== 'redraft_snake'

  /*
   * Mobile tray — a Sleeper-style bottom sheet over an always-visible board. The sheet mechanics
   * live in `DraftMobileTray` (shared with the mock room); this shell keeps its tab bar and panels.
   *
   * ⚠ THE PARENT'S `mobileTab` STAYS THE SOURCE OF TRUTH, AND 'board' MEANS "TRAY COLLAPSED".
   * DraftRoomPageClient and the e2e suites drive the room through `mobileTab` (they click
   * `draft-mobile-tab-board` to see the board), so the tray maps onto that contract instead of
   * replacing it: choosing any other tab opens the tray, collapsing the tray reports 'board', and
   * dragging it back up reopens the tab that was showing.
   */
  const layoutRef = useRef<HTMLDivElement | null>(null)
  const [traySnap, setTraySnap] = useState<TraySnap>(mobileTab === 'board' ? 'peek' : 'half')
  const lastTrayTabRef = useRef<MobileDraftTab>(mobileTab === 'board' ? 'players' : mobileTab)
  useEffect(() => {
    if (mobileTab !== 'board') lastTrayTabRef.current = mobileTab
  }, [mobileTab])
  const collapseTray = useCallback(() => onMobileTabChange('board'), [onMobileTabChange])
  const expandTray = useCallback(() => onMobileTabChange(lastTrayTabRef.current), [onMobileTabChange])

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

  const visibleTabs = MOBILE_TABS.filter(
    (tab) =>
      (tab.id !== 'helper' || helperPanel) &&
      (tab.id !== 'intel' || intelPanel) &&
      (tab.id !== 'roster' || rosterPanel) &&
      (tab.id !== 'keepers' || keeperPanel)
  )
  const primaryMobileTabs = visibleTabs.filter((tab) => ['board', 'players', 'queue', 'chat'].includes(tab.id))
  const secondaryMobileTabs = visibleTabs.filter((tab) => !['board', 'players', 'queue', 'chat'].includes(tab.id))

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
    <div className={`draft-touch-room ${surfaceClass}`} style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }} data-testid="draft-room-shell">
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

      {/* Mobile — the board is always on screen; Players / Queue / Roster / Chat live in a
          draggable tray over it (peek → half → full), like Sleeper. */}
      <div
        ref={layoutRef}
        className="relative flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-hidden md:hidden"
        data-testid="draft-mobile-layout"
        data-tray-snap={traySnap}
      >
        {/*
          F.2 — mobile pane uses `overflow-y-auto` (NOT `overflow-auto`) so wide
          children like the snake draft board can't bleed horizontal scroll out to
          the whole page. The board wraps its own children in `overflow-x-auto`.
        */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain scroll-smooth" data-testid="draft-mobile-scroll-root">
          {mobileStickyBar && (
            <div className="sticky top-0 z-10 shrink-0 border-b border-white/10 bg-[#040915]/95 backdrop-blur-sm">
              {mobileStickyBar}
            </div>
          )}
          {auctionStrip && (
            <div className="shrink-0 border-b border-white/10 bg-[#050c1d]">{auctionStrip}</div>
          )}
          <div
            className="min-w-0 overflow-x-auto overscroll-x-contain scroll-smooth p-2 sm:p-3"
            data-testid="draft-mobile-board-scroll"
          >
            {draftBoard}
          </div>
        </div>

        <DraftMobileTray
          open={mobileTab !== 'board'}
          onRequestCollapse={collapseTray}
          onRequestExpand={expandTray}
          layoutRef={layoutRef}
          fullOnInputFocus={mobileTab === 'chat'}
          openSnap={mobileTab === 'players' ? 'full' : 'half'}
          testIdPrefix="draft-mobile"
          ariaLabel={t('draftRoom.shell.aria.draftSections')}
          accessory={mobileDockAccessory}
          onSnapChange={setTraySnap}
          chrome={
            <>
          {secondaryMobileTabs.length > 0 && mobileToolsOpen ? (
            <div
              id="draft-mobile-tools"
              onKeyDown={(event) => { if (event.key === 'Escape') { setMobileToolsOpen(false); event.currentTarget.parentElement?.querySelector<HTMLButtonElement>('[data-testid="draft-mobile-more"]')?.focus() } }}
              className="max-h-[35dvh] shrink-0 overflow-y-auto border-t border-white/10 bg-[#060d1f] px-2 py-2"
              data-testid="draft-mobile-quick-dock"
            >
              <div className="grid grid-cols-2 gap-2">
                {secondaryMobileTabs.map(({ id, icon: Icon }) => {
                  const label = t(MOBILE_TAB_I18N[id])
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => selectMobileTab(id)}
                      data-testid={`draft-mobile-tab-${id}`}
                      className={`inline-flex min-h-[44px] shrink-0 touch-manipulation items-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition active:scale-[0.98] ${
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
            className="safe-area-bottom flex shrink-0 border-t border-white/10 bg-[#070f21]/95"
            data-testid="draft-mobile-primary-nav"
            aria-label={t('draftRoom.shell.aria.draftSections')}
          >
            {primaryMobileTabs.map(({ id, icon: Icon }) => {
              const label = t(MOBILE_TAB_I18N[id])
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => selectMobileTab(id)}
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
            {secondaryMobileTabs.length > 0 && (
              <button type="button" data-testid="draft-mobile-more"
                onClick={() => setMobileToolsOpen(open => !open)}
                aria-expanded={mobileToolsOpen} aria-controls="draft-mobile-tools"
                aria-label={t('draftRoom.shell.mobile.more')}
                className={`flex min-h-[48px] min-w-0 flex-1 touch-manipulation flex-col items-center justify-center gap-0.5 py-2 text-[11px] ${mobileToolsOpen || secondaryMobileTabs.some(tab => tab.id === mobileTab) ? 'bg-cyan-500/12 text-cyan-100' : 'text-white/65'}`}>
                <MoreHorizontal className="h-5 w-5" aria-hidden />
                <span>{secondaryMobileTabs.some(tab => tab.id === mobileTab) ? t(MOBILE_TAB_I18N[mobileTab]) : t('draftRoom.shell.mobile.more')}</span>
              </button>
            )}
          </nav>
            </>
          }
        >
            <div
              key={mobileTab}
              className="h-full min-h-0 min-w-0 overflow-y-auto overscroll-contain px-2 pb-3 text-sm sm:px-3"
              data-testid="draft-mobile-content"
              data-active-tab={mobileTab}
            >
              {/*
                ⚠ THE PLAYERS SHEET MUST GIVE THE PANEL A DEFINITE HEIGHT. PlayerPanel pins its search
                and filters (`sticky`) and scrolls its own list (`draft-player-list-scroll`). Under an
                auto-height wrapper its `h-full` resolved to auto, so the panel grew to every row: the
                header scrolled away with the list, and a touch landing on the list's own
                `overscroll-contain` scroller (which had nothing to scroll) was swallowed instead of
                chaining up — reported on Android as "can't scroll the draft board". Every wrapper
                down to the panel is a full-height flex column so the LIST is the scroller.
              */}
              {mobileTab === 'players' && (
                <div className="flex h-full min-h-0 flex-col overflow-hidden" data-testid="draft-mobile-players-sheet">
                  <div
                    className="flex min-h-0 flex-1 flex-col min-w-0 overflow-x-auto overscroll-x-contain scroll-smooth"
                    data-testid="draft-mobile-players-scroll"
                  >
                    {playerPanel}
                  </div>
                </div>
              )}
              {mobileTab === 'queue' && queuePanel}
              {mobileTab === 'chat' && chatPanel}
              {intelPanel && mobileTab === 'intel' && intelPanel}
              {helperPanel && mobileTab === 'helper' && helperPanel}
              {rosterPanel && mobileTab === 'roster' && rosterPanel}
              {keeperPanel && mobileTab === 'keepers' && keeperPanel}
            </div>
        </DraftMobileTray>
      </div>
    </div>
  )
}
