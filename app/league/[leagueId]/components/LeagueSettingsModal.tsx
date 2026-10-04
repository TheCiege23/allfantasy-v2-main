'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowLeft,
  ArrowLeftRight,
  BarChart2,
  Bell,
  BookOpen,
  Bot,
  ClipboardList,
  FileText,
  Grid,
  History,
  Mail,
  MessageCircle,
  MessageSquare,
  Newspaper,
  PiggyBank,
  Palette,
  Settings,
  Shield,
  Shuffle,
  Sparkles,
  Link2,
  Star,
  Swords,
  TrendingUp,
  Trophy,
  User,
  UserPlus,
  Users,
  X,
  Zap,
} from 'lucide-react'
import type { LeagueTeam } from '@prisma/client'
import type { UserLeague } from '@/app/dashboard/types'
import type { LeagueShellLeague, SleeperMemberMap } from '../LeagueShell'
import {
  SettingsSubPanelBody,
  type SubPanelContext,
} from './LeagueSettingsSubPanels'
import { CommissionerLeagueSettingsShell } from './CommissionerLeagueSettingsShell'
import { SubscriptionGateProvider } from '@/hooks/useSubscriptionGate'
import LanguageToggle from '@/components/i18n/LanguageToggle'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { ThemeModeSelect } from '@/components/theme/ThemeModeSelect'
import { isNativePlatform } from '@/lib/dashboard/platform-label'
import {
  initialsFromName,
  leagueAvatarSrc,
  readStoredTab,
  writeStoredTab,
  type SettingsTabKey,
} from './league-settings-modal-utils'

/**
 * Titles and descriptions are dictionary KEYS (lib/i18n/translations.ts + translations-es-parity.ts),
 * resolved with t() at render — this frame is the first thing every league's settings show, and it
 * used to be English-only. __tests__/league-settings-modal-frame-i18n reads every `lsModal.` key
 * named in this file and requires it in both languages.
 */
type CardDef = {
  id: string
  titleKey: string
  descKey: string
  icon: LucideIcon
  ai?: boolean
}

const GENERAL_CARDS: CardDef[] = [
  { id: 'discord-sync', titleKey: 'lsModal.card.discordSync', descKey: 'lsModal.card.discordSyncDesc', icon: Link2 },
  { id: 'my-team', titleKey: 'lsModal.card.myTeam', descKey: 'lsModal.card.myTeamDesc', icon: User },
  { id: 'general-info', titleKey: 'lsModal.card.general', descKey: 'lsModal.card.generalDesc', icon: Settings },
  { id: 'draft', titleKey: 'lsModal.card.draft', descKey: 'lsModal.card.draftDesc', icon: ClipboardList },
  { id: 'playoffs', titleKey: 'lsModal.card.playoffs', descKey: 'lsModal.card.playoffsDesc', icon: Trophy },
  { id: 'roster', titleKey: 'lsModal.card.roster', descKey: 'lsModal.card.rosterDesc', icon: Users },
  { id: 'scoring', titleKey: 'lsModal.card.scoring', descKey: 'lsModal.card.scoringDesc', icon: BarChart2 },
  { id: 'notifications', titleKey: 'lsModal.card.notifications', descKey: 'lsModal.card.notificationsDesc', icon: Bell },
  { id: 'invite', titleKey: 'lsModal.card.invite', descKey: 'lsModal.card.inviteDesc', icon: Mail },
  { id: 'co-owners', titleKey: 'lsModal.card.coOwners', descKey: 'lsModal.card.coOwnersDesc', icon: UserPlus },
  { id: 'draft-results', titleKey: 'lsModal.card.draftResults', descKey: 'lsModal.card.draftResultsDesc', icon: Grid },
  { id: 'league-history', titleKey: 'lsModal.card.leagueHistory', descKey: 'lsModal.card.leagueHistoryDesc', icon: BookOpen },
  { id: 'audit-log', titleKey: 'lsModal.card.auditLog', descKey: 'lsModal.card.auditLogDesc', icon: History },
]

