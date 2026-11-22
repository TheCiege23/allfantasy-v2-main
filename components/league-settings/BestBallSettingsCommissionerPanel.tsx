'use client'

/**
 * BestBallSettingsCommissionerPanel
 * In-league commissioner panel for editing Best Ball mode settings.
 * Calls PATCH /api/bestball/settings and surfaces all fields normalized
 * by normalizeBestBallSettings: mode, contest structure, scoring model,
 * waivers/trades/subs, tiebreaker, and scoring period.
 *
 * Once the draft has started (`structureLock` from GET /api/leagues/:id/bestball) everything that changes
 * how the league is scored or competed is read-only (the PATCH refuses it too) and only the in-season
 * transaction toggles stay editable. Daily best ball is offered for NBA / NHL / MLB only, never for a
 * tournament (lib/bestball/scoringPeriod.ts). A tournament is set up at creation, so it is offered here
 * only to a league that already is one.
 */

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  getBestBallSportProfile,
  BEST_BALL_CONTEST_STRUCTURES,
  BEST_BALL_MATCHUP_FORMATS,
  BEST_BALL_PLAYOFF_FORMATS,
} from '@/lib/bestball/rules'
import type { BestBallCreateSettings, BestBallModeId } from '@/lib/bestball/rules'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

interface Props {
  leagueId: string
  sport: string
  canEdit: boolean
}

type LoadedSettings = Pick<
  BestBallCreateSettings,
  | 'mode'
  | 'contestStructure'
  | 'matchupFormat'
  | 'playoffFormat'
  | 'tieRule'
  | 'scoringPeriod'
  | 'waiversEnabled'
  | 'tradesEnabled'
  | 'substitutionsEnabled'
  | 'podSize'
  | 'tournamentAdvancementRounds'
  | 'regularSeasonLength'
  | 'playoffTeams'
>

type ApiResponse = {
  league: {
    bbWaiversEnabled: boolean
    bbTradesEnabled: boolean
    bbMatchupFormat: string
    bbScoringPeriod: string
    bbTiebreaker: string
    bestBallVariant: string
    settings: Record<string, unknown>
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <span className="text-[12px] text-white/55">{label}</span>
      <div className="sm:w-56">{children}</div>
    </div>
  )
}

function SelectField({
  value,
  options,
  onChange,
  disabled,
  testId,
}: {
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
  disabled: boolean
  testId?: string
}) {
  return (
    <select
      data-testid={testId}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full rounded-lg border border-[#2a3654] bg-[#0a1228] px-3 py-2 text-[12px] text-white disabled:opacity-50"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-10 rounded-full transition-colors disabled:opacity-50 ${checked ? 'bg-cyan-500' : 'bg-white/15'}`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'left-5' : 'left-1'}`}
      />
    </button>
  )
}

function IntField({
  value,
  onChange,
  min,
  max,
  disabled,
}: {
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  disabled: boolean
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const parsed = Number.parseInt(e.target.value || '0', 10)
        if (Number.isFinite(parsed)) onChange(Math.max(min, Math.min(max, parsed)))
      }}
      disabled={disabled}
      className="w-full rounded-lg border border-[#2a3654] bg-[#0a1228] px-3 py-2 text-[12px] text-white disabled:opacity-50"
    />
  )
}

