'use client'

import { useEffect, useMemo, useState } from 'react'
import { HelpCircle } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { useLeagueSettingsSectionAutosave } from '@/hooks/useLeagueSettingsSectionAutosave'
import { savedOr } from '@/lib/league-settings/savedLeagueOverrides'
import type { LeagueSettingsTabProps } from '../league-settings-tabs-types'
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

const DEFAULT_TZ = 'America/New_York'

/**
 * General — league basics plus the Waivers & free agents section.
 *
 * 🛑 This hub only renders for NATIVE AllFantasy leagues (`LeagueSettingsModal` routes imported
 * leagues to its own read-only summary), so there is no host platform here: the old
 * "League rules — read-only snapshot · edit on your host platform" block was removed from this tab.
 */
export function GeneralTab({
  ctx,
  canEdit,
  showWaivers = true,
}: LeagueSettingsTabProps & {
  /** The League Settings list opens Waivers as its own row, so its General page omits it. */
  showWaivers?: boolean
}) {
  const { t } = useLanguage()
  const leagueId = ctx.league.id
  const { queuePatch, saving, lastError } = useLeagueSettingsSectionAutosave(leagueId, 'general', {
    enabled: canEdit,
  })

  const seedName = () => String(savedOr(leagueId, 'name', ctx.league.name ?? ''))
  const seedTz = () => String(savedOr(leagueId, 'timezone', ctx.league.timezone ?? DEFAULT_TZ) || DEFAULT_TZ)
  const seedLogo = () => String(savedOr<string | null>(leagueId, 'logoUrl', ctx.league.logoUrl ?? '') ?? '')

  const [capacityError, setCapacityError] = useState<string | null>(null)
  const [teamCount, setTeamCount] = useState(String(savedOr(leagueId, 'leagueSize', ctx.league.leagueSize ?? 12)))
  const [name, setName] = useState(seedName)
  const [timezone, setTimezone] = useState(seedTz)
  const [logoUrl, setLogoUrl] = useState(seedLogo)

  useEffect(() => {
    setTeamCount(String(savedOr(leagueId, 'leagueSize', ctx.league.leagueSize ?? 12)))
    setName(seedName())
    setTimezone(seedTz())
    setLogoUrl(seedLogo())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.league.name, ctx.league.timezone, ctx.league.logoUrl, ctx.league.leagueSize])

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

        {capacityError ? <p role="alert" className="mb-3 text-sm text-red-300">{capacityError}</p> : null}
        {lastError ? <p role="alert" className="mb-3 text-sm text-red-300">{lastError}</p> : null}
        <div className="space-y-4">
          <label className="block">
            <span className={SETTINGS_LABEL_CLASS}>Number of teams</span>
            <input type="number" inputMode="numeric" min={2} max={32} value={teamCount} disabled={!canEdit}
              onChange={event => setTeamCount(event.target.value)}
              onBlur={() => {
                const size = Number(teamCount)
                if (!Number.isInteger(size) || size < 2 || size > 32) { setCapacityError('Enter a team count between 2 and 32.'); return }
                setCapacityError(null)
                if (size !== ctx.league.leagueSize) queuePatch({ leagueSize: size })
              }}
              className={SETTINGS_INPUT_CLASS} data-testid="league-settings-general-team-count" />
            <span className="mt-1 block text-xs text-white/60">Change before drafting. Remove only empty, unclaimed seats.</span>
          </label>
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

      {showWaivers ? <WaiversSection ctx={ctx} canEdit={canEdit} timezone={timezone} /> : null}
    </div>
  )
}