const COMMISH_CARDS: CardDef[] = [
  { id: 'commish-general', titleKey: 'lsModal.card.commishGeneral', descKey: 'lsModal.card.commishGeneralDesc', icon: Star },
  { id: 'division-settings', titleKey: 'lsModal.card.divisionSettings', descKey: 'lsModal.card.divisionSettingsDesc', icon: Zap },
  { id: 'members-commish', titleKey: 'lsModal.card.members', descKey: 'lsModal.card.membersDesc', icon: MessageSquare },
  { id: 'commish-note', titleKey: 'lsModal.card.commishNote', descKey: 'lsModal.card.commishNoteDesc', icon: FileText },
  { id: 'commish-controls', titleKey: 'lsModal.card.commishControls', descKey: 'lsModal.card.commishControlsDesc', icon: Shield },
  { id: 'league-dues', titleKey: 'lsModal.card.leagueDues', descKey: 'lsModal.card.leagueDuesDesc', icon: PiggyBank },
  { id: 'draft-results-commish', titleKey: 'lsModal.card.draftResults', descKey: 'lsModal.card.draftResultsCommishDesc', icon: Grid },
  { id: 'league-history-commish', titleKey: 'lsModal.card.leagueHistory', descKey: 'lsModal.card.leagueHistoryCommishDesc', icon: BookOpen },
]

const AI_CARDS: CardDef[] = [
  { id: 'ai-chimmy-setup', titleKey: 'lsModal.card.aiChimmySetup', descKey: 'lsModal.card.aiChimmySetupDesc', icon: Bot, ai: true },
  { id: 'ai-power-rankings', titleKey: 'lsModal.card.aiPowerRankings', descKey: 'lsModal.card.aiPowerRankingsDesc', icon: TrendingUp, ai: true },
  { id: 'ai-trade', titleKey: 'lsModal.card.aiTrade', descKey: 'lsModal.card.aiTradeDesc', icon: ArrowLeftRight, ai: true },
  { id: 'ai-waiver', titleKey: 'lsModal.card.aiWaiver', descKey: 'lsModal.card.aiWaiverDesc', icon: Shuffle, ai: true },
  { id: 'ai-recap', titleKey: 'lsModal.card.aiRecap', descKey: 'lsModal.card.aiRecapDesc', icon: Newspaper, ai: true },
  { id: 'ai-draft-help', titleKey: 'lsModal.card.aiDraftHelp', descKey: 'lsModal.card.aiDraftHelpDesc', icon: ClipboardList, ai: true },
  { id: 'ai-matchup', titleKey: 'lsModal.card.aiMatchup', descKey: 'lsModal.card.aiMatchupDesc', icon: Swords, ai: true },
  { id: 'ai-trash', titleKey: 'lsModal.card.aiTrash', descKey: 'lsModal.card.aiTrashDesc', icon: MessageCircle, ai: true },
]

/** Shown when this league has `IdpLeagueConfig` (same detection as league shell). */
const IDP_CARDS: CardDef[] = [
  { id: 'idp_roster', titleKey: 'lsModal.card.idpRoster', descKey: 'lsModal.card.idpRosterDesc', icon: Shield },
  { id: 'idp_scoring', titleKey: 'lsModal.card.idpScoring', descKey: 'lsModal.card.idpScoringDesc', icon: BarChart2 },
  { id: 'idp_display', titleKey: 'lsModal.card.idpDisplay', descKey: 'lsModal.card.idpDisplayDesc', icon: Palette },
  { id: 'idp_ai', titleKey: 'lsModal.card.idpAi', descKey: 'lsModal.card.idpAiDesc', icon: Bot, ai: true },
]

const PANEL_TITLE_KEYS: Record<string, string> = Object.fromEntries(
  [...GENERAL_CARDS, ...COMMISH_CARDS, ...AI_CARDS, ...IDP_CARDS].map((c) => [c.id, c.titleKey]),
)

