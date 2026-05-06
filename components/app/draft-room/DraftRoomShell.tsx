'use client'

import { type ReactNode, useCallback, useEffect, useState } from 'react'
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

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(BOTTOM_DOCK_PREF_KEY)
      if (v === '0') setBottomDockExpanded(false)
    } catch {
      /* ignore */
    }
  }, [])

  const persistBottomDock = useCallback((expanded: boolean) => {
    setBottomDockExpanded(expanded)
    try {
      window.localStorage.setItem(BOTTOM_DOCK_PREF_KEY, expanded ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [])

  const visibleTabs = MOBILE_TABS.filter(
    (tab) =>
      (tab.id !== 'helper' || helperPanel) &&
      (tab.id !== 'roster' || rosterPanel) &&
      (tab.id !== 'keepers' || keeperPanel)
  )
  const primaryMobileTabs = visibleTabs.filter((tab) => tab.id === 'board' || tab.id === 'players' || tab.id === 'chat')
  const secondaryMobileTabs = visibleTabs.filter((tab) => tab.id !== 'board' && tab.id !== 'players' && tab.id !== 'chat')

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
      ? 'flex h-full min-h-[100dvh] flex-col bg-gradient-to-b from-[#0d1530] via-[#0b1224] to-[#070b18] text-white shadow-[inset_0_1px_0_rgba(125,211,252,0.06)]'
      : 'flex h-full min-h-[100dvh] flex-col bg-[#0b1020] text-white'

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
              'min-h-[240px] overflow-auto overscroll-contain [overflow-anchor:none] border-b',
              bottomDockExpanded ? 'flex-1 basis-0' : 'flex-1',
              surfaceVariant === 'redraft_snake'
                ? 'border-cyan-500/15 bg-[linear-gradient(180deg,rgba(8,18,36,0.98),rgba(4,9,17,0.99))] shadow-[inset_0_-1px_0_rgba(34,211,238,0.06)]'
                : 'border-white/8 bg-[#050c1d]',
            )}
            data-testid="draft-premium-board-zone"
            data-dock-expanded={bottomDockExpanded ? 'true' : 'false'}
          >
            {draftBoard}
          </div>
          {/* D.6.2 — collapse arrow toggle between the board and the dock.
              Two stacked chevrons that flip direction based on state. Click → toggle. */}
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
          <div
            className={cn(
              'flex min-h-[240px] overflow-hidden',
              bottomDockExpanded ? 'flex-1 basis-0' : 'hidden',
            )}
            data-testid="draft-premium-main-zones"
            data-dock-expanded={bottomDockExpanded ? 'true' : 'false'}
          >
            {teamPanel ? (
              <aside
                data-testid="draft-premium-team-aside"
                className={`w-[min(280px,22vw)] shrink-0 overflow-y-auto border-r bg-[#050c1d] ${
                  surfaceVariant === 'redraft_snake' ? 'border-cyan-500/10 shadow-[inset_-1px_0_0_rgba(34,211,238,0.05)]' : 'border-white/8'
                }`}
              >
                {teamPanel}
              </aside>
            ) : null}
            <div
              className={`flex min-w-0 flex-1 flex-col overflow-hidden border-r bg-[#060d1e] ${
                surfaceVariant === 'redraft_snake' ? 'border-cyan-500/10' : 'border-white/8'
              }`}
            >
              {centerMain}
            </div>
          </div>
          {bottomBar ? (
            <div className="relative shrink-0 border-t border-white/10 bg-[#040915]" data-testid="draft-premium-bottom-dock-wrap">
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
                    bottomDockExpanded ? 'h-[min(220px,30vh)] min-h-[140px]' : 'h-0 min-h-0',
                  )}
                >
                  {bottomBar}
                </div>
              </div>
              {!bottomDockExpanded ? (
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
          <div className="min-h-[200px] flex-[2] overflow-auto overscroll-contain [overflow-anchor:none] border-b border-white/8 bg-[#050c1d]">
            {draftBoard}
          </div>
          <div className="flex min-h-0 flex-1 overflow-hidden border-b border-white/8">
            <div className="min-w-0 flex-[3] overflow-hidden border-r border-white/8">{playerPanel}</div>
            <div className="min-w-0 flex-[2] overflow-hidden">{queuePanel}</div>
          </div>
          <div className="min-h-0 w-full min-h-[min(28vh,360px)] flex-[1.5] overflow-hidden border-t border-white/8">
            {chatPanel}
          </div>
        </div>
      )}

      {/* Mobile */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:hidden" data-testid="draft-mobile-layout">
        {/*
          F.2 — mobile pane uses `overflow-y-auto` (NOT `overflow-auto`) so wide
          children like the Sleeper player table and the snake draft board can't
          bleed horizontal scroll out to the whole page. Each individual wide
          panel wraps its own children in `overflow-x-auto` containers below.
        */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
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
            className="min-h-[220px] min-w-0 p-3 pb-16 text-sm transition-opacity duration-150 sm:p-3.5 sm:pb-16"
            data-testid="draft-mobile-content"
            data-active-tab={mobileTab}
          >
            {/* F.2 — Board and Players are the only tabs whose internal content
                exceeds typical mobile widths (snake grid + 18-column table).
                Wrapping them in their own `overflow-x-auto min-w-0` container
                keeps the horizontal scroll INSIDE the tab pane. */}
            {mobileTab === 'board' && (
              <div
                className="min-w-0 overflow-x-auto overscroll-x-contain"
                data-testid="draft-mobile-board-scroll"
              >
                {draftBoard}
              </div>
            )}
            {mobileTab === 'players' && (
              <div
                className="min-w-0 overflow-x-auto overscroll-x-contain"
                data-testid="draft-mobile-players-scroll"
              >
                {playerPanel}
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
          <div className="safe-area-bottom border-t border-white/10 bg-[#060d1f]/95 px-2 py-1.5">
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
              {secondaryMobileTabs.map(({ id, icon: Icon }) => {
                const label = t(MOBILE_TAB_I18N[id])
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => onMobileTabChange(id)}
                    data-testid={`draft-mobile-tab-${id}`}
                    className={`inline-flex min-h-[36px] shrink-0 touch-manipulation items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-medium transition active:scale-[0.98] ${
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
