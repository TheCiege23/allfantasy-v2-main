'use client'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { LegacySettingsEditor, type LegacySectionDef } from '@/components/legacy-specialty-settings/LegacySettingsEditor'
import { C2C_BASKETBALL_LINEUP_FREQS } from '@/lib/legacy-specialty-settings/legacySettingsSpec'
import { asC2C, asRecord, type LegacyC2CPanelProps } from './legacyC2CPanelProps'

const BASKETBALL: LegacySectionDef[] = [
  {
    titleKey: 'legacyC2c.scoring.lineupTitle',
    fields: [
      {
        key: 'basketballLineupFreq',
        labelKey: 'legacyC2c.field.basketballLineupFreq',
        kind: 'enum',
        options: C2C_BASKETBALL_LINEUP_FREQS.map((v) => ({ value: v, labelKey: `legacyC2c.opt.freq.${v}` })),
        fallback: 'weekly',
        recordedOnly: true,
      },
    ],
  },
]

/** Known stored values of the two football lock columns; anything else is shown as stored. */
const LOCK_DAY_KEYS: Record<string, string> = {
  saturday_kickoff: 'legacyC2c.lockDay.saturday_kickoff',
  sunday_kickoff_per_player: 'legacyC2c.lockDay.sunday_kickoff_per_player',
}

export function C2CScoringPanel({ config, leagueId, canEdit = false, onSaved }: LegacyC2CPanelProps) {
  const { t } = useOptionalLanguage()
  if (!config) return <p className="px-6 py-8 text-[13px] text-white/45">{t('legacySettings.loading')}</p>

  const isFb = String(config.sportPair).toUpperCase().includes('NFL')
  const lockDay = (v: string | undefined) => (v && LOCK_DAY_KEYS[v] ? t(LOCK_DAY_KEYS[v]) : (v ?? '—'))
  const where = <p className="text-[12px] text-white/60">{t('legacyC2c.scoring.modeElsewhere')}</p>

  if (isFb) {
    return (
      <div className="space-y-4 px-4 py-5 text-[13px] text-white/80 md:px-6" data-testid="c2c-scoring-panel">
        {where}
        <section className="rounded-xl border border-white/[0.08] bg-[#0a1228] p-4">
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-white/90">{t('legacyC2c.scoring.lineupTitle')}</h3>
          <ul className="mt-2 space-y-1 text-[12px] text-white/65">
            <li>
              {t('legacyC2c.scoring.campusLock')}: {lockDay(config.footballCampusLockDay)}
            </li>
            <li>
              {t('legacyC2c.scoring.cantonLock')}: {lockDay(config.footballCantonLockDay)}
            </li>
          </ul>
          <p className="mt-2 text-[11px] text-amber-200/75">{t('legacyC2c.scoring.footballLockFixed')}</p>
        </section>
      </div>
    )
  }

  return (
    <LegacySettingsEditor
      testId="c2c-scoring-panel"
      leagueId={leagueId}
      canEdit={canEdit}
      config={asRecord(config)}
      saveUrl="/api/c2c/settings"
      responseKey="c2c"
      sections={BASKETBALL}
      onSaved={onSaved ? (r) => onSaved(asC2C(r)) : undefined}
      intro={where}
    />
  )
}