/** League status as the summary prints it (lower case — the cell capitalizes). Unknown → raw, spaced. */
const STATUS_KEYS: Record<string, string> = {
  pre_draft: 'lsModal.status.preDraft',
  drafting: 'lsModal.status.drafting',
  in_season: 'lsModal.status.inSeason',
  post_season: 'lsModal.status.postSeason',
  complete: 'lsModal.status.complete',
}

export type LeagueSettingsModalProps = {
  open: boolean
  onClose: () => void
  league: LeagueShellLeague
  displayLeague: UserLeague
  userId: string
  userTeam: LeagueTeam | null
  sleeperLeagueId: string | null
  /** Commissioner or co-commissioner — COMMISH tab */
  isCommissioner: boolean
  /** Head commissioner — Sleeper-only commish affordances in subpanels */
  isHeadCommissioner: boolean
  sleeperMemberMap: SleeperMemberMap
  onGoToDraftTab: () => void
  /** When set on open, opens this sub-panel immediately (e.g. member gear menu → Edit Team). */
  initialActivePanel?: string | null
}

/**
 * Imported leagues (Sleeper/Yahoo/ESPN/…) are READ-ONLY mirrors — nothing here
 * can change how the league runs, so the full commissioner control-center tree
 * is noise. This centered summary shows how the league runs, from the imported
 * snapshot only, plus a deep link to the host platform for actual changes.
 */
function ImportedLeagueSummary({
  league,
  displayLeague,
  platform,
  sleeperLeagueId,
}: {
  league: LeagueShellLeague
  displayLeague: UserLeague
  platform: string
  sleeperLeagueId: string | null
}) {
  const { t } = useLanguage()
  const settings = (league.settings && typeof league.settings === 'object' && !Array.isArray(league.settings)
    ? (league.settings as Record<string, unknown>)
    : {}) as Record<string, unknown>
  const rosterPositions = Array.isArray(settings.roster_positions)
    ? (settings.roster_positions as unknown[]).filter((p): p is string => typeof p === 'string')
    : []
  const innerSettings = (settings.settings && typeof settings.settings === 'object' && !Array.isArray(settings.settings)
    ? (settings.settings as Record<string, unknown>)
    : {}) as Record<string, unknown>
  const waiverType = typeof innerSettings.waiver_type === 'number'
    ? (innerSettings.waiver_type === 2
        ? 'FAAB'
        : innerSettings.waiver_type === 1
          ? t('lsModal.imported.waiverRolling')
          : t('lsModal.imported.waiverReverse'))
    : null
  const playoffTeams = typeof innerSettings.playoff_teams === 'number' ? innerSettings.playoff_teams : null
  const platformLabel = platform.charAt(0).toUpperCase() + platform.slice(1)
  const hostSettingsHref = sleeperLeagueId ? `https://sleeper.com/leagues/${sleeperLeagueId}/settings` : null

  const rawStatus = String(displayLeague.status ?? league.status ?? '—')
  const rows: Array<[string, string]> = [
    [t('lsModal.imported.platform'), platformLabel],
    [t('lsModal.imported.season'), String(displayLeague.season ?? '—')],
    [t('lsModal.imported.teams'), String(displayLeague.teamCount ?? league.leagueSize ?? '—')],
    // Format values (Redraft / Dynasty / Keeper / Best Ball) are the product's own terms, kept as-is
    // in Spanish too — the es dictionary already says "Dynasty".
    [t('lsModal.imported.format'), String(displayLeague.format ?? (league.isDynasty ? 'Dynasty' : 'Redraft'))],
    [t('lsModal.imported.scoring'), String(displayLeague.scoring ?? league.scoring ?? '—')],
    [t('lsModal.imported.status'), STATUS_KEYS[rawStatus] ? t(STATUS_KEYS[rawStatus]) : rawStatus.replace(/_/g, ' ')],
  ]
  if (waiverType) rows.push([t('lsModal.imported.waivers'), waiverType])
  if (playoffTeams) rows.push([t('lsModal.imported.playoffTeams'), String(playoffTeams)])

  return (
    <div className="mx-auto max-w-md space-y-4 py-2" data-testid="imported-league-settings-summary">
      <div className="rounded-xl border border-[#262c6a] bg-[#12163e]/70 p-4">
        <p className="text-[11px] font-black uppercase italic tracking-wide text-[#ff8a3d]">{t('lsModal.imported.howItRuns')}</p>
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
          {rows.map(([label, value]) => (
            <div key={label}>
              <p className="text-[11px] font-bold uppercase tracking-wide text-white/35">{label}</p>
              <p className="mt-0.5 text-[13px] font-semibold capitalize text-white/90">{value}</p>
            </div>
          ))}
        </div>
        {rosterPositions.length > 0 ? (
          <div className="mt-4">
            <p className="text-[11px] font-bold uppercase tracking-wide text-white/35">{t('lsModal.imported.rosterConstruction')}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-white/70">{rosterPositions.join(', ')}</p>
          </div>
        ) : null}
      </div>
      <div className="rounded-xl border border-[#262c6a] bg-white/[0.03] p-4">
        <p className="text-[12px] leading-relaxed text-white/55">
          {t('lsModal.imported.readOnly').split('{{platform}}').join(platformLabel)}
        </p>
        {hostSettingsHref ? (
          <a
            href={hostSettingsHref}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12px] font-extrabold text-white"
            style={{ background: 'linear-gradient(90deg,#ff3d81,#ff8a3d)' }}
          >
            {t('lsModal.imported.editOn').replace('{{platform}}', platformLabel)}
          </a>
        ) : null}
      </div>
    </div>
  )
}

