'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { LotteryReveal } from '@/components/draft/LotteryReveal'
import type {
  LotteryEligibilityMode,
  LotteryWeightingMode,
  WeightedLotteryConfig,
  WeightedLotteryResult,
  LotteryEligibleTeam,
} from '@/lib/draft-lottery/types'
import { DEFAULT_WEIGHTED_LOTTERY_CONFIG } from '@/lib/draft-lottery/types'

type Effective = {
  leagueSize: number | null
  rosterFormatType: string
  scoringFormatType: string
  playoffTeamCount: number
  regularSeasonWeeks: number
  rookiePickOrderMethod: string
  useMaxPfForNonPlayoff: boolean
  rookieDraftRounds: number
  rookieDraftType: string
  divisionsEnabled: boolean
  tradeDeadlineWeek: number | null
  waiverTypeRecommended: string
  futurePicksYearsOut: number
  rosterSummary: { slotName: string; count: number }[]
  scoringPresetName: string
  taxiSlots?: number
  taxiEligibilityYears?: number
  taxiLockBehavior?: string
  taxiInSeasonMoves?: boolean
  taxiPostseasonMoves?: boolean
  taxiScoringOn?: boolean
  taxiDeadlineWeek?: number | null
  taxiPromotionDeadlineWeek?: number | null
  rookieDraftAutoOpen?: boolean
  rookieDraftAutoOpenSource?: 'commissioner' | 'plan_default' | 'plan_default_predates' | 'free_default'
  rookieDraftCustomOpenDate?: string | null
  rookieDraftWindowLabel?: string | null
}

type Presets = {
  roster: { id: string; label: string; formatType: string }[]
  scoring: { id: string; label: string; formatType: string; summary: string }[]
  playoff: { playoffTeamCount: number; label: string; firstRoundByes: number; playoffStartWeek: number | null }[]
}

type DynastySettingsResponse = {
  effective?: Effective
  presets?: Presets
  constants?: {
    supportedTeamSizes: number[]
    rookiePickOrderMethods: { value: string; label: string }[]
    vetoRecommendationCopy: string
    taxiEligibilityYearsOptions?: { value: number; label: string }[]
    taxiLockBehaviorOptions?: { value: string; label: string }[]
  }
  draftOrderAuditLog?: { id: string; season: number; userId: string; reason: string | null; createdAt: string }[]
  isDynasty?: boolean
  lotteryEligibility?: { eligible: boolean; reason: string; isStartupLeague: boolean }
  weightedLotterySettings?: {
    draftOrderMode: string
    lotteryConfig: WeightedLotteryConfig
    lotteryLastSeed: string | null
    lotteryLastRunAt: string | null
    lotteryLastResult: WeightedLotteryResult | null
  }
}

