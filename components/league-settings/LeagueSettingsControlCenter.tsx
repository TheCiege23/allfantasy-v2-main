'use client'

import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { SubPanelContext } from '@/app/league/[leagueId]/components/LeagueSettingsSubPanels'
import { GeneralTab } from './tabs/GeneralTab'
import { ScoringTab } from './tabs/ScoringTab'
import { RostersTab } from './tabs/RostersTab'
import { DraftTab } from './tabs/DraftTab'
import { WaiversTab } from './tabs/WaiversTab'
import { TradesTab } from './tabs/TradesTab'
import { PlayoffsTab } from './tabs/PlayoffsTab'
import { CommissionerTab } from './tabs/CommissionerTab'
import { ConceptRulesTab } from './tabs/ConceptRulesTab'
import { AISettingsTab } from './tabs/AISettingsTab'

export type LeagueSettingsHubTabId =
  | 'general'
  | 'scoring'
  | 'roster'
  | 'draft'
  | 'waivers'
  | 'trades'
  | 'playoffs'
  | 'members'
  | 'notifications'
  | 'permissions'
  | 'commissioner'
  | 'conceptRules'
  | 'ai'

const TABS: { id: LeagueSettingsHubTabId; label: string; short: string }[] = [
  { id: 'general', label: 'General', short: 'General' },
  { id: 'draft', label: 'Draft', short: 'Draft' },
  { id: 'roster', label: 'Roster', short: 'Roster' },
  { id: 'scoring', label: 'Scoring', short: 'Scoring' },
  { id: 'waivers', label: 'Waivers', short: 'Waivers' },
  { id: 'trades', label: 'Trades', short: 'Trades' },
  { id: 'playoffs', label: 'Playoffs', short: 'Playoffs' },
  { id: 'members', label: 'Members', short: 'Members' },
  { id: 'notifications', label: 'Notifications', short: 'Alerts' },
  { id: 'permissions', label: 'Permissions', short: 'Perms' },
  { id: 'commissioner', label: 'Commissioner Intelligence', short: 'Commish' },
  { id: 'conceptRules', label: 'Advanced Rule Support', short: 'Rules' },
  { id: 'ai', label: 'League Helper', short: 'Helper' },
]

function resolveInitialTab(panel: string | null | undefined): LeagueSettingsHubTabId {
  if (!panel) return 'general'
  const m: Record<string, LeagueSettingsHubTabId> = {
    'general-info': 'general',
    'commish-general': 'commissioner',
    'commish-controls': 'commissioner',
    'commish-note': 'commissioner',
    'members-commish': 'commissioner',
    'division-settings': 'commissioner',
    'league-dues': 'commissioner',
    'league-history': 'commissioner',
    scoring: 'scoring',
    roster: 'roster',
    draft: 'draft',
    playoffs: 'playoffs',
    'devy-command-center': 'conceptRules',
    'ai-chimmy-setup': 'ai',
  }
  return m[panel] ?? 'general'
}

export function LeagueSettingsControlCenter({
  ctx,
  initialPanelId,
}: {
  ctx: SubPanelContext
  initialPanelId?: string | null
}) {
  const [tab, setTab] = useState<LeagueSettingsHubTabId>(() => resolveInitialTab(initialPanelId))

  const canEdit = ctx.isCommissioner
  const hasAfCommissionerSub = ctx.hasAfCommissionerSub ?? false

  const tabProps = useMemo(
    () => ({
      ctx,
      canEdit,
      hasAfCommissionerSub,
    }),
    [ctx, canEdit, hasAfCommissionerSub],
  )

  const body = useMemo(() => {
    switch (tab) {
      case 'general':
        return <GeneralTab {...tabProps} />
      case 'scoring':
        return <ScoringTab {...tabProps} />
      case 'roster':
        return <RostersTab {...tabProps} />
      case 'draft':
        return <DraftTab {...tabProps} />
      case 'waivers':
        return <WaiversTab {...tabProps} />
      case 'trades':
        return <TradesTab {...tabProps} />
      case 'playoffs':
        return <PlayoffsTab {...tabProps} />
      case 'members':
        return <CommissionerTab {...tabProps} />
      case 'notifications':
        return (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-5 text-[13px] leading-relaxed text-white/65">
            <p className="mb-2 text-[14px] font-semibold text-white/85">Notifications</p>
            <p>Basic league notifications are available in account settings. Weekly League Report controls live under League Helper for AF Commissioner.</p>
          </div>
        )
      case 'permissions':
        return <CommissionerTab {...tabProps} />
      case 'commissioner':
        return <CommissionerTab {...tabProps} />
      case 'conceptRules':
        return <ConceptRulesTab {...tabProps} />
      case 'ai':
        return <AISettingsTab {...tabProps} />
      default:
        return null
    }
  }, [tab, tabProps])

  return (
    <div className="flex min-h-[380px] flex-1 flex-col gap-0 md:min-h-[520px] md:flex-row">
      {/* Mobile tabs */}
      <div className="scrollbar-none flex gap-1 overflow-x-auto border-b border-white/[0.06] pb-2 md:hidden">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            data-testid={`league-settings-hub-tab-${t.id}`}
            className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition ${
              tab === t.id ? 'bg-cyan-500/15 text-cyan-200' : 'text-white/45 hover:text-white/75'
            }`}
          >
            {t.short}
          </button>
        ))}
      </div>

      {/* Desktop sidebar */}
      <nav
        className="hidden w-[200px] shrink-0 flex-col gap-0.5 border-r border-white/[0.06] pr-3 pt-1 md:flex"
        aria-label="League settings sections"
      >
        {TABS.map((t) => {
          const active = tab === t.id
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              data-testid={`league-settings-hub-tab-${t.id}`}
              className={`rounded-lg px-2 py-2 text-left text-[12px] font-medium transition ${
                active ? 'bg-white/[0.08] text-cyan-200 shadow-[0_0_0_1px_rgba(34,211,238,0.12)]' : 'text-white/60 hover:bg-white/[0.04] hover:text-white'
              }`}
            >
              {t.label}
            </button>
          )
        })}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 py-2 md:px-5 md:py-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.18 }}
            className="pb-8"
          >
            {body}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}
