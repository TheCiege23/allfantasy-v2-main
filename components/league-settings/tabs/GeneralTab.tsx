'use client'

import { useEffect, useMemo, useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import LeagueTypeConfirm from '@/components/league/LeagueTypeConfirm'
import { useLeagueSettingsSectionAutosave } from '@/hooks/useLeagueSettingsSectionAutosave'
import { savedOr } from '@/lib/league-settings/savedLeagueOverrides'
import type { LeagueSettingsTabProps } from '../league-settings-tabs-types'
import { HubCard, HubChoices, HubToggle, rangeChoices } from './hubFields'
import { TradesTab } from './TradesTab'
import { SETTINGS_CARD_CLASS, SETTINGS_INPUT_CLASS, SETTINGS_LABEL_CLASS, WaiversSection } from './WaiversTab'

const TZ_PRESETS = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'UTC',
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

const DEFAULT_TZ = 'America/New_York'

/**
 * League tab: identity, format, team count and core rules, with Waivers & free agents and Trades as
 * sections of the same screen (they used to be two more tabs). Everything autosaves through the
 * sectioned settings PATCH, so the server's commish/co-commish check and lifecycle locks apply.
 *
 * 🛑 This hub only renders for NATIVE AllFantasy leagues (`LeagueSettingsModal` routes imported
 * leagues to its own read-only summary), so there is no host platform here: the old
 * "League rules — read-only snapshot · edit on your host platform" block was removed from this tab.
 */
export function GeneralTab(props: LeagueSettingsTabProps) {
  const { ctx, canEdit } = props
  const { t } = useLanguage()
  const leagueId = ctx.league.id
  const { queuePatch, saving } = useLeagueSettingsSectionAutosave(leagueId, 'general', {
    enabled: canEdit,
  })

  const seedName = () => String(savedOr(leagueId, 'name', ctx.league.name ?? ''))
  const seedTz = () => String(savedOr(leagueId, 'timezone', ctx.league.timezone ?? DEFAULT_TZ) || DEFAULT_TZ)
  const seedLogo = () => String(savedOr<string | null>(leagueId, 'logoUrl', ctx.league.logoUrl ?? '') ?? '')

  const [name, setName] = useState(seedName)
  const [timezone, setTimezone] = useState(seedTz)
  const [logoUrl, setLogoUrl] = useState(seedLogo)

  useEffect(() => {
    setName(seedName())
    setTimezone(seedTz())
    setLogoUrl(seedLogo())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.league.name, ctx.league.timezone, ctx.league.logoUrl])
  const [leagueSize, setLeagueSize] = useState<number>(ctx.league.leagueSize ?? ctx.league.teams?.length ?? 12)
  const [dispersalRounds, setDispersalRounds] = useState<number>(ctx.league.dispersalDraftRounds ?? 0)
  const [core, setCore] = useState<Record<CoreToggleKey, boolean>>(() => coreFrom(ctx.league))

  useEffect(() => {
    setLeagueSize(ctx.league.leagueSize ?? ctx.league.teams?.length ?? 12)
    setDispersalRounds(ctx.league.dispersalDraftRounds ?? 0)
    setCore(coreFrom(ctx.league))
  }, [ctx.league])

  const teamCounts = TEAM_COUNTS.includes(leagueSize) ? TEAM_COUNTS : [...TEAM_COUNTS, leagueSize].sort((a, b) => a - b)

  // A league saved with a zone outside the presets must still show (and keep) that zone.
  const tzOptions = useMemo(
    () => (TZ_PRESETS.includes(timezone) ? TZ_PRESETS : [timezone, ...TZ_PRESETS]),
    [timezone],
  )

  return (
    <div className="min-w-0 space-y-4 overflow-x-hidden">
      <section className={SETTINGS_CARD_CLASS}>
        <div className="mb-4 flex items-center gap-2">
          <h3 className="text-[13px] font-bold uppercase tracking-wide text-cyan-200/90">{t('lsHub.gen.basics')}</h3>
          <span
            className="inline-flex items-center gap-1 text-[11px] text-white/40"
            title={t('lsHub.gen.autosaveHint')}
          >
            <HelpCircle className="h-3 w-3" aria-hidden />
            {t('lsHub.gen.autosave')}
          </span>
          {saving ? (
            <span className="ml-auto shrink-0 text-[11px] font-semibold text-cyan-300/80">{t('lsHub.saving')}</span>
          ) : null}
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className={SETTINGS_LABEL_CLASS}>{t('lsHub.gen.leagueName')}</span>
            <input
              type="text"
              value={name}
              disabled={!canEdit}
              onChange={(e) => {
                const v = e.target.value
                setName(v)
                // A blank name is refused server-side; do not send one while the field is cleared.
                if (v.trim()) queuePatch({ name: v.trim() })
              }}
              className={SETTINGS_INPUT_CLASS}
              maxLength={120}
              autoComplete="off"
              data-testid="league-settings-general-name"
            />
          </label>

          <label className="block">
            <span className={SETTINGS_LABEL_CLASS}>{t('lsHub.gen.timezone')}</span>
            <select
              value={timezone}
              disabled={!canEdit}
              onChange={(e) => {
                const v = e.target.value
                setTimezone(v)
                queuePatch({ timezone: v })
              }}
              className={SETTINGS_INPUT_CLASS}
              data-testid="league-settings-general-timezone"
            >
              {tzOptions.map((tz) => (
                <option key={tz} value={tz} className="bg-[#0d1117]">
                  {tz.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className={SETTINGS_LABEL_CLASS}>{t('lsHub.gen.logoUrl')}</span>
            <input
              type="url"
              inputMode="url"
              value={logoUrl}
              disabled={!canEdit}
              onChange={(e) => {
                const v = e.target.value
                setLogoUrl(v)
                queuePatch({ logoUrl: v.trim() || null })
              }}
              placeholder="https://…"
              className={SETTINGS_INPUT_CLASS}
              autoComplete="off"
              data-testid="league-settings-general-logo"
            />
          </label>
        </div>

        {!canEdit ? (
          <p className="mt-3 text-[11px] text-amber-200/70">{t('lsHub.gen.commishOnly')}</p>
        ) : null}
      </section>

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

      <WaiversSection ctx={ctx} canEdit={canEdit} timezone={timezone} />

      <HubCard title={t('lsHub.tab.trades')} testId="league-settings-trades-section">
        <TradesTab {...props} />
      </HubCard>

    </div>
  )
}

function coreFrom(league: Partial<Record<CoreToggleKey, boolean | null>>): Record<CoreToggleKey, boolean> {
  // Schema defaults: everything off except pre-draft moves.
  return Object.fromEntries(
    CORE_TOGGLES.map((row) => [row.key, league[row.key] ?? row.key === 'allowPreDraftMoves']),
  ) as Record<CoreToggleKey, boolean>
}
