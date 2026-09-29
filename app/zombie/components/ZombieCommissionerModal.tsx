'use client'

import { useState, useEffect } from 'react'
import clsx from 'clsx'
import { RotateCcw } from 'lucide-react'
import { ZombieUpdatesPanel } from './commissioner/ZombieUpdatesPanel'
import { ZombieAutomationPanel } from './commissioner/ZombieAutomationPanel'
import { ZombieAuditLogPanel } from './commissioner/ZombieAuditLogPanel'
import { ZombieOverridePanel } from './commissioner/ZombieOverridePanel'
import { ZombieSetupPanel } from './commissioner/ZombieSetupPanel'
import { ZombieWhispererPanel } from './commissioner/ZombieWhispererPanel'
import { ZombieCombatPanel } from './commissioner/ZombieCombatPanel'
import { ZombieItemsPanel } from './commissioner/ZombieItemsPanel'
import { ZombiePaidPanel } from './commissioner/ZombiePaidPanel'
import { ZombieUniversePanel } from './commissioner/ZombieUniversePanel'
import { ZombieAnimationsPanel } from './commissioner/ZombieAnimationsPanel'
import { ZombieAdvancedPanel } from './commissioner/ZombieAdvancedPanel'
import { ZombieIntroModal } from '@/components/zombie/ZombieIntroModal'
import { getZombieTheme } from '@/lib/zombie/zombieBackgroundThemes'

type Tab =
  | 'general'
  | 'paid'
  | 'universe'
  | 'whisperer'
  | 'combat'
  | 'items'
  | 'updates'
  | 'automation'
  | 'overrides'
  | 'audit'
  | 'animations'
  | 'advanced'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'general', label: 'General', icon: '🏟️' },
  { id: 'paid', label: 'Free / Paid', icon: '💰' },
  { id: 'universe', label: 'Universe', icon: '🌍' },
  { id: 'whisperer', label: 'Whisperer', icon: '🎭' },
  { id: 'combat', label: 'Combat', icon: '⚔️' },
  { id: 'items', label: 'Items', icon: '🎒' },
  { id: 'updates', label: 'Updates', icon: '📝' },
  { id: 'automation', label: 'Automation', icon: '⚙️' },
  { id: 'overrides', label: 'Overrides', icon: '🔧' },
  { id: 'audit', label: 'Audit', icon: '📋' },
  { id: 'animations', label: 'Visuals', icon: '🎬' },
  { id: 'advanced', label: 'Advanced', icon: '🧬' },
]

