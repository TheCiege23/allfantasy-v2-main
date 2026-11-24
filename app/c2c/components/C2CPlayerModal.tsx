'use client'

import { useState } from 'react'
import { useAfSubGate } from '@/hooks/useAfSubGate'
import type { CampusPlayerEval } from '@/lib/c2c/ai/c2cChimmy'
import type { C2CPlayerRow } from './c2cPlayerTypes'

export function C2CPlayerModal({
  open,
  onClose,
  player,
  side,
  leagueId,
  userId,
  hasAfSub = false,
  countsTowardScore,
}: {
  open: boolean
  onClose: () => void
  player: C2CPlayerRow | null
  side: 'campus' | 'canton'
  leagueId: string
  userId: string
  hasAfSub?: boolean
  countsTowardScore: boolean
}) {
  const [aiLoading, setAiLoading] = useState(false)
  const [aiEval, setAiEval] = useState<CampusPlayerEval | null>(null)
  const [aiErr, setAiErr] = useState<string | null>(null)
  const { handleApiResponse } = useAfSubGate('commissioner_c2c_scouting')

  if (!open || !player) return null

  const campus = side === 'campus'

  const runCampusAi = async () => {
    if (!player || !campus) return
    setAiLoading(true)
    setAiErr(null)
    setAiEval(null)
    try {
      const r = await fetch('/api/c2c/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'campus_eval',
          leagueId,
          managerId: userId,
          playerId: player.playerId,
        }),
      })
      if (!(await handleApiResponse(r))) return
      const j = (await r.json().catch(() => ({}))) as { error?: string; eval?: CampusPlayerEval }
      if (!r.ok) {
        setAiErr(typeof j.error === 'string' ? j.error : 'Analysis failed')
        return
      }
      setAiEval(j.eval ?? null)
    } finally {
      setAiLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-[var(--surface2)] p-0 backdrop-blur-sm md:items-center md:p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid="c2c-player-modal"
    >
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-white/[0.08] bg-[var(--surface)] p-5 shadow-2xl md:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[16px] font-bold text-[var(--text)]">{campus ? '🎓 Campus player' : '🏙 Canton player'}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-white/[0.06] px-2 py-1 text-[12px] text-[var(--text2)]"
            data-testid="c2c-player-modal-close"
          >
            Close
          </button>
        </div>

        <div className="mt-4 space-y-3 text-[13px] text-[var(--text)]">
          <p className="text-[18px] font-bold text-[var(--text)]">{player.playerName}</p>
          <p className="text-[var(--muted)]">
            {player.position}
            {campus && player.school ? ` · ${player.school}` : ''}
            {!campus && player.nflNbaTeam ? ` · ${player.nflNbaTeam}` : ''}
          </p>

          {countsTowardScore ? (
            <p className="rounded-lg border border-[var(--good)] bg-[var(--good-soft)] px-3 py-2 text-[12px] text-[var(--good)]">
              Counts toward team score: YES
            </p>
          ) : (
            <p className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12px] text-[var(--muted)]">
              Display only — does not count
            </p>
          )}

          {campus ? (
            <>
              {player.classYear ? (
                <p>
                  <span className="text-[var(--muted)]">Class: </span>
                  {player.classYear}
                </p>
              ) : null}
              {player.projectedDeclarationYear ? (
                <p>
                  <span className="text-[var(--muted)]">Declaration: </span>
                  {player.projectedDeclarationYear}
                </p>
              ) : null}
              {player.hasEnteredPro && player.proEntryYear ? (
                <p>
                  <span className="text-[var(--muted)]">Pro entry: </span>
                  {player.proEntryYear}
                </p>
              ) : null}
              <p className="text-[11px] text-[var(--muted)]">
                Season stats and a weekly breakdown appear here once this player has scored games.
              </p>
            </>
          ) : (
            <>
              <p>
                <span className="text-[var(--muted)]">Rookie: </span>
                {player.isRookieEligible ? 'Yes' : 'No'}
              </p>
              <p>
                <span className="text-[var(--muted)]">Taxi: </span>
                {player.isTaxiEligible ? `Eligible (${player.taxiYearsUsed ?? 0} yrs used)` : 'N/A'}
              </p>
            </>
          )}
        </div>

        {aiErr ? (
          <p className="mt-3 rounded-lg border border-[var(--c2c-amber-line)] bg-[var(--c2c-amber-soft)] px-3 py-2 text-[12px] text-[var(--c2c-amber)]" data-testid="c2c-player-ai-error">
            {aiErr}
          </p>
        ) : null}

        {aiEval ? (
          <div
            className="mt-4 space-y-2 rounded-xl border border-[var(--accent-line)] bg-[var(--accent-soft)] p-3 text-[12px] text-[var(--text)]"
            data-testid="c2c-player-ai-panel"
          >
            <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--accent)]">Chimmy — campus + canton</p>
            <p>
              <span className="text-[var(--muted)]">Campus grade: </span>
              {aiEval.campusGrade}
            </p>
            <p>
              <span className="text-[var(--muted)]">Canton projection: </span>
              {aiEval.cantonProjection}
            </p>
            <p>
              <span className="text-[var(--muted)]">Start: </span>
              {aiEval.startRec}
            </p>
            <p>
              <span className="text-[var(--muted)]">Declaration risk: </span>
              {aiEval.declarationRisk}
            </p>
            <p>
              <span className="text-[var(--muted)]">Hold: </span>
              {aiEval.holdRecommendation}
            </p>
            <p className="text-[var(--text2)]">{aiEval.verdict}</p>
          </div>
        ) : null}

        <div className="mt-5 flex flex-col gap-2 border-t border-white/[0.06] pt-4">
          {campus ? (
            <button
              type="button"
              disabled
              className="rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[12px] text-[var(--faint)]"
              title="Available after player enters the league"
            >
              Move to Canton Bench (after pro entry)
            </button>
          ) : (
            <button
              type="button"
              disabled
              className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] text-[var(--bad)]"
            >
              Move to Campus — not allowed
            </button>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled
              className="rounded-lg border border-white/[0.08] px-3 py-2 text-[12px] text-[var(--muted)]"
            >
              Drop
            </button>
            <button
              type="button"
              disabled
              className="rounded-lg border border-white/[0.08] px-3 py-2 text-[12px] text-[var(--muted)]"
            >
              Trade
            </button>
            {!campus ? (
              <>
                <button type="button" disabled className="rounded-lg border border-white/[0.08] px-3 py-2 text-[12px] text-[var(--muted)]">
                  Taxi
                </button>
                <button type="button" disabled className="rounded-lg border border-white/[0.08] px-3 py-2 text-[12px] text-[var(--muted)]">
                  IR
                </button>
              </>
            ) : null}
          </div>
          {campus && hasAfSub ? (
            <button
              type="button"
              onClick={() => void runCampusAi()}
              disabled={aiLoading}
              className="mt-2 inline-flex justify-center rounded-lg border border-[var(--accent-line)] bg-[var(--accent-soft)] px-3 py-2 text-[12px] font-semibold text-[var(--accent)] hover:bg-[var(--accent-soft)] disabled:opacity-50"
              data-testid="c2c-player-modal-ai"
            >
              {aiLoading ? 'Analyzing…' : 'Chimmy Analysis (AF Commissioner)'}
            </button>
          ) : campus ? (
            <p className="text-center text-[11px] text-[var(--faint)]">Chimmy analysis requires AF Commissioner.</p>
          ) : (
            <p className="text-center text-[11px] text-[var(--faint)]">Campus Chimmy evaluates college prospects (open a campus player).</p>
          )}
        </div>
      </div>
    </div>
  )
}
