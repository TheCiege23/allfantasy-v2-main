'use client'

import { useState } from 'react'
import { Settings, ShieldCheck, Sparkles } from 'lucide-react'
import { AppModal } from '@/components/ui/AppModal'

export type SettingsTabId = 'league' | 'commissioner' | 'format'

interface LeagueSettingsShellProps {
  open: boolean
  onClose: () => void
  isCommissioner: boolean
  isCoCommissioner: boolean
  formatLabel: string
  formatTabContent: React.ReactNode
  leagueTabContent: React.ReactNode
  commissionerTabContent: React.ReactNode
  hasAfCommissionerSub: boolean
}

const TAB_META: Record<SettingsTabId, { label: string; icon: typeof Settings; description: string }> = {
  league: { label: 'League', icon: Settings, description: 'Basic league info and rules' },
  commissioner: { label: 'Commissioner', icon: ShieldCheck, description: 'Commissioner tools and controls' },
  format: { label: '', icon: Sparkles, description: 'Format-specific settings' },
}

/**
 * 3-tab settings shell for all league types.
 *
 * Tab 1 — League: Basic league settings. All members see read-only.
 *          Commissioner/co-commissioner can edit.
 * Tab 2 — Commissioner: Schedule changes, co-commissioners, playoffs,
 *          roster locks, matchup edits. Commissioner-only.
 * Tab 3 — Format-Specific: Survivor settings, Zombie settings, etc.
 *          Commissioner-only. Name changes per league type.
 */
export function LeagueSettingsShell({
  open,
  onClose,
  isCommissioner,
  isCoCommissioner,
  formatLabel,
  formatTabContent,
  leagueTabContent,
  commissionerTabContent,
  hasAfCommissionerSub,
}: LeagueSettingsShellProps) {
  const [tab, setTab] = useState<SettingsTabId>('league')
  const canEdit = isCommissioner || isCoCommissioner

  const tabs: { id: SettingsTabId; label: string; icon: typeof Settings; visible: boolean }[] = [
    { id: 'league', label: 'League', icon: Settings, visible: true },
    { id: 'commissioner', label: 'Commissioner', icon: ShieldCheck, visible: canEdit },
    { id: 'format', label: formatLabel, icon: Sparkles, visible: canEdit },
  ]

  return (
    <AppModal open={open} onClose={onClose} title="League Settings" size="lg" bodyClassName="px-0 py-0" data-testid="league-settings-modal">
      {/* Sticky tab bar inside the scroll container — stays visible while content scrolls. */}
      <div className="sticky top-0 z-10 flex border-b border-white/10 bg-[#0a1628]">
        {tabs.filter((t) => t.visible).map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition border-b-2 ${
                tab === t.id
                  ? 'border-cyan-400 text-[var(--badge-text-cyan)] bg-cyan-400/5'
                  : 'border-transparent text-white/50 hover:text-white/70'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          )
        })}
      </div>

      <div className="px-5 py-4">
        {tab === 'league' && (
          <div>
            {!canEdit && (
              <div className="mb-4 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-2.5 text-xs text-white/40">
                You are viewing league settings in read-only mode. Only commissioners can make changes.
              </div>
            )}
            {leagueTabContent}
          </div>
        )}

        {tab === 'commissioner' && canEdit && commissionerTabContent}

        {tab === 'format' && canEdit && (
          <div>
            {!hasAfCommissionerSub && (
              <div className="mb-4 rounded-lg border border-amber-400/20 bg-amber-400/5 px-4 py-2.5 text-xs text-amber-200/80">
                Some advanced features require an AF Commissioner Subscription. Locked features are marked with a lock icon.
              </div>
            )}
            {formatTabContent}
          </div>
        )}
      </div>
    </AppModal>
  )
}
