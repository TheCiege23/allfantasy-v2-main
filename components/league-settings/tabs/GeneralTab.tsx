'use client'

import { useEffect, useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { LeagueRulesSummarySection } from '@/app/league/[leagueId]/components/LeagueRulesSummarySection'
import LeagueTypeConfirm from '@/components/league/LeagueTypeConfirm'
import { useLeagueSettingsSectionAutosave } from '@/hooks/useLeagueSettingsSectionAutosave'
import type { LeagueSettingsTabProps } from '../league-settings-tabs-types'
import { HubCard, HubChoices, HubToggle, rangeChoices } from './hubFields'
import { WaiversTab } from './WaiversTab'
import { TradesTab } from './TradesTab'

const TZ_PRESETS = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'Europe/London',
]

/** The team counts commishes pick from; the league's own count is kept even when it is off-list. */
const TEAM_COUNTS = [4, 6, 8, 10, 12, 14, 16, 18, 20]

/** Core-rule switches, all plain `League` columns patched through the `general` section. */
const CORE_TOGGLES = [
  { key: 'medianGame', labelKey: 'lsHub.gen.median', hintKey: 'lsHub.gen.medianHint' },
  { key: 'allowPreDraftMoves', labelKey: 'lsHub.gen.preDraftMoves', hintKey: null },
  { key: 'preventBenchDrops', labelKey: 'lsHub.gen.benchDrops', hintKey: null },
  { key: 'lockAllMoves', labelKey: 'lsHub.gen.lockMoves', hintKey: 'lsHub.gen.lockMovesHint' },
  { key: 'overrideInviteCapacity', labelKey: 'lsHub.gen.inviteCapacity', hintKey: 'lsHub.gen.inviteCapacityHint' },
  { key: 'disableInviteLinks', labelKey: 'lsHub.gen.disableInvites', hintKey: null },
] as const
type CoreToggleKey = (typeof CORE_TOGGLES)[number]['key']

/**
 * League tab: identity, format, team count and core rules, with waivers and trades as sections of
 * the same screen (they used to be two more tabs). Everything autosaves through the sectioned
 * settings PATCH, so the server's commish/co-commish check and lifecycle locks apply.
 */
