'use client'

import { useEffect, useState } from 'react'
import { useAfSubGate } from '@/hooks/useAfSubGate'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, Sparkles } from 'lucide-react'
import { PlayerImage } from '@/app/components/PlayerImage'
import type { PlayerMap } from '@/lib/hooks/useSleeperPlayers'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ProjectionDisplay } from '@/components/weather/ProjectionDisplay'
import type { IdpPlayerCardPayload } from '@/lib/idp-projections/idpPlayerCard'
import type { IdpSalaryRecordJson } from '@/app/idp/hooks/useIdpTeamCap'
import { mockContractUi } from '@/app/idp/hooks/useIdpTeamCap'
import type { DefenderEvaluation } from '@/lib/idp/ai/idpCapChimmy'

export type IDPPlayerModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  leagueId: string
  rosterId?: string | null
  playerId: string
  name: string
  position: string
  team?: string | null
  sport: string
  week: number
  players: PlayerMap
  contract?: IdpSalaryRecordJson | null
}

export function IDPPlayerModal({
  open,
  onOpenChange,
  leagueId,
  rosterId,
  playerId,
  name,
  position,
  team,
  sport,
  week,
  players,
  contract: contractProp,
}: IDPPlayerModalProps) {
  const router = useRouter()
  const { data: session } = useSession()
  const userId = session?.user?.id ?? ''
  const p = players[playerId]
  /*
   * ⚠ EVERY NUMBER BELOW USED TO BE A HASH OF `playerId`, RENDERED BESIDE THE REAL NAME AND
   * PHOTOGRAPH ABOVE. The box score came from `mockStatPills`, the points from `mockIdpPoints`,
   * the archetype from `idpRoleLabel`, the snap share from `40 + playerId.length % 55`, the
   * matchup from `playerId.length % 3` and the opponent rank from `playerId.charCodeAt(0) % 22`.
   * Nothing on screen said so. They are all served from game rows now, and a figure without a
   * row is named as absent rather than filled in.
   */
  const [card, setCard] = useState<IdpPlayerCardPayload | null>(null)
  const [cardLoading, setCardLoading] = useState(false)

  useEffect(() => {
    if (!open || !leagueId || !playerId) return
    let cancelled = false
    setCardLoading(true)
    setCard(null)
    fetch(
      `/api/idp/players?view=player-card&leagueId=${encodeURIComponent(
        leagueId,
      )}&playerId=${encodeURIComponent(playerId)}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled) setCard((j ?? null) as IdpPlayerCardPayload | null)
      })
      .catch(() => {
        if (!cancelled) setCard(null)
      })
      .finally(() => {
        if (!cancelled) setCardLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, leagueId, playerId])

  const scoredWeeks = card?.weeks.filter((w) => w.points != null) ?? []
  const peakWeek = scoredWeeks.reduce((max, w) => Math.max(max, w.points ?? 0), 0)

  const [aiLoading, setAiLoading] = useState(false)
  const [aiEval, setAiEval] = useState<DefenderEvaluation | null>(null)
  const [aiNarrative, setAiNarrative] = useState<string | null>(null)
  const { handleApiResponse } = useAfSubGate('commissioner_idp_analysis')

  const mock = mockContractUi(playerId)
  const contract = contractProp
  const salaryM = contract?.salary ?? mock.salaryM
  const yearsRem = contract?.yearsRemaining ?? mock.yearsRemaining
  const startYear = contract?.contractStartYear ?? new Date().getFullYear()
  const totalRemainingValue = salaryM * yearsRem
  const cutPenalty =
    contract?.cutPenaltyCurrent ??
    (contract
      ? contract.salary + contract.salary * 0.25 * Math.max(0, contract.yearsRemaining - 1)
      : mock.salaryM * 1.25)
  const expiresYear = startYear + yearsRem - 1
  const isExpiring = yearsRem <= 1
  const isTagged = contract?.isFranchiseTagged || contract?.status === 'franchise_tagged'

  const [cutOpen, setCutOpen] = useState(false)
  const [extendOpen, setExtendOpen] = useState(false)
  const [tagOpen, setTagOpen] = useState(false)
  const [extendYears, setExtendYears] = useState(1)
  const [capActionLoading, setCapActionLoading] = useState(false)
  const [capActionError, setCapActionError] = useState<string | null>(null)

  const extensionBoost = contract?.extensionBoostPct ?? 0.1
  const newSalaryPreview = salaryM * (1 + extensionBoost * extendYears)

  const runCapPatch = async (body: Record<string, unknown>) => {
    if (!rosterId) {
      setCapActionError('Roster not linked — open league from team context.')
      return
    }
    setCapActionLoading(true)
    setCapActionError(null)
    try {
      const res = await fetch('/api/idp/cap', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ leagueId, rosterId, ...body }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setCapActionError(data.error ?? 'Request failed')
        return
      }
      setCutOpen(false)
      setExtendOpen(false)
      setTagOpen(false)
      router.refresh()
      onOpenChange(false)
    } finally {
      setCapActionLoading(false)
    }
  }

  const runAiAnalysis = async () => {
    if (!userId) return
    setAiLoading(true)
    setAiEval(null)
    setAiNarrative(null)
    try {
      const res = await fetch('/api/idp/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          leagueId,
          week,
          action: 'defender_eval',
          managerId: userId,
          playerId,
        }),
      })
      if (!(await handleApiResponse(res))) return
      const data = (await res.json().catch(() => ({}))) as {
        evaluation?: DefenderEvaluation
        error?: string
      }
      if (data.evaluation) {
        setAiEval(data.evaluation)
      } else {
        setAiNarrative(data.error ?? 'Could not load evaluation.')
      }
    } finally {
      setAiLoading(false)
    }
  }

  const overallTone =
    aiEval == null
      ? 'text-white/50'
      : aiEval.overallGrade >= 72
        ? 'text-[color:var(--cap-green)]'
        : aiEval.overallGrade >= 48
          ? 'text-[color:var(--cap-amber)]'
          : 'text-red-300'

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto border border-[color:var(--idp-border)] bg-[color:var(--idp-panel)] text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-start gap-3 pr-8 text-left text-base">
              <PlayerImage
                sleeperId={playerId}
                sport={sport}
                name={name}
                position={position}
                espnId={p?.espn_id}
                nbaId={p?.nba_id}
                size={48}
                variant="round"
              />
              <div className="min-w-0">
                <p className="truncate font-bold">{name}</p>
                <p className="text-sm font-normal text-white/55">
                  {team ?? '—'} · {position}
                </p>
              </div>
            </DialogTitle>
          </DialogHeader>

          <section className="space-y-2 border-t border-white/[0.06] pt-3">
            <h4 className="text-[11px] font-bold uppercase tracking-wide text-white/40">
              Season to date
            </h4>
            {cardLoading ? (
              <p className="text-sm text-white/45">Loading game log…</p>
            ) : !card || card.state !== 'ok' ? (
              <p className="text-sm text-white/45">
                {card?.notes?.[0] ?? 'No game rows on file for this player.'}
              </p>
            ) : (
              <>
                {card.stats.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {card.stats.map((s) => (
                      <div
                        key={s.key}
                        className="flex justify-between rounded-md border border-white/[0.06] bg-black/20 px-2 py-1.5"
                      >
                        <span className="text-white/50">{s.label}</span>
                        <span className="font-semibold tabular-nums">
                          {s.total}
                          <span className="ml-1 font-normal text-white/35">{s.perGame}/g</span>
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
                <p className="text-xs text-white/40">
                  {card.games} game{card.games === 1 ? '' : 's'} with a defensive snap count ·{' '}
                  {card.season} season
                </p>
                {card.seasonPoints ? (
                  <p className="text-sm">
                    <span className="text-white/45">IDP points:</span>{' '}
                    <span className="font-bold text-[color:var(--idp-defense)] tabular-nums">
                      {card.seasonPoints.total}
                    </span>{' '}
                    <span className="text-white/35">
                      total · {card.seasonPoints.perGame}/game over {card.seasonPoints.games}{' '}
                      priced game{card.seasonPoints.games === 1 ? '' : 's'}
                    </span>
                  </p>
                ) : null}
              </>
            )}
          </section>

          {scoredWeeks.length > 0 ? (
            <section className="space-y-2 border-t border-white/[0.06] pt-3">
              <h4 className="text-[11px] font-bold uppercase tracking-wide text-white/40">
                Week by week
              </h4>
              {/* Real bars from the priced game log. The gradient this replaces was captioned
                  "Week-by-week sparkline (placeholder)" and drew nothing at all. */}
              <div className="flex h-12 items-end gap-1">
                {scoredWeeks.map((w) => (
                  <div
                    key={w.week}
                    className="flex-1 rounded-sm bg-[color:var(--idp-defense)]/60"
                    style={{
                      height: `${peakWeek > 0 ? Math.max(6, ((w.points ?? 0) / peakWeek) * 100) : 6}%`,
                    }}
                    title={`Week ${w.week}: ${w.points} pts${w.snaps != null ? ` · ${w.snaps} snaps` : ''}`}
                  />
                ))}
              </div>
              <p className="text-xs text-white/40">
                Weeks {scoredWeeks[0]?.week}–{scoredWeeks[scoredWeeks.length - 1]?.week} · peak{' '}
                {peakWeek} pts
              </p>
            </section>
          ) : null}

          {card?.role ? (
            <section className="space-y-2 border-t border-white/[0.06] pt-3">
              <h4 className="text-[11px] font-bold uppercase tracking-wide text-white/40">Role</h4>
              <div className="space-y-1.5">
                {card.role.lines.map((line) => (
                  <p key={line.label} className="text-sm">
                    <span className="text-white/45">{line.label}:</span>{' '}
                    {line.value ? (
                      <span className="text-white/85">{line.value}</span>
                    ) : (
                      <span className="text-white/40 italic">not derivable</span>
                    )}
                    <span className="block text-xs text-white/30">{line.basis}</span>
                  </p>
                ))}
              </div>
            </section>
          ) : null}

          {card?.projection ? (
            <section className="space-y-2 border-t border-white/[0.06] pt-3">
              <h4 className="text-[11px] font-bold uppercase tracking-wide text-white/40">
                Projection
              </h4>
              <p className="text-sm text-white/70 flex flex-wrap items-center gap-2">
                <ProjectionDisplay
                  projection={card.projection.points}
                  suffix=" / game"
                  pointsClassName="text-sm text-white/70"
                  afCrestProps={{
                    playerId,
                    playerName: name,
                    sport,
                    position,
                    week,
                    season: card.season,
                    size: 'sm',
                  }}
                />
                <span className="text-xs text-white/35">
                  recency-weighted from his last {card.projection.games} priced game
                  {card.projection.games === 1 ? '' : 's'} — backward-looking, not a forecast
                </span>
              </p>
            </section>
          ) : null}

          {card && card.notes.length > 0 ? (
            <section className="space-y-1 border-t border-white/[0.06] pt-3">
              {card.notes.map((n) => (
                <p key={n} className="text-xs leading-relaxed text-white/35">
                  {n}
                </p>
              ))}
            </section>
          ) : null}

          <section className="space-y-2 border-t border-white/[0.06] pt-3" data-testid="idp-player-contract-panel">
            <h4 className="text-[11px] font-bold uppercase tracking-wide text-[color:var(--cap-contract)]/90">
              Contract
            </h4>
            <div className="rounded-lg border border-white/[0.08] bg-black/25 px-3 py-2 text-sm text-white/85">
              <p>
                <span className="text-white/45">Salary:</span>{' '}
                <span className="font-semibold text-white">${salaryM.toFixed(1)}M</span> / year
              </p>
              <p>
                <span className="text-white/45">Years remaining:</span> {yearsRem}
              </p>
              <p>
                <span className="text-white/45">Contract expires:</span> {expiresYear}
              </p>
              <p>
                <span className="text-white/45">Total remaining value:</span>{' '}
                <span className="font-semibold">${totalRemainingValue.toFixed(1)}M</span>
              </p>
              <p>
                <span className="text-white/45">Cut penalty (dead money):</span>{' '}
                <span className="text-[color:var(--cap-dead)]">${cutPenalty.toFixed(1)}M</span>
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {isExpiring ? (
                <span className="rounded-full border border-[color:var(--cap-amber)]/40 bg-[color:var(--cap-amber)]/10 px-2 py-0.5 text-[10px] font-semibold text-amber-100">
                  Expiring Contract
                </span>
              ) : null}
              {isTagged ? (
                <span className="rounded-full border border-amber-400/45 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-50">
                  Franchise Tagged
                </span>
              ) : null}
            </div>
            {capActionError ? (
              <p className="text-[11px] text-red-300">{capActionError}</p>
            ) : null}
          </section>

          {aiEval || aiNarrative ? (
            <section className="space-y-3 border-t border-white/[0.06] pt-3" data-testid="idp-player-ai-panel">
              <h4 className="text-[11px] font-bold uppercase tracking-wide text-cyan-200/90">AI evaluation</h4>
              {aiEval ? (
                <div className="space-y-3 rounded-lg border border-cyan-500/20 bg-cyan-950/10 p-3">
                  <div className="flex items-center gap-4">
                    <div
                      className={`relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 border-white/10 bg-black/30 text-lg font-bold ${overallTone}`}
                      style={{
                        borderColor:
                          aiEval.overallGrade >= 72
                            ? 'var(--cap-green)'
                            : aiEval.overallGrade >= 48
                              ? 'var(--cap-amber)'
                              : 'var(--cap-red)',
                      }}
                    >
                      {Math.round(aiEval.overallGrade)}
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wide text-white/45">Overall</p>
                      <p className={`text-2xl font-bold ${overallTone}`}>{aiEval.overallGrade.toFixed(1)}/100</p>
                      <span className="mt-1 inline-block rounded-full border border-white/15 bg-white/5 px-2 py-0.5 text-[10px] font-bold text-white/90">
                        {aiEval.verdict.replace(/_/g, ' ')}
                      </span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-3">
                    {[
                      ['Weekly start', aiEval.weeklyStartGrade],
                      ['Dynasty', aiEval.dynastyGrade],
                      ['Salary eff.', aiEval.salaryEfficiencyGrade],
                      ['Contract val.', aiEval.contractValueGrade],
                      ['Boom/Bust', aiEval.boomBustScore],
                      ['Floor', aiEval.floorScore],
                      ['Risk', aiEval.riskScore],
                      ['Trade value', aiEval.tradeValueScore],
                      ['Waiver prio.', aiEval.waiverPriorityScore],
                      ['Trend', aiEval.trendScore],
                    ].map(([label, val]) => (
                      <div key={String(label)} className="rounded-md border border-white/[0.06] bg-black/25 px-2 py-1.5">
                        <p className="text-[9px] text-white/40">{label}</p>
                        <p className="font-mono font-semibold text-white/90">{typeof val === 'number' ? val.toFixed(0) : val}</p>
                      </div>
                    ))}
                  </div>
                  <ul className="list-inside list-disc space-y-1 text-[11px] text-white/80">
                    {aiEval.topReasons.map((r) => (
                      <li key={r.slice(0, 24)}>{r}</li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-amber-200/85">Risk: {aiEval.mainRisk}</p>
                  <p className="text-[10px] text-white/45">
                    Confidence: <span className="font-semibold text-white/70">{aiEval.confidence}</span>
                  </p>
                </div>
              ) : null}
              {aiNarrative ? (
                <p className="text-sm leading-relaxed text-white/85" data-testid="idp-player-ai-narrative">
                  {aiNarrative}
                </p>
              ) : null}
            </section>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-white/[0.06] pt-4">
            <button
              type="button"
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
            >
              Start / Sit
            </button>
            <button
              type="button"
              className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
            >
              Add / Drop
            </button>
            {rosterId && contract ? (
              <>
                <button
                  type="button"
                  onClick={() => setCutOpen(true)}
                  className="rounded-lg border border-red-500/35 bg-red-950/30 px-3 py-2 text-xs font-semibold text-red-100"
                  data-testid="idp-contract-cut"
                >
                  Cut Player
                </button>
                <button
                  type="button"
                  onClick={() => setExtendOpen(true)}
                  className="rounded-lg border border-sky-500/35 bg-sky-950/35 px-3 py-2 text-xs font-semibold text-sky-100"
                  data-testid="idp-contract-extend"
                >
                  Extend
                </button>
                <button
                  type="button"
                  onClick={() => setTagOpen(true)}
                  className="rounded-lg border border-amber-500/35 bg-amber-950/35 px-3 py-2 text-xs font-semibold text-amber-100"
                  data-testid="idp-contract-tag"
                >
                  Franchise Tag
                </button>
              </>
            ) : null}
            <Link
              href={rosterId ? `/league/${leagueId}?view=trades` : '#'}
              className={`rounded-lg border border-cyan-500/30 bg-cyan-950/40 px-3 py-2 text-xs font-semibold text-cyan-100 ${!rosterId ? 'pointer-events-none opacity-50' : ''}`}
            >
              Propose Trade
            </Link>
            <button
              type="button"
              onClick={() => void runAiAnalysis()}
              disabled={aiLoading || !userId}
              className="inline-flex items-center gap-2 rounded-lg border border-amber-500/35 bg-amber-950/35 px-3 py-2 text-xs font-semibold text-amber-100 disabled:opacity-50"
              data-testid="idp-player-ai-analysis"
            >
              {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5 text-amber-200/90" />}
              AI Analysis (AfSub)
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={cutOpen} onOpenChange={setCutOpen}>
        <DialogContent className="border border-white/[0.08] bg-[#0f141c] text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm cut</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-white/75">
            Cutting {name} will create ~${cutPenalty.toFixed(1)}M in dead money. Are you sure?
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCutOpen(false)}
              className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white/80"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={capActionLoading || !contract}
              onClick={() =>
                void runCapPatch({
                  action: 'cut',
                  salaryRecordId: contract?.id,
                  playerId,
                })
              }
              className="rounded-lg border border-red-500/40 bg-red-900/40 px-3 py-2 text-xs font-semibold text-red-100"
            >
              {capActionLoading ? '…' : 'Confirm Cut'}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={extendOpen} onOpenChange={setExtendOpen}>
        <DialogContent className="border border-white/[0.08] bg-[#0f141c] text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Extend contract</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-white/70">
            Add years to the contract (+{Math.round(extensionBoost * 100)}% salary boost per extension year).
          </p>
          <div className="flex gap-2 py-2">
            {([1, 2, 3] as const).map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => setExtendYears(y)}
                className={`flex-1 rounded-lg border px-2 py-2 text-xs font-bold ${
                  extendYears === y ? 'border-sky-400/50 bg-sky-500/20 text-sky-100' : 'border-white/10 text-white/55'
                }`}
              >
                {y} yr
              </button>
            ))}
          </div>
          <p className="text-[11px] text-white/50">
            New salary preview (approx): ${newSalaryPreview.toFixed(2)}M / yr · Cap impact follows league rules.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setExtendOpen(false)}
              className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white/80"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={capActionLoading || !contract}
              onClick={() =>
                void runCapPatch({
                  action: 'extend',
                  salaryRecordId: contract?.id,
                  additionalYears: extendYears,
                })
              }
              className="rounded-lg border border-sky-500/40 bg-sky-900/40 px-3 py-2 text-xs font-semibold text-sky-100"
            >
              {capActionLoading ? '…' : 'Confirm Extension'}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={tagOpen} onOpenChange={setTagOpen}>
        <DialogContent className="border border-white/[0.08] bg-[#0f141c] text-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Franchise tag</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-white/70">
            Applies a 1-year tag at your league&apos;s franchise tag value (see commissioner cap settings).
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setTagOpen(false)}
              className="rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white/80"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={capActionLoading}
              onClick={() =>
                void runCapPatch({
                  action: 'franchise_tag',
                  playerId,
                })
              }
              className="rounded-lg border border-amber-500/40 bg-amber-900/40 px-3 py-2 text-xs font-semibold text-amber-100"
            >
              {capActionLoading ? '…' : 'Apply Tag'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
