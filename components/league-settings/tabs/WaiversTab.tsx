'use client'

import { useEffect, useRef, useState } from 'react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import { useLeagueSettingsSectionAutosave } from '@/hooks/useLeagueSettingsSectionAutosave'
import { SettingsSwitch } from '@/components/league-settings/SettingsSwitch'
import { savedOr } from '@/lib/league-settings/savedLeagueOverrides'
import {
  DAILY_WAIVER_MODES,
  WAIVER_DAY_KEYS,
  defaultDailyWaiverSchedule,
  readDailyWaiverScheduleFromSettings,
  scheduleUsesFaab,
  type DailyWaiverMode,
  type DailyWaiverSchedule,
  type WaiverDayKey,
} from '@/lib/waivers/dailyWaiverSchedule'
import type { LeagueSettingsTabProps } from '../league-settings-tabs-types'

/** Option labels are dictionary keys, resolved at render. */
const WAIVER_TYPES = [
  { value: 'faab', labelKey: 'lsHub.wv.faab' },
  { value: 'rolling', labelKey: 'lsHub.wv.rolling' },
  { value: 'reverse_standings', labelKey: 'lsHub.wv.reverse' },
]

const MODE_LABEL_KEYS: Record<DailyWaiverMode, string> = {
  waivers: 'lsHub.wv.mode.waivers',
  rolling: 'lsHub.wv.mode.rolling',
  reverse_standings: 'lsHub.wv.mode.reverse_standings',
  faab: 'lsHub.wv.mode.faab',
  waivers_then_fa: 'lsHub.wv.mode.waivers_then_fa',
  free_agents: 'lsHub.wv.mode.free_agents',
  locked: 'lsHub.wv.mode.locked',
}

const DAY_LABEL_KEYS: Record<WaiverDayKey, string> = {
  mon: 'lsHub.wv.day.mon',
  tue: 'lsHub.wv.day.tue',
  wed: 'lsHub.wv.day.wed',
  thu: 'lsHub.wv.day.thu',
  fri: 'lsHub.wv.day.fri',
  sat: 'lsHub.wv.day.sat',
  sun: 'lsHub.wv.day.sun',
}

const HOURS = Array.from({ length: 24 }, (_, h) => h)

/** Shared mobile-first field styles for the General tab's cards. */
export const SETTINGS_INPUT_CLASS =
  'block w-full min-w-0 rounded-xl border border-white/[0.10] bg-black/25 px-3 py-2.5 text-[15px] text-white outline-none placeholder:text-white/30 focus:border-cyan-400/35 focus:ring-2 focus:ring-cyan-500/15 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm'
export const SETTINGS_LABEL_CLASS = 'mb-1.5 block text-[12px] font-semibold text-white/60'
export const SETTINGS_CARD_CLASS =
  'min-w-0 rounded-2xl border border-white/[0.08] bg-[#0a1228]/90 p-4 shadow-[0_0_0_1px_rgba(34,211,238,0.06)]'