export function GeneralTab(props: LeagueSettingsTabProps) {
  const { ctx, canEdit } = props
  const { t } = useLanguage()
  const leagueId = ctx.league.id
  const { queuePatch, saving } = useLeagueSettingsSectionAutosave(leagueId, 'general', {
    enabled: canEdit,
  })

  const [name, setName] = useState(ctx.league.name ?? '')
  const [timezone, setTimezone] = useState(ctx.league.timezone ?? 'America/New_York')
  const [logoUrl, setLogoUrl] = useState(ctx.league.logoUrl ?? '')
  const [leagueSize, setLeagueSize] = useState<number>(ctx.league.leagueSize ?? ctx.league.teams?.length ?? 12)
  const [dispersalRounds, setDispersalRounds] = useState<number>(ctx.league.dispersalDraftRounds ?? 0)
  const [core, setCore] = useState<Record<CoreToggleKey, boolean>>(() => coreFrom(ctx.league))

  useEffect(() => {
    setName(ctx.league.name ?? '')
    setTimezone(ctx.league.timezone ?? 'America/New_York')
    setLogoUrl(ctx.league.logoUrl ?? '')
    setLeagueSize(ctx.league.leagueSize ?? ctx.league.teams?.length ?? 12)
    setDispersalRounds(ctx.league.dispersalDraftRounds ?? 0)
    setCore(coreFrom(ctx.league))
  }, [ctx.league])

  const teamCounts = TEAM_COUNTS.includes(leagueSize) ? TEAM_COUNTS : [...TEAM_COUNTS, leagueSize].sort((a, b) => a - b)

  const sleeperSettingsHref = ctx.sleeperLeagueId
    ? `https://sleeper.com/leagues/${ctx.sleeperLeagueId}/settings`
    : null

  return (
    <div className="space-y-8">
      <div className="rounded-2xl border border-white/[0.08] bg-[#0a1228]/90 p-4 shadow-[0_0_0_1px_rgba(34,211,238,0.06)]">
        <div className="mb-3 flex items-center gap-2">
          <h3 className="text-[13px] font-bold uppercase tracking-wide text-cyan-200/90">{t('lsHub.gen.basics')}</h3>
          <span
            className="inline-flex items-center gap-1 text-[11px] text-white/35"
            title={t('lsHub.gen.autosaveHint')}
          >
            <HelpCircle className="h-3 w-3" aria-hidden />
            {t('lsHub.gen.autosave')}
          </span>
          {saving ? (
            <span className="ml-auto text-[11px] font-semibold text-cyan-300/80">{t('lsHub.saving')}</span>
          ) : null}
        </div>
        <label className="mb-3 block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/40">
            {t('lsHub.gen.leagueName')}
          </span>
          <input
            type="text"
            value={name}
            disabled={!canEdit}
            onChange={(e) => {
              const v = e.target.value
              setName(v)
              queuePatch({ name: v })
            }}
            className="w-full rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-cyan-400/35 focus:ring-2 focus:ring-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-50"
            maxLength={120}
            autoComplete="off"
          />
        </label>
        <label className="mb-3 block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/40">
            {t('lsHub.gen.timezone')}
          </span>
          <select
            value={timezone}
            disabled={!canEdit}
            onChange={(e) => {
              const v = e.target.value
              setTimezone(v)
              queuePatch({ timezone: v })
            }}
            className="w-full rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2.5 text-sm text-white outline-none focus:border-cyan-400/35 focus:ring-2 focus:ring-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {TZ_PRESETS.map((tz) => (
              <option key={tz} value={tz} className="bg-[#0d1117]">
                {tz.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-white/40">
            {t('lsHub.gen.logoUrl')}
          </span>
          <input
            type="url"
            value={logoUrl ?? ''}
            disabled={!canEdit}
            onChange={(e) => {
              const v = e.target.value
              setLogoUrl(v)
              queuePatch({ logoUrl: v || null })
            }}
            placeholder="https://…"
            className="w-full rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-cyan-400/35 focus:ring-2 focus:ring-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </label>
        {!canEdit ? (
          <p className="mt-3 text-[11px] text-amber-200/70">{t('lsHub.gen.commishOnly')}</p>
        ) : null}
      </div>

      <LeagueTypeConfirm leagueId={leagueId} alwaysShow />

      <HubCard title={t('lsHub.gen.format')} testId="league-settings-format-card">
        <HubChoices
          label={t('lsHub.gen.teams')}
          value={leagueSize}
          disabled={!canEdit}
          options={teamCounts.map((n) => ({ value: n, label: String(n) }))}
          onChange={(n) => {
            setLeagueSize(n)
            queuePatch({ leagueSize: n })
          }}
          testId="league-settings-team-count"
        />
        <p className="text-[11px] leading-relaxed text-white/45">{t('lsHub.gen.teamsLock')}</p>
        <HubChoices
          label={t('lsHub.gen.dispersal')}
          value={dispersalRounds}
          disabled={!canEdit}
          options={rangeChoices(0, 7, (n) => (n === 0 ? t('lsHub.none') : String(n)))}
          onChange={(n) => {
            setDispersalRounds(n)
            queuePatch({ dispersalDraftRounds: n })
          }}
        />
      </HubCard>

      <HubCard title={t('lsHub.gen.coreRules')} testId="league-settings-core-rules">
        {CORE_TOGGLES.map((row) => (
          <HubToggle
            key={row.key}
            label={t(row.labelKey)}
            hint={row.hintKey ? t(row.hintKey) : undefined}
            checked={core[row.key]}
            disabled={!canEdit}
            testId={`league-settings-${row.key}`}
            onChange={(v) => {
              setCore((c) => ({ ...c, [row.key]: v }))
              queuePatch({ [row.key]: v })
            }}
          />
        ))}
      </HubCard>

      <HubCard title={t('lsHub.tab.waivers')} testId="league-settings-waivers-section">
        <WaiversTab {...props} />
      </HubCard>

      <HubCard title={t('lsHub.tab.trades')} testId="league-settings-trades-section">
        <TradesTab {...props} />
      </HubCard>

      <LeagueRulesSummarySection
        league={ctx.league}
        displayLeague={ctx.displayLeague}
        sleeperSettingsHref={sleeperSettingsHref}
        showEditLink={Boolean(sleeperSettingsHref)}
      />
    </div>
  )
}

function coreFrom(league: Partial<Record<CoreToggleKey, boolean | null>>): Record<CoreToggleKey, boolean> {
  // Schema defaults: everything off except pre-draft moves.
  return Object.fromEntries(
    CORE_TOGGLES.map((row) => [row.key, league[row.key] ?? row.key === 'allowPreDraftMoves']),
  ) as Record<CoreToggleKey, boolean>
}
