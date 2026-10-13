'use client'

import { useEffect, useState } from 'react'
import { RosterSettingsEditor } from '@/components/league-settings/RosterSettingsEditor'
import { useLeagueSettingsSectionAutosave } from '@/hooks/useLeagueSettingsSectionAutosave'
import type { LeagueSettingsTabProps } from '../league-settings-tabs-types'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { HubCard, HubChoices, HubSavingNote, HubToggle, rangeChoices } from './hubFields'

/** IR eligibility switches, in the order commishes see them on every other host. */
const IR_TOGGLES = [
  { key: 'irAllowOut', labelKey: 'lsHub.ro.irOut', fallback: true },
  { key: 'irAllowSuspended', labelKey: 'lsHub.ro.irSuspended', fallback: false },
  { key: 'irAllowNA', labelKey: 'lsHub.ro.irNa', fallback: false },
  { key: 'irAllowDNR', labelKey: 'lsHub.ro.irDnr', fallback: false },
  { key: 'irAllowDoubtful', labelKey: 'lsHub.ro.irDoubtful', fallback: false },
] as const
type IrKey = (typeof IR_TOGGLES)[number]['key']

/** Taxi squads only mean something when rosters carry over. */
function hasTaxiSquad(league: { isDynasty?: boolean | null; leagueType?: string | null }): boolean {
  const type = String(league.leagueType ?? '').toLowerCase()
  return Boolean(league.isDynasty) || type === 'dynasty' || type === 'keeper' || type.includes('devy') || type === 'c2c'
}

export function RostersTab({ ctx, canEdit }: LeagueSettingsTabProps) {
  const { t } = useLanguage()
  const league = ctx.league
  const { queuePatch, saving } = useLeagueSettingsSectionAutosave(league.id, 'roster', { enabled: canEdit })

  const [irSlots, setIrSlots] = useState<number>(league.irSlots ?? 0)
  const [ir, setIr] = useState<Record<IrKey, boolean>>(() => irFrom(league))
  const [taxiSlots, setTaxiSlots] = useState<number>(league.taxiSlots ?? 0)
  const [taxiNonRookies, setTaxiNonRookies] = useState(Boolean(league.taxiAllowNonRookies))
  const [taxiYears, setTaxiYears] = useState<number>(league.taxiYearsLimit ?? 2)
  const [taxiDeadline, setTaxiDeadline] = useState<number>(league.taxiDeadlineWeek ?? 0)

  useEffect(() => {
    setIrSlots(league.irSlots ?? 0)
    setIr(irFrom(league))
    setTaxiSlots(league.taxiSlots ?? 0)
    setTaxiNonRookies(Boolean(league.taxiAllowNonRookies))
    setTaxiYears(league.taxiYearsLimit ?? 2)
    setTaxiDeadline(league.taxiDeadlineWeek ?? 0)
  }, [league])

  const showTaxi = hasTaxiSquad(league)

  return (
    <div className="space-y-6">
      <p className="text-[12px] text-white/45">{t('lsHub.ro.note')}</p>
      <RosterSettingsEditor leagueId={league.id} />

      <HubCard title={t('lsHub.ro.reserves')} testId="league-settings-ir-card">
        <HubSavingNote saving={saving} text={t('lsHub.saving')} />
        <HubChoices
          label={t('lsHub.ro.irSlots')}
          value={irSlots}
          disabled={!canEdit}
          options={rangeChoices(0, 6)}
          onChange={(n) => {
            setIrSlots(n)
            queuePatch({ irSlots: n })
          }}
        />
        {irSlots > 0
          ? IR_TOGGLES.map((row) => (
              <HubToggle
                key={row.key}
                label={t(row.labelKey)}
                checked={ir[row.key]}
                disabled={!canEdit}
                onChange={(v) => {
                  setIr((c) => ({ ...c, [row.key]: v }))
                  queuePatch({ [row.key]: v })
                }}
              />
            ))
          : null}
      </HubCard>

      {showTaxi ? (
        <HubCard title={t('lsHub.ro.taxi')} testId="league-settings-taxi-card">
          <HubChoices
            label={t('lsHub.ro.taxiSlots')}
            value={taxiSlots}
            disabled={!canEdit}
            options={rangeChoices(0, 6)}
            onChange={(n) => {
              setTaxiSlots(n)
              queuePatch({ taxiSlots: n })
            }}
          />
          {taxiSlots > 0 ? (
            <>
              <HubToggle
                label={t('lsHub.ro.taxiNonRookies')}
                checked={taxiNonRookies}
                disabled={!canEdit}
                onChange={(v) => {
                  setTaxiNonRookies(v)
                  queuePatch({ taxiAllowNonRookies: v })
                }}
              />
              <HubChoices
                label={t('lsHub.ro.taxiYears')}
                value={taxiYears}
                disabled={!canEdit}
                options={[
                  { value: 0, label: t('lsHub.ro.taxiNoMax'), hint: t('lsHub.ro.taxiNoMaxHint') },
                  ...rangeChoices(1, 3, (n) => t('lsHub.ro.taxiYearsN').replace('{{n}}', String(n))),
                ]}
                onChange={(n) => {
                  setTaxiYears(n)
                  queuePatch({ taxiYearsLimit: n })
                }}
              />
              <HubChoices
                label={t('lsHub.ro.taxiDeadline')}
                value={taxiDeadline}
                disabled={!canEdit}
                options={[
                  { value: 0, label: t('lsHub.ro.taxiNoDeadline'), hint: t('lsHub.ro.taxiNoDeadlineHint') },
                  ...rangeChoices(1, 4, (n) => t('lsHub.ro.weekN').replace('{{n}}', String(n))),
                ]}
                onChange={(n) => {
                  setTaxiDeadline(n)
                  queuePatch({ taxiDeadlineWeek: n })
                }}
              />
            </>
          ) : null}
        </HubCard>
      ) : null}
    </div>
  )
}

function irFrom(league: Partial<Record<IrKey, boolean | null>>): Record<IrKey, boolean> {
  return Object.fromEntries(IR_TOGGLES.map((row) => [row.key, league[row.key] ?? row.fallback])) as Record<IrKey, boolean>
}
