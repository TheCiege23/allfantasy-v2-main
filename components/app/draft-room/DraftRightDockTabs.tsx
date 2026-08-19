'use client'

/**
 * D.6.1 — Sleeper-style right-dock tabs.
 *
 * One shared body slot. Default tabs: QUEUE | ROSTER | CHAT.
 * Draft rooms can also expose WAR ROOM when a deterministic draft-intel body is passed.
 * Only the active tab fills the dock body. Inactive tab BODIES stay mounted
 * (display:none via CSS) so:
 *   - the Roster tab keeps updating in real-time when picks land while you're
 *     looking at Queue
 *   - the Chat scroll position survives a tab switch
 *   - QueuePanel reorders / autopick / draft button state stays correct
 *
 * Persists the active tab across reloads via localStorage so power-users land
 * on whichever tab they last used.
 *
 * Pure layout/UI — no draft-engine, timer-engine, or AI-ADP logic touched.
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'

export type DraftRightDockTab = 'queue' | 'roster' | 'war_room' | 'chat'

const TAB_PREF_KEY = 'af:draft-right-dock-active-tab'

export interface DraftRightDockTabsProps {
  queueBody: ReactNode
  rosterBody: ReactNode
  warRoomBody?: ReactNode
  chatBody: ReactNode
  /** Default tab when no preference stored. Spec calls for "Queue". */
  defaultTab?: DraftRightDockTab
  /** Override active tab from outside (e.g. tests / programmatic switch). */
  activeTabOverride?: DraftRightDockTab | null
  /** Optional badge counts surfaced on the tab labels (e.g. queue length). */
  queueCount?: number
  testIdBase?: string
}

const BASE_TABS: ReadonlyArray<{ id: DraftRightDockTab; label: string }> = [
  { id: 'queue', label: 'Queue' },
  { id: 'roster', label: 'Roster' },
  { id: 'war_room', label: 'AF Legacy' },
  { id: 'chat', label: 'Chat' },
]

export function DraftRightDockTabs({
  queueBody,
  rosterBody,
  warRoomBody = null,
  chatBody,
  defaultTab = 'queue',
  activeTabOverride = null,
  queueCount,
  testIdBase = 'draft-right-dock',
}: DraftRightDockTabsProps) {
  const [activeTab, setActiveTab] = useState<DraftRightDockTab>(defaultTab)

  // Restore preference on first paint.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(TAB_PREF_KEY)
      if (v === 'queue' || v === 'roster' || v === 'war_room' || v === 'chat') setActiveTab(v)
    } catch {
      /* ignore */
    }
  }, [])

  // Persist on change.
  useEffect(() => {
    try {
      window.localStorage.setItem(TAB_PREF_KEY, activeTab)
    } catch {
      /* ignore */
    }
  }, [activeTab])

  const tabs = warRoomBody ? BASE_TABS : BASE_TABS.filter((tab) => tab.id !== 'war_room')
  const rawEffectiveTab = activeTabOverride ?? activeTab
  const effectiveTab = !warRoomBody && rawEffectiveTab === 'war_room' ? defaultTab : rawEffectiveTab

  const onSelect = useCallback((id: DraftRightDockTab) => {
    setActiveTab(id)
  }, [])

  return (
    <section
      data-testid={testIdBase}
      data-active-tab={effectiveTab}
      aria-label="Draft right dock"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-l-xl border-l border-white/[0.06] bg-[linear-gradient(180deg,#0d1428_0%,#0b1324_100%)]"
    >
      {/* Tab header row. Active tab uses cyan-100 + bottom underline; inactives are muted. */}
      <div
        role="tablist"
        aria-label="Draft right dock tabs"
        data-testid={`${testIdBase}-tablist`}
        className={`grid shrink-0 ${warRoomBody ? 'grid-cols-4' : 'grid-cols-3'} border-b border-white/[0.05] bg-[#101a30]`}
      >
        {tabs.map((tab) => {
          const isActive = effectiveTab === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`${testIdBase}-panel-${tab.id}`}
              id={`${testIdBase}-tab-${tab.id}`}
              data-testid={`${testIdBase}-tab-${tab.id}`}
              onClick={() => onSelect(tab.id)}
              className={`relative flex items-center justify-center gap-1 py-1 text-[8px] font-semibold uppercase tracking-[0.14em] transition ${
                isActive
                  ? 'text-cyan-100'
                  : 'text-white/50 hover:bg-white/[0.04] hover:text-white/85'
              }`}
            >
              <span>{tab.label}</span>
              {tab.id === 'queue' && typeof queueCount === 'number' && queueCount > 0 ? (
                <span
                  className="inline-flex h-3.5 min-w-[14px] items-center justify-center rounded-full border border-cyan-300/35 bg-cyan-500/20 px-1 text-[8px] font-bold text-cyan-100"
                  aria-label={`${queueCount} queued`}
                  data-testid={`${testIdBase}-queue-count`}
                >
                  {queueCount}
                </span>
              ) : null}
              {isActive ? (
                <span
                  aria-hidden
                  className="absolute inset-x-3 bottom-0 h-px rounded-full bg-gradient-to-r from-cyan-400 to-violet-400 shadow-[0_0_10px_rgba(34,211,238,0.3)]"
                />
              ) : null}
            </button>
          )
        })}
      </div>

      {/* Body. All three are mounted; only the active one is visible.
          Hidden bodies use `hidden` (display:none) so React state survives
          tab switches and timers/queues continue to render correctly. */}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div
          role="tabpanel"
          id={`${testIdBase}-panel-queue`}
          aria-labelledby={`${testIdBase}-tab-queue`}
          data-testid={`${testIdBase}-panel-queue`}
          aria-hidden={effectiveTab !== 'queue'}
          className={effectiveTab === 'queue' ? 'flex h-full min-h-0 flex-col overflow-hidden' : 'hidden'}
        >
          {queueBody}
        </div>
        <div
          role="tabpanel"
          id={`${testIdBase}-panel-roster`}
          aria-labelledby={`${testIdBase}-tab-roster`}
          data-testid={`${testIdBase}-panel-roster`}
          aria-hidden={effectiveTab !== 'roster'}
          className={effectiveTab === 'roster' ? 'flex h-full min-h-0 flex-col overflow-hidden' : 'hidden'}
        >
          {rosterBody}
        </div>
        {warRoomBody ? (
          <div
            role="tabpanel"
            id={`${testIdBase}-panel-war_room`}
            aria-labelledby={`${testIdBase}-tab-war_room`}
            data-testid={`${testIdBase}-panel-war-room`}
            aria-hidden={effectiveTab !== 'war_room'}
            className={effectiveTab === 'war_room' ? 'flex h-full min-h-0 flex-col overflow-hidden' : 'hidden'}
          >
            {warRoomBody}
          </div>
        ) : null}
        <div
          role="tabpanel"
          id={`${testIdBase}-panel-chat`}
          aria-labelledby={`${testIdBase}-tab-chat`}
          data-testid={`${testIdBase}-panel-chat`}
          aria-hidden={effectiveTab !== 'chat'}
          className={effectiveTab === 'chat' ? 'flex h-full min-h-0 flex-col overflow-hidden' : 'hidden'}
        >
          {chatBody}
        </div>
      </div>
    </section>
  )
}