export function LeagueSettingsModal(props: LeagueSettingsModalProps) {
  const {
    open,
    onClose,
    league,
    displayLeague,
    userId,
    userTeam,
    sleeperLeagueId,
    isCommissioner,
    isHeadCommissioner,
    sleeperMemberMap,
    onGoToDraftTab,
    initialActivePanel = null,
  } = props

  const { t } = useLanguage()
  const [mainTab, setMainTab] = useState<SettingsTabKey>('general')
  const [activePanel, setActivePanel] = useState<string | null>(null)
  // Imported (non-native) leagues get the read-only summary in GENERAL —
  // there is nothing to edit here, the host platform owns the rules.
  //
  // 🛑 `isNativePlatform` is the ONE rule for what counts as native. This was a
  // hand-copied list that omitted `manual` — which is exactly what
  // `createCanonicalLeagueInTransaction` persists for every natively created
  // league — so native leagues were classified as imported and shown the
  // read-only panel, telling the commissioner to go edit the league "on
  // Manual". `platform-label.ts` warns against this second copy by name.
  const importedPlatform = useMemo(() => {
    const p = String(league.platform ?? '').trim().toLowerCase()
    // Blank stays native, matching the prior behaviour of the `p &&` guard.
    if (!p) return null
    return isNativePlatform(p) ? null : p
  }, [league.platform])
  const [isMd, setIsMd] = useState(false)
  const [idpLeague, setIdpLeague] = useState(false)
  /** Avoid treating `!idpLeague` as definitive until `/idp/config` has responded (prevents flashing off IDP tab). */
  const [idpConfigLoaded, setIdpConfigLoaded] = useState(false)
  const [hasAfCommissionerSub, setHasAfCommissionerSub] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const fn = () => setIsMd(mq.matches)
    fn()
    mq.addEventListener('change', fn)
    return () => mq.removeEventListener('change', fn)
  }, [])

  useEffect(() => {
    if (!open) return
    if (initialActivePanel) {
      setMainTab('general')
      // Deep-link into the commissioner control center without also opening
      // the legacy card sub-panel overlay.
      if (initialActivePanel === 'devy-command-center' || (isCommissioner && initialActivePanel === 'draft')) {
        setActivePanel(null)
      } else {
        setActivePanel(initialActivePanel)
      }
      return
    }
    const stored = readStoredTab(league.id, isCommissioner)
    setMainTab(stored)
    if (isCommissioner && stored === 'general') {
      setActivePanel(null)
    } else {
      setActivePanel(null)
    }
  }, [open, league.id, isCommissioner, initialActivePanel])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setIdpConfigLoaded(false)
    fetch(`/api/leagues/${encodeURIComponent(league.id)}/idp/config`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { config?: unknown } | null) => {
        if (!cancelled) setIdpLeague(Boolean(d?.config))
      })
      .catch(() => {
        if (!cancelled) setIdpLeague(false)
      })
      .finally(() => {
        if (!cancelled) setIdpConfigLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [open, league.id])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch(`/api/league/settings?leagueId=${encodeURIComponent(league.id)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { hasAfCommissionerSub?: boolean } | null) => {
        if (!cancelled) setHasAfCommissionerSub(Boolean(d?.hasAfCommissionerSub))
      })
      .catch(() => {
        if (!cancelled) setHasAfCommissionerSub(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, league.id])

  useEffect(() => {
    if (!open) return
    if (mainTab === 'idp' && idpConfigLoaded && !idpLeague) {
      setMainTab('general')
    }
  }, [open, mainTab, idpLeague, idpConfigLoaded])

  useEffect(() => {
    if (!open) return
    writeStoredTab(league.id, mainTab)
  }, [open, league.id, mainTab])

  const subCtx: SubPanelContext = useMemo(
    () => ({
      league,
      displayLeague,
      userId,
      userTeam,
      sleeperLeagueId,
      platformLeagueId: league.platformLeagueId,
      isCommissioner,
      isHeadCommissioner,
      sleeperMemberMap,
      onGoToDraftTab,
      hasAfCommissionerSub,
    }),
    [
      league,
      displayLeague,
      userId,
      userTeam,
      sleeperLeagueId,
      isCommissioner,
      isHeadCommissioner,
      sleeperMemberMap,
      onGoToDraftTab,
      hasAfCommissionerSub,
    ],
  )

  const cards = useMemo(() => {
    if (mainTab === 'user') return []
    if (mainTab === 'general') return GENERAL_CARDS
    if (mainTab === 'commish') return COMMISH_CARDS
    if (mainTab === 'idp') return IDP_CARDS
    return AI_CARDS
  }, [mainTab])

  const leagueAvatar = leagueAvatarSrc(displayLeague.avatarUrl ?? league.avatarUrl)
  const panelTitle = activePanel ? t(PANEL_TITLE_KEYS[activePanel] ?? 'lsModal.settingsFallback') : ''

  const handleCloseAll = useCallback(() => {
    setActivePanel(null)
    onClose()
  }, [onClose])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      handleCloseAll()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, handleCloseAll])

  useEffect(() => {
    if (!open) setActivePanel(null)
  }, [open])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  const modalVariants = isMd
    ? {
        initial: { opacity: 0, scale: 0.96, y: 12 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.96, y: 12 },
      }
    : {
        initial: { opacity: 0, y: '100%' },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: '100%' },
      }

  const content = (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="league-settings-layer"
          className="fixed inset-0 z-50"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.button
            type="button"
            aria-label={t('lsModal.closeSettings')}
            className="absolute inset-0 bg-black/75 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleCloseAll}
          />

          <div className="pointer-events-none fixed inset-0 z-50 flex items-end justify-center p-0 md:items-center md:p-4">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="league-settings-modal-title"
              className={`pointer-events-auto flex max-h-[100dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/[0.08] bg-[#0d1117] shadow-2xl md:max-h-[min(92vh,900px)] md:rounded-2xl ${
                isCommissioner && mainTab === 'general' && !importedPlatform ? 'max-w-4xl' : 'max-w-2xl'
              }`}
              initial={modalVariants.initial}
              animate={modalVariants.animate}
              exit={modalVariants.exit}
              transition={{ type: 'tween', duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
              onClick={(e) => e.stopPropagation()}
            >
              <header className="flex-shrink-0 border-b border-white/[0.08] px-4 pb-3 pt-3">
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={handleCloseAll}
                    className="-ml-1 rounded-xl p-2 text-white/55 transition hover:bg-white/[0.08] hover:text-white"
                    aria-label={t('lsModal.close')}
                  >
                    <X className="h-6 w-6" />
                  </button>
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full border border-white/15 bg-white/10">
                      {leagueAvatar ? (
                        <img src={leagueAvatar} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-[13px] font-bold text-white/75">
                          {initialsFromName(displayLeague.name)}
                        </span>
                      )}
                    </div>
                    <div className="min-w-0">
                      <h1 id="league-settings-modal-title" className="truncate text-lg font-bold text-white md:text-xl">
                        {displayLeague.name}
                      </h1>
                      <p className="text-[13px] text-white/45">{t('lsModal.leagueSettings')}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setMainTab('user')}
                    className={`flex items-center gap-1.5 rounded-full border px-4 py-2 text-[11px] font-bold tracking-wide transition ${
                      mainTab === 'user'
                        ? 'border-[#ff3d81]/45 bg-white/[0.12] text-white shadow-[0_0_0_1px_rgba(255,61,129,0.12)]'
                        : 'border-transparent bg-white/[0.04] text-white/40 hover:bg-white/[0.07] hover:text-white/65'
                    }`}
                    data-testid="league-settings-tab-user"
                    aria-label={t('lsModal.userSettings')}
                  >
                    <User
                      className={`h-3.5 w-3.5 ${mainTab === 'user' ? 'text-[#ff9ec0]' : 'text-white/35'}`}
                      strokeWidth={2}
                      aria-hidden
                    />
                    {t('lsModal.tabUser')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMainTab('general')}
                    className={`rounded-full border px-4 py-2 text-[11px] font-bold tracking-wide transition ${
                      mainTab === 'general'
                        ? 'border-[#ff3d81]/45 bg-white/[0.12] text-white shadow-[0_0_0_1px_rgba(255,61,129,0.12)]'
                        : 'border-transparent bg-white/[0.04] text-white/40 hover:bg-white/[0.07] hover:text-white/65'
                    }`}
                  >
                    {t('lsModal.tabGeneral')}
                  </button>
                  {idpLeague ? (
                    <button
                      type="button"
                      onClick={() => setMainTab('idp')}
                      className={`rounded-full border px-4 py-2 text-[11px] font-bold tracking-wide transition ${
                        mainTab === 'idp'
                          ? 'border-red-500/35 bg-red-950/35 text-red-100 shadow-[0_0_0_1px_rgba(248,113,113,0.15)]'
                          : 'border-transparent bg-white/[0.04] text-white/40 hover:bg-white/[0.07] hover:text-white/65'
                      }`}
                      data-testid="league-settings-tab-idp"
                    >
                      IDP
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setMainTab('ai')}
                    className={`flex items-center gap-1 rounded-full border px-4 py-2 text-[11px] font-bold tracking-wide transition ${
                      mainTab === 'ai'
                        ? 'border-violet-500/45 bg-gradient-to-r from-violet-600/25 to-fuchsia-600/20 text-white shadow-[0_0_0_1px_rgba(139,92,246,0.2)]'
                        : 'border-transparent bg-white/[0.04] text-white/40 hover:bg-white/[0.07] hover:text-white/65'
                    }`}
                  >
                    <Sparkles className="h-3.5 w-3.5 text-violet-300" />
                    {t('lsModal.tabAi')}
                  </button>
                </div>
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8 pt-4 [scrollbar-gutter:stable]">
                {mainTab === 'user' ? (
                  <div className="mx-auto max-w-md space-y-6 py-1">
                    <div>
                      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/40">{t('lsModal.language')}</p>
                      <LanguageToggle />
                    </div>
                    <div>
                      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/40">{t('lsModal.theme')}</p>
                      <ThemeModeSelect size="md" className="inline-flex w-full flex-wrap items-center gap-2 text-xs" />
                    </div>
                    <p className="text-[12px] leading-relaxed text-white/45">
                      {t('lsModal.homeHint')}
                    </p>
                  </div>
                ) : mainTab === 'general' && importedPlatform ? (
                  // Imported leagues: read-only "how it runs" summary instead of
                  // the full editable settings tree (no changes possible here).
                  <ImportedLeagueSummary
                    league={league}
                    displayLeague={displayLeague}
                    platform={importedPlatform}
                    sleeperLeagueId={sleeperLeagueId}
                  />
                ) : isCommissioner && mainTab === 'general' ? (
                  <CommissionerLeagueSettingsShell
                    key={`${league.id}-${initialActivePanel ?? 'hub'}`}
                    ctx={subCtx}
                    initialPanelId={initialActivePanel}
                  />
                ) : (
                  <div className="mx-auto grid grid-cols-2 gap-3">
                    {cards.map((card) => {
                      const Icon = card.icon
                      const ai = card.ai
                      return (
                        <button
                          key={card.id}
                          type="button"
                          onClick={() => setActivePanel(card.id)}
                          className={`rounded-xl border p-3 text-left transition ${
                            ai
                              ? 'border-violet-500/25 bg-gradient-to-br from-violet-950/80 via-[#1a1f3a] to-fuchsia-950/50 hover:border-violet-400/35'
                              : 'border-white/[0.08] bg-[#1a1f3a] hover:border-[#ff3d81]/25 hover:bg-[#1f2544]'
                          }`}
                        >
                          <div
                            className={`mb-2 flex h-9 w-9 items-center justify-center rounded-lg ${
                              ai ? 'bg-white/[0.08] text-violet-200' : 'bg-white/[0.06] text-[#ff3d81]/95'
                            }`}
                          >
                            <Icon className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden />
                          </div>
                          <h3 className="text-[13px] font-bold leading-snug text-white">{t(card.titleKey)}</h3>
                          <p className="mt-1 text-[11px] leading-relaxed text-white/40">{t(card.descKey)}</p>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </motion.div>
          </div>

          <AnimatePresence>
            {activePanel ? (
              <>
                <motion.button
                  type="button"
                  aria-label={t('lsModal.closeSubPanel')}
                  className="fixed inset-0 z-[60] bg-black/50 md:bg-black/40"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  onClick={() => setActivePanel(null)}
                />
                <motion.aside
                  className="fixed inset-y-0 right-0 z-[70] flex w-full max-w-md flex-col border-l border-white/[0.1] bg-[#0d1117] shadow-2xl"
                  initial={{ x: '100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '100%' }}
                  transition={{ type: 'tween', duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
                >
                  <div className="flex items-center gap-2 border-b border-white/[0.08] px-3 py-3">
                    <button
                      type="button"
                      onClick={() => setActivePanel(null)}
                      className="rounded-lg p-2 text-white/70 hover:bg-white/[0.06] hover:text-white"
                      aria-label={t('lsModal.back')}
                    >
                      <ArrowLeft className="h-5 w-5" />
                    </button>
                    <h2 className="min-w-0 flex-1 truncate text-[15px] font-bold text-white">{panelTitle}</h2>
                  <button
                    type="button"
                    onClick={handleCloseAll}
                      className="rounded-lg p-2 text-white/45 hover:bg-white/[0.06] hover:text-white/80"
                      aria-label={t('lsModal.closeSettings')}
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 [scrollbar-gutter:stable]">
                    <SettingsSubPanelBody panelId={activePanel} ctx={subCtx} />
                  </div>
                </motion.aside>
              </>
            ) : null}
          </AnimatePresence>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )

  return <SubscriptionGateProvider>{content}</SubscriptionGateProvider>
}