export default function DynastySettingsPanel({
  leagueId,
  isCommissioner,
}: {
  leagueId: string
  isCommissioner?: boolean
}) {
  const [data, setData] = useState<DynastySettingsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [patch, setPatch] = useState<Record<string, unknown>>({})
  const [lotteryConfig, setLotteryConfig] = useState<WeightedLotteryConfig | null>(null)
  const [lotteryPreview, setLotteryPreview] = useState<LotteryEligibleTeam[] | null>(null)
  const [lotteryLoading, setLotteryLoading] = useState(false)
  const [lotteryResult, setLotteryResult] = useState<WeightedLotteryResult | null>(null)
  const [showLotteryReveal, setShowLotteryReveal] = useState(false)

  const load = useCallback(async () => {
    if (!leagueId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/dynasty-settings`, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        setError(json?.error ?? 'Failed to load dynasty settings')
        setData(null)
      } else {
        setData(json)
      }
    } catch {
      setError('Failed to load dynasty settings')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  const effectiveRookiePickOrder = useMemo(() => {
    const p = patch.rookiePickOrderMethod
    if (typeof p === 'string' && p.length > 0) return p
    return data?.effective?.rookiePickOrderMethod ?? ''
  }, [patch.rookiePickOrderMethod, data?.effective?.rookiePickOrderMethod])

  useEffect(() => {
    const w = data?.weightedLotterySettings?.lotteryConfig
    if (w && typeof w === 'object') {
      setLotteryConfig({ ...DEFAULT_WEIGHTED_LOTTERY_CONFIG, ...w })
    }
  }, [data?.weightedLotterySettings?.lotteryConfig])

  useEffect(() => {
    if (effectiveRookiePickOrder !== 'weighted_lottery') return
    setLotteryConfig((prev) => prev ?? { ...DEFAULT_WEIGHTED_LOTTERY_CONFIG, ...(data?.weightedLotterySettings?.lotteryConfig ?? {}) })
  }, [effectiveRookiePickOrder, data?.weightedLotterySettings?.lotteryConfig])

  const handlePreviewLotteryOdds = async () => {
    if (!leagueId || !lotteryConfig) return
    setLotteryLoading(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft-lottery/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: lotteryConfig }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(typeof json?.error === 'string' ? json.error : 'Preview failed')
        setLotteryPreview(null)
        return
      }
      setLotteryPreview(Array.isArray(json.eligible) ? json.eligible : [])
    } finally {
      setLotteryLoading(false)
    }
  }

  const handleRunLottery = async () => {
    if (!leagueId) return
    if (
      !window.confirm(
        'Run the weighted lottery now? This will set the rookie draft order. This action cannot be undone.'
      )
    ) {
      return
    }
    setLotteryLoading(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft-lottery/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      })
      const json = await res.json().catch(() => null)
      if (res.ok && json && typeof json === 'object' && Array.isArray((json as WeightedLotteryResult).slotOrder)) {
        setLotteryResult(json as WeightedLotteryResult)
        setShowLotteryReveal(true)
      } else {
        setError(typeof (json as { error?: string })?.error === 'string' ? (json as { error: string }).error : 'Run failed')
      }
    } finally {
      setLotteryLoading(false)
    }
  }

  const save = useCallback(async () => {
    if (!leagueId || !isCommissioner || Object.keys(patch).length === 0) return
    setSaving(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/dynasty-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (res.ok) {
        const method = patch.rookiePickOrderMethod ?? data?.effective?.rookiePickOrderMethod
        if (method === 'weighted_lottery' && lotteryConfig) {
          await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft-lottery/config`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lotteryConfig }),
          }).catch(() => {})
        }
        setPatch({})
        await load()
      } else {
        const json = await res.json().catch(() => ({}))
        setError(json?.error ?? 'Save failed')
      }
    } catch {
      setError('Save failed')
    } finally {
      setSaving(false)
    }
  }, [leagueId, isCommissioner, patch, load, lotteryConfig, data?.effective?.rookiePickOrderMethod])

  if (loading) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Dynasty Settings</h3>
        <p className="mt-2 text-xs text-white/65">Loading…</p>
      </section>
    )
  }

  if (error) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Dynasty Settings</h3>
        <p className="mt-2 text-xs text-red-400/90">{error}</p>
      </section>
    )
  }

  if (!data?.isDynasty) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Dynasty Settings</h3>
        <p className="mt-2 text-xs text-white/65">This league is not a dynasty league. Roster, scoring, and playoff settings apply to all leagues; dynasty-specific options (rookie draft order, anti-tank, trade deadline) appear here for dynasty, Devy, and C2C leagues.</p>
      </section>
    )
  }

  const effective = data.effective
  const presets = data.presets
  const constants = data.constants

  if (data.isDynasty && !effective) {
    return (
      <section className="rounded-xl border border-white/10 bg-black/20 p-4">
        <h3 className="text-sm font-semibold text-white">Dynasty Settings</h3>
        <p className="mt-2 text-xs text-white/65">Unable to load roster and scoring details. Try refreshing the page.</p>
      </section>
    )
  }

  return (
    <section className="space-y-6 rounded-xl border border-white/10 bg-black/20 p-4">
      <h3 className="text-sm font-semibold text-white">Dynasty Settings</h3>
      <p className="text-xs text-white/65">
        Shared base for standard Dynasty, Devy, and C2C. Roster, scoring, and playoff presets; rookie draft order and waiver/trade defaults.
      </p>

      {/* Roster summary */}
      {effective && (
        <div>
          <h4 className="text-xs font-medium text-white/80">Roster</h4>
          <p className="mt-1 text-xs text-white/65">
            Format: <span className="text-white/90">{effective.rosterFormatType}</span>
            {effective.rosterSummary?.length > 0 && (
              <> · {effective.rosterSummary.map((s) => `${s.slotName} ${s.count}`).join(', ')}</>
            )}
          </p>
          {presets && presets.roster.length > 0 && isCommissioner && (
            <select
              className="mt-2 rounded border border-white/20 bg-black/40 px-2 py-1 text-xs text-white"
              value={effective.rosterFormatType}
              onChange={(e) => {
                setPatch((p) => ({ ...p, roster_format_type: e.target.value }))
              }}
            >
              {presets.roster.map((r) => (
                <option key={r.id} value={r.formatType}>{r.label}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Scoring summary */}
      {effective && (
        <div>
          <h4 className="text-xs font-medium text-white/80">Scoring</h4>
          <p className="mt-1 text-xs text-white/65">
            {effective.scoringPresetName} ({effective.scoringFormatType})
          </p>
          {presets && presets.scoring.length > 0 && isCommissioner && (
            <select
              className="mt-2 rounded border border-white/20 bg-black/40 px-2 py-1 text-xs text-white"
              value={effective.scoringFormatType}
              onChange={(e) => {
                setPatch((p) => ({ ...p, scoring_format_type: e.target.value }))
              }}
            >
              {presets.scoring.map((s) => (
                <option key={s.id} value={s.formatType}>{s.label}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Playoff */}
      {effective && (
        <div>
          <h4 className="text-xs font-medium text-white/80">Playoffs</h4>
          <p className="mt-1 text-xs text-white/65">
            {effective.playoffTeamCount} teams · Start week from structure · Regular season {effective.regularSeasonWeeks} weeks
          </p>
          {presets && presets.playoff.length > 0 && isCommissioner && (
            <select
              className="mt-2 rounded border border-white/20 bg-black/40 px-2 py-1 text-xs text-white"
              value={effective.playoffTeamCount}
              onChange={(e) => {
                setPatch((p) => ({ ...p, playoff_team_count: Number(e.target.value) }))
              }}
            >
              {presets.playoff.map((p) => (
                <option key={p.playoffTeamCount} value={p.playoffTeamCount}>{p.label}</option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* Rookie draft / anti-tank */}
      {effective && constants && (
        <div>
          <h4 className="text-xs font-medium text-white/80">Rookie draft order</h4>
          <p className="mt-1 text-xs text-white/65">
            Method: <span className="text-white/90">{effective.rookiePickOrderMethod}</span>
            {effective.useMaxPfForNonPlayoff && ' (non-playoff: reverse Max PF)'} · Rounds: {effective.rookieDraftRounds} · Type: {effective.rookieDraftType}
          </p>
          {isCommissioner && (
            <div className="mt-2 flex flex-wrap gap-2">
              <select
                className="rounded border border-white/20 bg-black/40 px-2 py-1 text-xs text-white"
                value={effectiveRookiePickOrder || effective.rookiePickOrderMethod}
                onChange={(e) => setPatch((p) => ({ ...p, rookiePickOrderMethod: e.target.value }))}
              >
                {constants.rookiePickOrderMethods.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <select
                className="rounded border border-white/20 bg-black/40 px-2 py-1 text-xs text-white"
                value={effective.rookieDraftType}
                onChange={(e) => setPatch((p) => ({ ...p, rookieDraftType: e.target.value }))}
              >
                <option value="linear">Linear</option>
                <option value="snake">Snake</option>
              </select>
              <input
                type="number"
                min={1}
                max={10}
                className="w-14 rounded border border-white/20 bg-black/40 px-2 py-1 text-xs text-white"
                value={effective.rookieDraftRounds}
                onChange={(e) => setPatch((p) => ({ ...p, rookieDraftRounds: Number(e.target.value) || 4 }))}
              />
              <label className="flex items-center gap-1 text-xs text-white/80">
                <input
                  type="checkbox"
                  checked={effective.useMaxPfForNonPlayoff}
                  onChange={(e) => setPatch((p) => ({ ...p, useMaxPfForNonPlayoff: e.target.checked }))}
                />
                Max PF for non-playoff
              </label>
            </div>
          )}

          {(effectiveRookiePickOrder === 'weighted_lottery' || effective?.rookiePickOrderMethod === 'weighted_lottery') && (
            <div className="mt-4 rounded-xl border border-cyan-500/20 bg-cyan-500/[0.04] p-4 space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-base">🎱</span>
                <h4 className="text-sm font-semibold text-cyan-300">Weighted Lottery Settings</h4>
              </div>

              {data.lotteryEligibility?.isStartupLeague && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
                  ⚠️ Weighted lottery is only available for established dynasty leagues (year 2+). This appears to
                  be a startup league.
                </div>
              )}

              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3 text-xs text-white/55 space-y-1">
                <p className="font-semibold text-white/70">How it works</p>
                <p>
                  Non-playoff teams receive lottery balls based on their record. Worst teams get more balls but the
                  worst team is NOT guaranteed the #1 pick. This reduces tanking incentives.
                </p>
                <p>Remaining picks after the lottery block use reverse standings order from the engine.</p>
              </div>

              {lotteryConfig && (
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-xs text-white/70">
                    Teams in lottery
                    <select
                      className="rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                      value={lotteryConfig.lotteryTeamCount ?? 6}
                      onChange={(e) =>
                        setLotteryConfig((c) =>
                          c
                            ? { ...c, lotteryTeamCount: Number(e.target.value) }
                            : { ...DEFAULT_WEIGHTED_LOTTERY_CONFIG, lotteryTeamCount: Number(e.target.value) }
                        )
                      }
                    >
                      {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
                        <option key={n} value={n}>
                          {n} teams
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1 text-xs text-white/70">
                    Lottery picks (top N)
                    <select
                      className="rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                      value={lotteryConfig.lotteryPickCount ?? 6}
                      onChange={(e) =>
                        setLotteryConfig((c) =>
                          c
                            ? { ...c, lotteryPickCount: Number(e.target.value) }
                            : { ...DEFAULT_WEIGHTED_LOTTERY_CONFIG, lotteryPickCount: Number(e.target.value) }
                        )
                      }
                    >
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                        <option key={n} value={n}>
                          Top {n} pick{n > 1 ? 's' : ''}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1 text-xs text-white/70">
                    Weighting method
                    <select
                      className="rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                      value={lotteryConfig.weightingMode ?? 'inverse_standings'}
                      onChange={(e) =>
                        setLotteryConfig((c) =>
                          c
                            ? { ...c, weightingMode: e.target.value as LotteryWeightingMode }
                            : { ...DEFAULT_WEIGHTED_LOTTERY_CONFIG, weightingMode: e.target.value as LotteryWeightingMode }
                        )
                      }
                    >
                      <option value="inverse_standings">Inverse standings (standard)</option>
                      <option value="inverse_points_for">Inverse points scored</option>
                      <option value="inverse_max_pf">Inverse max PF</option>
                    </select>
                  </label>

                  <label className="flex flex-col gap-1 text-xs text-white/70">
                    Eligibility
                    <select
                      className="rounded border border-white/20 bg-black/40 px-2 py-1 text-white"
                      value={lotteryConfig.eligibilityMode ?? 'non_playoff'}
                      onChange={(e) =>
                        setLotteryConfig((c) =>
                          c
                            ? { ...c, eligibilityMode: e.target.value as LotteryEligibilityMode }
                            : {
                                ...DEFAULT_WEIGHTED_LOTTERY_CONFIG,
                                eligibilityMode: e.target.value as LotteryEligibilityMode,
                              }
                        )
                      }
                    >
                      <option value="non_playoff">Non-playoff teams only</option>
                      <option value="bottom_n">Bottom N teams</option>
                      <option value="all_teams">All teams</option>
                    </select>
                  </label>
                </div>
              )}

              {isCommissioner && data.lotteryEligibility?.eligible && (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={() => void handlePreviewLotteryOdds()}
                    disabled={lotteryLoading || !lotteryConfig}
                    className="rounded-lg border border-white/20 bg-white/[0.06] px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/[0.10] transition disabled:opacity-50"
                  >
                    {lotteryLoading ? 'Loading…' : 'Preview lottery odds →'}
                  </button>

                  {lotteryPreview && lotteryPreview.length > 0 && (
                    <div>
                      <p className="text-xs font-semibold text-white/60 mb-2 uppercase tracking-wider">
                        Lottery Odds Preview
                      </p>
                      <div className="rounded-lg border border-white/[0.08] overflow-hidden">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-white/[0.06] bg-white/[0.03]">
                              <th className="px-3 py-2 text-left text-white/50 font-medium">Team</th>
                              <th className="px-3 py-2 text-right text-white/50 font-medium">Record</th>
                              <th className="px-3 py-2 text-right text-white/50 font-medium">Balls</th>
                              <th className="px-3 py-2 text-right text-white/50 font-medium">Odds #1</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lotteryPreview.map((team, i) => (
                              <tr
                                key={team.rosterId}
                                className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.02]"
                              >
                                <td className="px-3 py-2 text-white/80 font-medium">{team.displayName}</td>
                                <td className="px-3 py-2 text-right text-white/50">
                                  {team.wins}-{team.losses}
                                </td>
                                <td className="px-3 py-2 text-right text-white/70">{team.weight}</td>
                                <td className="px-3 py-2 text-right">
                                  <span
                                    className={`font-semibold ${i === 0 ? 'text-cyan-400' : 'text-white/60'}`}
                                  >
                                    {team.oddsPercent.toFixed(1)}%
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <button
                        type="button"
                        onClick={() => void handleRunLottery()}
                        disabled={lotteryLoading}
                        className="mt-3 w-full rounded-xl bg-gradient-to-r from-cyan-500 to-violet-500 px-4 py-2.5 text-sm font-bold text-white hover:from-cyan-400 hover:to-violet-400 transition disabled:opacity-50"
                      >
                        🎱 Run Weighted Lottery
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {lotteryResult && showLotteryReveal && (
            <LotteryReveal result={lotteryResult} onClose={() => setShowLotteryReveal(false)} />
          )}
        </div>
      )}

      {/* Rookie draft calendar: auto-open on the sport's window (lib/dynasty-core/rookieDraftCalendar.ts) */}
      {effective && (
        <div>
          <h4 className="text-xs font-medium text-white/80">Rookie draft calendar</h4>
          <p className="mt-1 text-xs text-white/65">
            {effective.rookieDraftWindowLabel
              ? <>Default window: <span className="text-white/90">{effective.rookieDraftWindowLabel}</span>, after the real draft. </>
              : null}
            {effective.rookieDraftAutoOpen
              ? effective.rookieDraftCustomOpenDate
                ? `Opens automatically on ${effective.rookieDraftCustomOpenDate}.`
                : 'Opens automatically when the window opens.'
              : effective.rookieDraftAutoOpenSource === 'plan_default_predates'
                ? 'Auto-open is off for this offseason, which started before AF Commissioner opened rookie drafts automatically. Turn it on below.'
                : 'Created by the commissioner (auto-open is off).'}
            {effective.rookieDraftAutoOpenSource === 'plan_default' && ' Included with AF Commissioner.'}
            {' '}An opened draft waits in pre-draft until the commissioner starts it.
          </p>
          {isCommissioner && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1 text-xs text-white/80">
                <input
                  type="checkbox"
                  checked={typeof patch.rookieDraftAutoOpen === 'boolean' ? patch.rookieDraftAutoOpen : Boolean(effective.rookieDraftAutoOpen)}
                  onChange={(e) => setPatch((p) => ({ ...p, rookieDraftAutoOpen: e.target.checked }))}
                />
                Open the rookie draft automatically
              </label>
              <label className="flex items-center gap-1 text-xs text-white/80">
                Custom open date
                <input
                  type="date"
                  className="rounded border border-white/20 bg-black/40 px-2 py-0.5 text-xs text-white"
                  value={
                    typeof patch.rookieDraftCustomOpenDate === 'string'
                      ? patch.rookieDraftCustomOpenDate
                      : patch.rookieDraftCustomOpenDate === null
                        ? ''
                        : effective.rookieDraftCustomOpenDate ?? ''
                  }
                  onChange={(e) => setPatch((p) => ({ ...p, rookieDraftCustomOpenDate: e.target.value || null }))}
                />
              </label>
            </div>
          )}
        </div>
      )}

      {/* Taxi squad (PROMPT 3/5) */}
      {effective && (effective.taxiSlots != null || effective.taxiEligibilityYears != null) && (
        <div>
          <h4 className="text-xs font-medium text-white/80">Taxi squad</h4>
          <p className="mt-1 text-xs text-white/65">
            Slots: {effective.taxiSlots ?? 4} · Eligibility: {effective.taxiEligibilityYears === 1 ? 'Rookies only' : effective.taxiEligibilityYears === 2 ? 'Rookies + 2nd year' : 'Rookies + 2nd + 3rd year'} · Lock: {effective.taxiLockBehavior === 'once_promoted_no_return' ? 'Once promoted cannot return' : effective.taxiLockBehavior === 'free_move' ? 'Can move freely' : 'Commissioner custom'}
            {effective.taxiInSeasonMoves !== false && ' · In-season moves on'}
            {effective.taxiPostseasonMoves && ' · Postseason moves on'}
            {effective.taxiScoringOn && ' · Scoring on taxi'}
            {(effective.taxiDeadlineWeek ?? effective.taxiPromotionDeadlineWeek) != null && ` · Deadlines: ${effective.taxiDeadlineWeek ?? '—'}/${effective.taxiPromotionDeadlineWeek ?? '—'}`}
          </p>
          {/* Taxi editing is consolidated in Commissioner settings → Roster → Taxi squad. */}
          {isCommissioner && (
            <p className="mt-2 text-xs text-white/50" data-testid="dynasty-taxi-moved-note">
              Edit taxi squad settings in Commissioner settings → Roster → Taxi squad.
            </p>
          )}
        </div>
      )}

      {/* Trade deadline, divisions, waivers */}
      {effective && (
        <div>
          <h4 className="text-xs font-medium text-white/80">Waivers & trades</h4>
          <p className="mt-1 text-xs text-white/65">
            Waiver: {effective.waiverTypeRecommended} · Future picks: {effective.futurePicksYearsOut} years
            {effective.tradeDeadlineWeek != null && ` · Trade deadline: Week ${effective.tradeDeadlineWeek}`}
            {effective.divisionsEnabled && ' · Divisions enabled'}
          </p>
          {constants?.vetoRecommendationCopy && (
            <p className="mt-1 text-xs text-white/50 italic">{constants.vetoRecommendationCopy}</p>
          )}
          {isCommissioner && (
            <div className="mt-2 flex flex-wrap gap-2 items-center">
              <label className="text-xs text-white/80">
                Trade deadline week:{' '}
                <input
                  type="number"
                  min={1}
                  max={18}
                  className="w-12 rounded border border-white/20 bg-black/40 px-1 py-0.5 text-white"
                  value={effective.tradeDeadlineWeek ?? ''}
                  placeholder="—"
                  onChange={(e) => {
                    const v = e.target.value === '' ? null : Number(e.target.value)
                    setPatch((p) => ({ ...p, tradeDeadlineWeek: v }))
                  }}
                />
              </label>
              <label className="flex items-center gap-1 text-xs text-white/80">
                <input
                  type="checkbox"
                  checked={effective.divisionsEnabled}
                  onChange={(e) => setPatch((p) => ({ ...p, divisionsEnabled: e.target.checked }))}
                />
                Divisions
              </label>
            </div>
          )}
        </div>
      )}

      {isCommissioner && Object.keys(patch).length > 0 && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded bg-white/90 px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button
            type="button"
            onClick={() => setPatch({})}
            className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/80"
          >
            Reset
          </button>
        </div>
      )}

      {(data.draftOrderAuditLog?.length ?? 0) > 0 && (
        <div>
          <h4 className="text-xs font-medium text-white/80">Draft order overrides (audit)</h4>
          <ul className="mt-1 list-inside list-disc text-xs text-white/65">
            {(data.draftOrderAuditLog ?? []).slice(0, 5).map((l) => (
              <li key={l.id}>Season {l.season} · {l.reason ?? 'Override'}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
