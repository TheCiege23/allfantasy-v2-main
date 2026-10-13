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

      <PositionLimitsCard leagueId={league.id} canEdit={canEdit} queuePatch={queuePatch} />
    </div>
  )
}

type PositionLimitsData = { enforced: boolean; positions: string[]; limits: Record<string, number>; highest: Record<string, number> }
const LIMIT_CHOICES = Array.from({ length: 10 }, (_, i) => i + 1)

/**
 * Position limits: the most players of one position a team may roster. Saved through the roster
 * section's autosave; enforced on adds, claims and trades (lib/league/positionLimitsServer.ts).
 */
function PositionLimitsCard({
  leagueId,
  canEdit,
  queuePatch,
}: {
  leagueId: string
  canEdit: boolean
  queuePatch: (patch: Record<string, unknown>) => void
}) {
  const { t } = useLanguage()
  const [data, setData] = useState<PositionLimitsData | null>(null)
  const [limits, setLimits] = useState<Record<string, number>>({})
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/position-limits`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: PositionLimitsData) => {
        if (cancelled) return
        setData(d)
        setLimits(d.limits)
      })
      .catch(() => !cancelled && setFailed(true))
    return () => {
      cancelled = true
    }
  }, [leagueId])

  if (failed) return null
  const editable = canEdit && Boolean(data?.enforced)

  const setLimit = (pos: string, n: number) => {
    const next = { ...limits }
    if (n > 0) next[pos] = n
    else delete next[pos]
    setLimits(next)
    queuePatch({ positionLimits: next })
  }

  return (
    <HubCard title={t('lsHub.pl.title')} testId="league-settings-position-limits">
      <p className="text-[12px] text-white/50">{data && !data.enforced ? t('lsHub.pl.imported') : t('lsHub.pl.hint')}</p>
      {!data ? (
        <div className="h-24 animate-pulse rounded-xl bg-white/[0.05]" />
      ) : data.positions.length === 0 ? (
        <p className="text-[12px] text-white/45">{t('lsHub.pl.none')}</p>
      ) : (
        <ul className="divide-y divide-white/[0.06] rounded-2xl border border-white/[0.08] bg-black/20">
          {data.positions.map((pos) => {
            const limit = limits[pos] ?? 0
            const highest = data.highest[pos] ?? 0
            const choices = [...new Set([...LIMIT_CHOICES, ...(limit > 0 ? [limit] : [])])].sort((a, b) => a - b)
            return (
              <li key={pos} className="space-y-1 px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[14px] font-bold text-white">{pos}</span>
                  <select
                    value={limit}
                    disabled={!editable}
                    onChange={(e) => setLimit(pos, Number(e.target.value))}
                    aria-label={t('lsHub.pl.limitFor').replace('{{pos}}', pos)}
                    className="w-32 rounded-xl border border-white/[0.10] bg-black/25 px-3 py-1.5 text-[13px] text-white disabled:opacity-50"
                  >
                    <option value={0} className="bg-[#0d1117]">{t('lsHub.pl.noLimit')}</option>
                    {choices.map((n) => (
                      <option key={n} value={n} className="bg-[#0d1117]">
                        {t('lsHub.pl.max').replace('{{n}}', String(n))}
                      </option>
                    ))}
                  </select>
                </div>
                {limit > 0 && highest > limit ? (
                  <p className="text-[11px] text-amber-200/80">
                    {t('lsHub.pl.over').replace('{{n}}', String(highest)).replace('{{pos}}', pos)}
                  </p>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </HubCard>
  )
}

function irFrom(league: Partial<Record<IrKey, boolean | null>>): Record<IrKey, boolean> {
  return Object.fromEntries(IR_TOGGLES.map((row) => [row.key, league[row.key] ?? row.fallback])) as Record<IrKey, boolean>
}
