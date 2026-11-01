'use client'

/**
 * The draft room's dock tabs below 1280px (Queue / Intel / Chat / AF Legacy / Commish Edit). At xl+
 * the room shows DraftRightDockTabs instead; this bar is what a tablet or small laptop gets.
 *
 * ⚠ ONE ROW, NEVER WRAPPED OR CLIPPED. This used to be an equal-width `grid-cols-5`, which at 768px —
 * the dock gets half of what the team aside leaves — gave each label ~55px, so the uppercase,
 * letter-spaced "COMMISH EDIT" and "AF LEGACY" overflowed their buttons. Each tab now keeps its label's
 * width (`whitespace-nowrap`, which flex's `min-width: auto` will not shrink below), still shares any
 * spare width (`flex-1`), and the row scrolls sideways when the tabs cannot all fit.
 */
export type CenterDockTab = 'queue' | 'intel' | 'chat' | 'ai' | 'commish'

export function DraftCenterDockTabBar({
  active,
  onSelect,
  showIntel,
  showCommish,
  redraftSnake,
}: {
  active: CenterDockTab
  onSelect: (tab: CenterDockTab) => void
  /** Intel is not offered in an auction. */
  showIntel: boolean
  showCommish: boolean
  /** The redraft snake room's cyan styling. */
  redraftSnake: boolean
}) {
  const tabs: Array<{ id: CenterDockTab; label: string }> = [
    { id: 'queue', label: 'Queue' },
    ...(showIntel ? [{ id: 'intel' as const, label: 'Intel' }] : []),
    { id: 'chat', label: 'Chat' },
    { id: 'ai', label: 'AF Legacy' },
    ...(showCommish ? [{ id: 'commish' as const, label: 'Commish Edit' }] : []),
  ]
  const activeClass = (id: CenterDockTab) =>
    id === 'commish'
      ? 'bg-white/12 text-amber-100'
      : id === 'ai' && redraftSnake
        ? 'bg-gradient-to-r from-violet-500/30 to-fuchsia-500/15 text-violet-50 shadow-[0_0_22px_rgba(167,139,250,0.2)]'
        : redraftSnake
          ? 'bg-gradient-to-r from-cyan-500/25 to-violet-500/15 text-cyan-50 shadow-[0_0_20px_rgba(34,211,238,0.15)]'
          : 'bg-white/12 text-cyan-100'

  return (
    <div
      role="tablist"
      data-testid="draft-bottom-dock-tabbar"
      className={`flex gap-1 overflow-x-auto overscroll-x-contain border-b px-2 py-1.5 [scrollbar-width:none] [-webkit-overflow-scrolling:touch] ${
        redraftSnake
          ? 'border-cyan-500/15 bg-[linear-gradient(180deg,rgba(15,23,42,0.95),rgba(5,12,24,0.98))] shadow-[inset_0_1px_0_rgba(34,211,238,0.08)]'
          : 'border-white/8 bg-[#0a1228]'
      }`}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={active === tab.id}
          onClick={() => onSelect(tab.id)}
          data-testid={`draft-bottom-tab-${tab.id}`}
          className={`min-h-[32px] flex-1 shrink-0 whitespace-nowrap rounded-md px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] transition-colors ${
            active === tab.id ? activeClass(tab.id) : 'text-white/55 hover:bg-white/5'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