function numOr(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Waivers & free agents — a section of the General tab (it no longer has its own tab).
 * Main waiver type, per-day Mon–Sun schedule, FAAB fields (only when FAAB is in use), waiver period.
 */
export function WaiversSection({
  ctx,
  canEdit,
  timezone,
}: Pick<LeagueSettingsTabProps, 'ctx' | 'canEdit'> & { timezone: string }) {
  const { t } = useLanguage()
  const leagueId = ctx.league.id
  const { queuePatch, saving } = useLeagueSettingsSectionAutosave(leagueId, 'waivers', { enabled: canEdit })

  const seed = () => ({
    waiverType: String(savedOr(leagueId, 'waiverType', ctx.league.waiverType ?? 'rolling')),
    waiverBudget: numOr(savedOr(leagueId, 'waiverBudget', ctx.league.waiverBudget ?? 100), 100),
    waiverMinBid: numOr(savedOr(leagueId, 'waiverMinBid', ctx.league.waiverMinBid ?? 0), 0),
    waiverHours: numOr(savedOr(leagueId, 'waiverHours', ctx.league.waiverHours ?? 24), 24),
    schedule:
      (savedOr<DailyWaiverSchedule | null>(
        leagueId,
        'dailyWaiverSchedule',
        readDailyWaiverScheduleFromSettings(ctx.league.settings),
      ) ?? defaultDailyWaiverSchedule()) as DailyWaiverSchedule,
  })

  const [waiverType, setWaiverType] = useState(() => seed().waiverType)
  const [waiverBudget, setWaiverBudget] = useState(() => seed().waiverBudget)
  const [waiverMinBid, setWaiverMinBid] = useState(() => seed().waiverMinBid)
  const [waiverHours, setWaiverHours] = useState(() => seed().waiverHours)
  const [schedule, setSchedule] = useState<DailyWaiverSchedule>(() => seed().schedule)

  useEffect(() => {
    const s = seed()
    setWaiverType(s.waiverType)
    setWaiverBudget(s.waiverBudget)
    setWaiverMinBid(s.waiverMinBid)
    setWaiverHours(s.waiverHours)
    setSchedule(s.schedule)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.league.waiverType, ctx.league.waiverBudget, ctx.league.waiverMinBid, ctx.league.waiverHours, ctx.league.settings])

  // The schedule is stored in league-local time and derived into UTC server-side, so a timezone
  // change re-sends it (with the new zone) to keep the processing days right.
  const prevTz = useRef(timezone)
  useEffect(() => {
    if (prevTz.current === timezone) return
    prevTz.current = timezone
    if (schedule.enabled) queuePatch({ timezone, dailyWaiverSchedule: schedule })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timezone])

  const updateSchedule = (next: DailyWaiverSchedule) => {
    setSchedule(next)
    queuePatch({ dailyWaiverSchedule: next })
  }

  const showFaab = scheduleUsesFaab(schedule, waiverType)

  return (
    <section className={SETTINGS_CARD_CLASS} data-testid="league-settings-waivers-section">
      <div className="mb-4 flex items-center gap-2">
        <h3 className="min-w-0 flex-1 text-[13px] font-bold uppercase tracking-wide text-cyan-200/90">
          {t('lsHub.wv.sectionTitle')}
        </h3>
        {saving ? <span className="shrink-0 text-[11px] font-semibold text-cyan-300/80">{t('lsHub.saving')}</span> : null}
      </div>

      <div className="space-y-4">
        <label className="block">
          <span className={SETTINGS_LABEL_CLASS}>{t('lsHub.wv.type')}</span>
          <select
            value={waiverType}
            disabled={!canEdit}
            onChange={(e) => {
              const v = e.target.value
              setWaiverType(v)
              queuePatch({ waiverType: v })
            }}
            className={SETTINGS_INPUT_CLASS}
            data-testid="league-settings-waiver-type"
          >
            {WAIVER_TYPES.map((o) => (
              <option key={o.value} value={o.value} className="bg-[#0d1117]">
                {t(o.labelKey)}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] leading-snug text-white/40">{t('lsHub.wv.typeHint')}</span>
        </label>

        {showFaab ? (
          <div className="grid grid-cols-1 gap-4 min-[380px]:grid-cols-2" data-testid="league-settings-faab-fields">
            <label className="block min-w-0">
              <span className={SETTINGS_LABEL_CLASS}>{t('lsHub.wv.budget')}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={10000}
                value={waiverBudget}
                disabled={!canEdit}
                onChange={(e) => {
                  const v = Math.max(0, Number(e.target.value) || 0)
                  setWaiverBudget(v)
                  queuePatch({ waiverBudget: v })
                }}
                className={SETTINGS_INPUT_CLASS}
              />
            </label>
            <label className="block min-w-0">
              <span className={SETTINGS_LABEL_CLASS}>{t('lsHub.wv.minBid')}</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                value={waiverMinBid}
                disabled={!canEdit}
                onChange={(e) => {
                  const v = Math.max(0, Number(e.target.value) || 0)
                  setWaiverMinBid(v)
                  queuePatch({ waiverMinBid: v })
                }}
                className={SETTINGS_INPUT_CLASS}
              />
            </label>
          </div>
        ) : (
          <p className="text-[11px] leading-snug text-white/40">{t('lsHub.wv.faabOnlyNote')}</p>
        )}

        <label className="block">
          <span className={SETTINGS_LABEL_CLASS}>{t('lsHub.wv.period')}</span>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            max={168}
            value={waiverHours}
            disabled={!canEdit}
            onChange={(e) => {
              const v = Math.min(168, Math.max(0, Number(e.target.value) || 0))
              setWaiverHours(v)
              queuePatch({ waiverHours: v })
            }}
            className={SETTINGS_INPUT_CLASS}
          />
          <span className="mt-1 block text-[11px] leading-snug text-white/40">{t('lsHub.wv.periodHint')}</span>
        </label>

        <div className="border-t border-white/[0.06] pt-4">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p id={`daily-waivers-label-${leagueId}`} className="text-[13px] font-semibold text-white/90">{t('lsHub.wv.daily')}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-white/40">
                {schedule.enabled ? t('lsHub.wv.dailyHint') : t('lsHub.wv.dailyOff')}
              </p>
            </div>
            <SettingsSwitch
              id={`daily-waivers-toggle-${leagueId}`}
              checked={schedule.enabled}
              onChange={(next) => updateSchedule({ ...schedule, enabled: next })}
              disabled={!canEdit}
              labelledBy={`daily-waivers-label-${leagueId}`}
            />
          </div>

          {schedule.enabled ? (
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className={SETTINGS_LABEL_CLASS}>{t('lsHub.wv.processAt')}</span>
                <select
                  value={schedule.processHour}
                  disabled={!canEdit}
                  onChange={(e) => updateSchedule({ ...schedule, processHour: Number(e.target.value) })}
                  className={SETTINGS_INPUT_CLASS}
                  data-testid="league-settings-daily-waivers-hour"
                >
                  {HOURS.map((h) => (
                    <option key={h} value={h} className="bg-[#0d1117]">
                      {`${String(h).padStart(2, '0')}:00`}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-[11px] leading-snug text-white/40">
                  {t('lsHub.wv.processAtHint').replace('{{tz}}', timezone.replace(/_/g, ' '))}
                </span>
              </label>

              <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-xl border border-white/[0.08] bg-black/20">
                {WAIVER_DAY_KEYS.map((day) => (
                  <li key={day} className="flex items-center gap-3 px-3 py-2">
                    <span className="w-10 shrink-0 text-[13px] font-semibold text-white/75" id={`waiver-day-${leagueId}-${day}`}>
                      {t(DAY_LABEL_KEYS[day])}
                    </span>
                    <select
                      aria-labelledby={`waiver-day-${leagueId}-${day}`}
                      value={schedule.days[day]}
                      disabled={!canEdit}
                      onChange={(e) =>
                        updateSchedule({
                          ...schedule,
                          days: { ...schedule.days, [day]: e.target.value as DailyWaiverMode },
                        })
                      }
                      data-testid={`league-settings-daily-waivers-${day}`}
                      className="block w-full min-w-0 flex-1 rounded-lg border border-white/[0.10] bg-black/25 px-2.5 py-2 text-[14px] text-white outline-none focus:border-cyan-400/35 disabled:opacity-50 sm:text-[13px]"
                    >
                      {DAILY_WAIVER_MODES.map((m) => (
                        <option key={m} value={m} className="bg-[#0d1117]">
                          {t(MODE_LABEL_KEYS[m])}
                        </option>
                      ))}
                    </select>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] leading-snug text-white/45">{t('lsHub.wv.legendFa')}</p>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

/** Kept for any deep link that still names the old tab; renders the section on its own. */
export function WaiversTab({ ctx, canEdit }: LeagueSettingsTabProps) {
  return <WaiversSection ctx={ctx} canEdit={canEdit} timezone={ctx.league.timezone ?? 'America/New_York'} />
}