export function ZombieCommissionerModal({
  open,
  onClose,
  leagueId,
}: {
  open: boolean
  onClose: () => void
  leagueId: string
}) {
  const [tab, setTab] = useState<Tab>('general')
  const [backgroundTheme, setBackgroundTheme] = useState<string | null>(null)
  const [showIntroReplay, setShowIntroReplay] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const fetchData = async () => {
      try {
        const res = await fetch(`/api/zombie/league?leagueId=${encodeURIComponent(leagueId)}`, {
          credentials: 'include',
        })
        if (!res.ok) return
        const data = await res.json()
        setBackgroundTheme(data.league?.backgroundTheme)
        
        // Get current user ID for intro modal
        const sessionRes = await fetch('/api/auth/session', { credentials: 'include' })
        if (sessionRes.ok) {
          const session = await sessionRes.json()
          setUserId(session?.user?.id ?? null)
        }
      } catch {}
    }
    void fetchData()
  }, [open, leagueId])

  if (!open) return null
  const theme = getZombieTheme(backgroundTheme)

  return (
    <>
      <ZombieIntroModal
        leagueId={leagueId}
        userId={userId ?? ''}
        leagueName="Zombie League"
        backgroundTheme={backgroundTheme}
        enabled={showIntroReplay}
        forceReplay
        onClose={() => setShowIntroReplay(false)}
      />
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 backdrop-blur-sm"
        style={{
          backgroundColor: theme ? 'rgba(0, 0, 0, 0.95)' : 'rgba(0, 0, 0, 0.5)',
          backgroundImage: theme
            ? `linear-gradient(135deg, ${theme.gradientClass})`
            : undefined,
        }}
        onClick={onClose}
        role="dialog"
        aria-label="Commissioner Settings"
      >
        <div
        className="flex h-[90vh] max-h-[700px] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[var(--zombie-border)] bg-[var(--zombie-bg)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--zombie-border)] bg-[var(--zombie-panel)] px-5 py-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--zombie-crimson)]">
              Commissioner Settings
            </p>
            <p className="text-[13px] font-semibold text-[var(--zombie-text-full)]">
              Zombie League Configuration
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--zombie-text-dim)] transition hover:bg-white/[0.06] hover:text-white"
            aria-label="Close"
          >
            ✕
          </button>
                  <button
                    type="button"
                    onClick={() => setShowIntroReplay(true)}
                    className="ml-2 flex items-center gap-1.5 h-8 px-2 rounded-lg text-[12px] font-medium text-amber-200 bg-amber-900/20 hover:bg-amber-900/40 transition border border-amber-700/20"
                    title="Replay intro video"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Replay Intro</span>
                  </button>
        </div>

        {/* Body: sidebar + content */}
        <div className="flex min-h-0 flex-1">
          {/* Tab sidebar (desktop) / horizontal scroll (mobile) */}
          <nav className="hidden w-[180px] shrink-0 overflow-y-auto border-r border-[var(--zombie-border)] bg-[var(--zombie-panel)] py-2 md:block">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={clsx(
                  'flex w-full items-center gap-2 px-4 py-2 text-[12px] text-left transition-colors',
                  tab === t.id
                    ? 'bg-[var(--zombie-crimson)]/10 text-[var(--zombie-crimson)] font-semibold'
                    : 'text-[var(--zombie-text-dim)] hover:bg-white/[0.03] hover:text-[var(--zombie-text-mid)]',
                )}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </nav>

          {/* Mobile tab scroller */}
          <div className="flex overflow-x-auto border-b border-[var(--zombie-border)] bg-[var(--zombie-panel)] p-1 md:hidden">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={clsx(
                  'flex shrink-0 items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] whitespace-nowrap transition',
                  tab === t.id
                    ? 'bg-[var(--zombie-crimson)]/15 text-[var(--zombie-crimson)] font-semibold'
                    : 'text-[var(--zombie-text-dim)]',
                )}
              >
                <span>{t.icon}</span>
                <span className="hidden xs:inline">{t.label}</span>
              </button>
            ))}
          </div>

          {/* Content area */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === 'general' && <ZombieSetupPanel leagueId={leagueId} canEdit />}
            {tab === 'paid' && <ZombiePaidPanel leagueId={leagueId} canEdit />}
            {tab === 'universe' && <ZombieUniversePanel canEdit />}
            {tab === 'whisperer' && <ZombieWhispererPanel canEdit />}
            {tab === 'combat' && <ZombieCombatPanel canEdit />}
            {tab === 'items' && <ZombieItemsPanel canEdit />}
            {tab === 'updates' && <ZombieUpdatesPanel leagueId={leagueId} canEdit />}
            {tab === 'automation' && <ZombieAutomationPanel leagueId={leagueId} canEdit />}
            {tab === 'overrides' && <ZombieOverridePanel leagueId={leagueId} canEdit />}
            {tab === 'audit' && <ZombieAuditLogPanel leagueId={leagueId} canEdit />}
            {tab === 'animations' && <ZombieAnimationsPanel leagueId={leagueId} canEdit />}
            {tab === 'advanced' && <ZombieAdvancedPanel leagueId={leagueId} canEdit />}
          </div>
        </div>
      </div>
      </div>
    </>
  )
}