export function BestBallSettingsCommissionerPanel({ leagueId, sport, canEdit }: Props) {
  const { t } = useOptionalLanguage()
  const profile = getBestBallSportProfile(sport)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  /** Why scoring and competition settings are frozen ("after the draft has started"), or null. */
  const [structureLock, setStructureLock] = useState<string | null>(null)
  const [loadedTournament, setLoadedTournament] = useState(false)
  /** The season daily best ball is waiting on (no regular-season opener stored yet), or null. */
  const [dailyWaitingSeason, setDailyWaitingSeason] = useState<number | null>(null)
  /**
   * The league's own starter seats, from the API (`getBestBallSportProfile(sport, league.settings)` — what
   * its matchups are scored on). Until it loads, the sport's default best ball seats. Finding #22.
   */
  const [starterSeats, setStarterSeats] = useState<number>(() => profile.lineupSlots.reduce((sum, s) => sum + s.count, 0))

  const [settings, setSettings] = useState<LoadedSettings>({
    mode: 'standard',
    contestStructure: 'season_long',
    matchupFormat: profile.defaultMatchupFormat,
    playoffFormat: profile.defaultPlayoffFormat,
    tieRule: 'max_week',
    scoringPeriod: profile.scoringPeriod,
    waiversEnabled: false,
    tradesEnabled: false,
    substitutionsEnabled: false,
    podSize: 12,
    tournamentAdvancementRounds: 0,
    regularSeasonLength: profile.defaultRegularSeasonLength,
    playoffTeams: profile.defaultPlayoffTeams,
  })

  // Load current settings from the bestball API response endpoint
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setFetchError(null)
      try {
        const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/bestball?week=1`, {
          cache: 'no-store',
        })
        const json = (await res.json()) as {
          league?: {
            settings?: Record<string, unknown>
            structureLock?: string | null
            profile?: { lineupSlots?: Array<{ count?: unknown }> }
          }
          dailySchedule?: { state?: unknown; season?: unknown } | null
          error?: string
        }
        if (!res.ok) throw new Error(json.error ?? t('lsRules.bb.loadFailed'))
        if (!cancelled) setStructureLock(typeof json.league?.structureLock === 'string' ? json.league.structureLock : null)
        if (!cancelled) {
          const ds = json.dailySchedule
          setDailyWaitingSeason(ds?.state === 'waiting' && typeof ds.season === 'number' ? ds.season : null)
        }
        const leagueSlots = json.league?.profile?.lineupSlots
        if (!cancelled && Array.isArray(leagueSlots) && leagueSlots.length > 0) {
          setStarterSeats(leagueSlots.reduce((sum, s) => sum + (typeof s.count === 'number' ? s.count : 0), 0))
        }
        if (!cancelled && json.league?.settings) {
          const raw = json.league.settings as Record<string, unknown>
          setLoadedTournament(raw.contestStructure === 'tournament')
          setSettings((prev) => ({
            ...prev,
            mode: (raw.mode as BestBallModeId) ?? prev.mode,
            contestStructure:
              BEST_BALL_CONTEST_STRUCTURES.includes(raw.contestStructure as never)
                ? (raw.contestStructure as LoadedSettings['contestStructure'])
                : prev.contestStructure,
            matchupFormat:
              BEST_BALL_MATCHUP_FORMATS.includes(raw.matchupFormat as never)
                ? (raw.matchupFormat as LoadedSettings['matchupFormat'])
                : prev.matchupFormat,
            playoffFormat:
              BEST_BALL_PLAYOFF_FORMATS.includes(raw.playoffFormat as never)
                ? (raw.playoffFormat as LoadedSettings['playoffFormat'])
                : prev.playoffFormat,
            tieRule: (['points_for', 'max_week', 'advance_all'] as const).includes(raw.tieRule as never)
              ? (raw.tieRule as LoadedSettings['tieRule'])
              : prev.tieRule,
            scoringPeriod: raw.scoringPeriod === 'daily' ? 'daily' : 'weekly',
            waiversEnabled: typeof raw.waiversEnabled === 'boolean' ? raw.waiversEnabled : prev.waiversEnabled,
            tradesEnabled: typeof raw.tradesEnabled === 'boolean' ? raw.tradesEnabled : prev.tradesEnabled,
            substitutionsEnabled:
              typeof raw.substitutionsEnabled === 'boolean' ? raw.substitutionsEnabled : prev.substitutionsEnabled,
            podSize: typeof raw.podSize === 'number' ? raw.podSize : prev.podSize,
            tournamentAdvancementRounds:
              typeof raw.tournamentAdvancementRounds === 'number'
                ? raw.tournamentAdvancementRounds
                : prev.tournamentAdvancementRounds,
            regularSeasonLength:
              typeof raw.regularSeasonLength === 'number' ? raw.regularSeasonLength : prev.regularSeasonLength,
            playoffTeams: typeof raw.playoffTeams === 'number' ? raw.playoffTeams : prev.playoffTeams,
          }))
        }
      } catch (err) {
        if (!cancelled)
          setFetchError(err instanceof Error ? err.message : t('lsRules.bb.loadFailed'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [leagueId])

  const save = useCallback(async () => {
    if (!canEdit || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/bestball/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leagueId,
          bbWaiversEnabled: settings.waiversEnabled,
          bestBall: {
            mode: settings.mode,
            contestStructure: settings.contestStructure,
            matchupFormat: settings.matchupFormat,
            playoffFormat: settings.playoffFormat,
            tieRule: settings.tieRule,
            scoringPeriod: settings.scoringPeriod,
            substitutionsEnabled: settings.substitutionsEnabled,
            podSize: settings.podSize,
            tournamentAdvancementRounds: settings.tournamentAdvancementRounds,
            regularSeasonLength: settings.regularSeasonLength,
            playoffTeams: settings.playoffTeams,
          } satisfies Partial<BestBallCreateSettings>,
        }),
      })
      const json = (await res.json()) as ApiResponse | { error?: string }
      if (!res.ok) {
        const msg = (json as { error?: string }).error ?? t('lsRules.bb.saveFailed')
        toast.error(msg)
      } else {
        toast.success(t('lsRules.bb.saved'))
      }
    } catch {
      toast.error(t('lsRules.bb.saveFailed'))
    } finally {
      setSaving(false)
    }
  }, [canEdit, leagueId, saving, settings, t])

  const patch = useCallback((p: Partial<LoadedSettings>) => setSettings((s) => ({ ...s, ...p })), [])

  const isUnderdog = settings.mode === 'underdog'
  const isTournament = settings.contestStructure === 'tournament'
  const isSitAndGo = settings.contestStructure === 'sit_and_go'
  // Scoring and competition: frozen once the draft has started. Transactions stay editable.
  const locked = !canEdit || structureLock != null
  const dailyOffered = profile.supportsDailyScoring && !isTournament

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/[0.08] bg-[#0a1228]/60 p-4 text-[12px] text-white/50">
        {t('lsRules.bb.loading')}
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="rounded-2xl border border-rose-400/30 bg-rose-500/10 p-4 text-[12px] text-rose-200">
        {fetchError}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {structureLock ? (
        <div
          data-testid="bb-structure-lock"
          role="note"
          className="rounded-2xl border border-[#f59e0b]/35 bg-[#2a1d06] px-4 py-3 text-[12px] leading-relaxed text-[#fde68a]"
        >
          <span className="font-semibold">
            {/draft/i.test(structureLock) ? t('lsRules.bb.lockedDraft') : t('lsRules.bb.lockedSeason')}
          </span>{' '}
          {t('lsRules.bb.lockedBody')}
        </div>
      ) : null}
      {/* Mode */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#0a1228]/80 p-4">
        <h4 className="mb-4 text-[11px] font-bold uppercase tracking-wide text-cyan-200/80">{t('lsRules.bb.operatingMode')}</h4>
        <Row label={t('lsRules.bb.mode')}>
          <SelectField
            value={settings.mode}
            options={[
              { value: 'standard', label: t('lsRules.bb.standard') },
              { value: 'underdog', label: t('lsRules.bb.underdog') },
            ]}
            onChange={(v) =>
              patch({
                mode: v as BestBallModeId,
                ...(v === 'underdog'
                  ? { waiversEnabled: false, tradesEnabled: false, substitutionsEnabled: false }
                  : {}),
              })
            }
            disabled={locked}
          />
        </Row>
        {isUnderdog ? (
          <p className="mt-2 text-[11px] text-amber-300/80">
            {t('lsRules.bb.underdogForces')}
          </p>
        ) : null}
      </div>

      {/* Contest & Scoring */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#0a1228]/80 p-4">
        <h4 className="mb-4 text-[11px] font-bold uppercase tracking-wide text-cyan-200/80">{t('lsRules.bb.contestScoring')}</h4>
        <div className="space-y-4">
          <Row label={t('lsRules.bb.contestStructure')}>
            <SelectField
              value={settings.contestStructure}
              options={[
                { value: 'season_long', label: t('lsRules.bb.seasonLong') },
                { value: 'sit_and_go', label: t('lsRules.bb.sitAndGo') },
                // A tournament needs its contest and round calendar, written at creation.
                ...(loadedTournament ? [{ value: 'tournament', label: t('lsRules.bb.tournament') }] : []),
              ]}
              onChange={(v) =>
                patch({
                  contestStructure: v as LoadedSettings['contestStructure'],
                  ...(v === 'tournament' ? { scoringPeriod: 'weekly' as const } : {}),
                })
              }
              disabled={locked}
            />
          </Row>
          <Row label={t('lsRules.bb.scoringModel')}>
            <SelectField
              value={settings.matchupFormat}
              options={[
                { value: 'cumulative', label: t('lsRules.bb.cumulative') },
                { value: 'h2h', label: t('lsRules.bb.h2h') },
              ]}
              onChange={(v) => patch({ matchupFormat: v as LoadedSettings['matchupFormat'] })}
              disabled={locked}
            />
          </Row>
          <Row label={t('lsRules.bb.playoffFormat')}>
            <SelectField
              value={settings.playoffFormat}
              options={[
                { value: 'bracket', label: t('lsRules.bb.bracket') },
                { value: 'advancement', label: t('lsRules.bb.advancement') },
                { value: 'none', label: t('lsRules.bb.noPlayoffs') },
              ]}
              onChange={(v) => patch({ playoffFormat: v as LoadedSettings['playoffFormat'] })}
              disabled={locked}
            />
          </Row>
          <Row label={t('lsRules.bb.scoringPeriod')}>
            <SelectField
              value={settings.scoringPeriod}
              options={[
                { value: 'weekly', label: t('lsRules.bb.weekly') },
                ...(dailyOffered || settings.scoringPeriod === 'daily' ? [{ value: 'daily', label: t('lsRules.bb.daily') }] : []),
              ]}
              onChange={(v) => patch({ scoringPeriod: v as LoadedSettings['scoringPeriod'] })}
              disabled={locked}
              testId="bb-scoring-period"
            />
          </Row>
          <p data-testid="bb-scoring-period-help" className="text-[11px] leading-relaxed text-[#94a3b8]">
            {settings.scoringPeriod === 'daily'
              ? t('lsRules.bb.dailyHelp')
              : dailyOffered
                ? `${t('lsRules.bb.weeklyHelp')} ${t('lsRules.bb.dailyOptionHelp')}`
                : t('lsRules.bb.weeklyHelp')}
          </p>
          {dailyWaitingSeason != null && (dailyOffered || settings.scoringPeriod === 'daily') ? (
            <p
              data-testid="bb-daily-schedule-pending"
              className="rounded-lg border border-[var(--line)] bg-[#38bdf8]/10 px-3 py-2 text-[11px] leading-relaxed text-[#bae6fd]"
            >
              {t('lsRules.bb.dailyWaitingSchedule').replace('{{season}}', String(dailyWaitingSeason))}
            </p>
          ) : null}
          <Row label={t('lsRules.bb.tiebreaker')}>
            <SelectField
              value={settings.tieRule}
              options={[
                { value: 'points_for', label: t('lsRules.bb.tiePoints') },
                { value: 'max_week', label: t('lsRules.bb.tieWeek') },
                { value: 'advance_all', label: t('lsRules.bb.tieAll') },
              ]}
              onChange={(v) => patch({ tieRule: v as LoadedSettings['tieRule'] })}
              disabled={locked}
            />
          </Row>
        </div>
      </div>

      {/* Season structure */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#0a1228]/80 p-4">
        <h4 className="mb-4 text-[11px] font-bold uppercase tracking-wide text-cyan-200/80">{t('lsRules.bb.seasonStructure')}</h4>
        <div className="space-y-4">
          <Row label={t('lsRules.bb.regularSeasonLength')}>
            <IntField
              value={settings.regularSeasonLength}
              onChange={(v) => patch({ regularSeasonLength: v })}
              min={1}
              max={60}
              disabled={locked}
            />
          </Row>
          <Row label={t('lsRules.bb.playoffTeams')}>
            <IntField
              value={settings.playoffTeams}
              onChange={(v) => patch({ playoffTeams: v })}
              min={0}
              max={16}
              disabled={locked}
            />
          </Row>
          {isTournament ? (
            <Row label={t('lsRules.bb.advancementRounds')}>
              <IntField
                value={settings.tournamentAdvancementRounds}
                onChange={(v) => patch({ tournamentAdvancementRounds: v })}
                min={0}
                max={10}
                disabled={locked}
              />
            </Row>
          ) : null}
          {isSitAndGo ? (
            <Row label={t('lsRules.bb.podSize')}>
              <IntField
                value={settings.podSize}
                onChange={(v) => patch({ podSize: v })}
                min={2}
                max={64}
                disabled={locked}
              />
            </Row>
          ) : null}
        </div>
      </div>

      {/* In-season restrictions */}
      <div className="rounded-2xl border border-white/[0.08] bg-[#0a1228]/80 p-4">
        <h4 className="mb-4 text-[11px] font-bold uppercase tracking-wide text-cyan-200/80">{t('lsRules.bb.restrictions')}</h4>
        <div className="space-y-4">
          <Row label={t('lsRules.bb.waivers')}>
            <Toggle
              checked={settings.waiversEnabled}
              onChange={(v) => patch({ waiversEnabled: isUnderdog ? false : v })}
              label={t('lsRules.bb.waivers')}
              disabled={!canEdit || isUnderdog}
            />
          </Row>
          {/* No toggle: trades are off in every Best Ball league (owner's decision 2026-11-07) — best ball
              scoring does not split a traded player's week, and /api/bestball/settings refuses `true`. */}
          <Row label={t('lsRules.bb.trades')}>
            <p className="text-[12px] text-white/55" data-testid="best-ball-trades-off">{t('lsRules.bb.tradesOff')}</p>
          </Row>
          <Row label={t('lsRules.bb.subs')}>
            <Toggle
              checked={settings.substitutionsEnabled}
              onChange={(v) => patch({ substitutionsEnabled: isUnderdog ? false : v })}
              label={t('lsRules.bb.subs')}
              disabled={!canEdit || isUnderdog}
            />
          </Row>
        </div>
        {isUnderdog ? (
          <p className="mt-3 text-[11px] text-white/40">
            {t('lsRules.bb.underdogLocks')}
          </p>
        ) : null}
      </div>

      {/* Sport profile summary */}
      <div className="rounded-2xl border border-white/[0.06] bg-[#0a1228]/40 p-4">
        <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/40">
          {t('lsRules.bb.sportProfile').replace('{{sport}}', profile.label)}
        </h4>
        <p className="text-[12px] text-white/60">
          {t('lsRules.bb.profileLine')
            .replace('{{starters}}', String(starterSeats))
            .replace('{{roster}}', String(profile.recommendedRosterSize))
            .replace('{{period}}', settings.scoringPeriod === 'daily' ? t('lsRules.bb.periodDaily') : t('lsRules.bb.periodWeekly'))}
        </p>
        <ul className="mt-2 space-y-1 text-[11px] text-white/40">
          {profile.notes.map((note) => (
            <li key={note}>— {note}</li>
          ))}
        </ul>
      </div>

      {canEdit ? (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-xl bg-cyan-500 px-5 py-2 text-[13px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? t('lsRules.bb.saving') : t('lsRules.bb.save')}
          </button>
        </div>
      ) : null}
    </div>
  )
}
