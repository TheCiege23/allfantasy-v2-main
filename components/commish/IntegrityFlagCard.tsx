'use client'

/**
 * 11c — one integrity flag, rendered from its real `evidenceJson`.
 *
 * ⚠ TYPES ARE LOCAL MIRRORS ON PURPOSE. `CollusionEvidence` and `TankingEvidence`
 * live in `lib/integrity/*Engine.ts`, both of which open with `import "server-only"`.
 * Same convention `components/commissioner-intelligence/CommissionerIntelligenceHub.tsx`
 * already uses: mirror the contract locally so no server module can be dragged
 * into a client bundle by a future non-type import.
 *
 * ⚠ EVIDENCE IS RENDERED, NEVER SUMMARISED AWAY. Before this component the page
 * showed `summary` + a confidence percentage and dropped `evidenceJson` on the
 * floor — the engine computes both sides of the trade, every asset with its
 * value, the differential, the prior-trade count and the playoff standing of
 * both managers, and a commissioner being asked to accuse someone of collusion
 * saw none of it. Everything below is read from that payload; nothing here is
 * derived, estimated, or filled in.
 *
 * ⚠ A CARD WITHOUT DECIDABLE EVIDENCE GETS NO ACTION ROW. Handoff build rule 3:
 * a frequency/repeat-partner signal is not proof and must not present as an
 * actionable accusation — it renders neutral and buttonless, and says in its own
 * copy that it raises the priority of the related trade instead. `actionable`
 * below is what enforces that, and it is computed from the evidence shape rather
 * than passed in, so a caller cannot accidentally promote one.
 */

import { useMemo } from 'react'

// ── Contract mirrors ────────────────────────────────────────────────────────
type TradeAsset = { name: string; position: string; estimatedValue: number }

export type CollusionEvidenceLike = {
  tradeTransactionId?: string
  team1?: { rosterId?: string; teamName?: string; wins?: number; losses?: number }
  team2?: { rosterId?: string; teamName?: string; wins?: number; losses?: number }
  assetsTeam1Gave?: TradeAsset[]
  assetsTeam2Gave?: TradeAsset[]
  team1TotalValue?: number
  team2TotalValue?: number
  valueDifferentialPct?: number
  priorTradesBetweenPair?: number
  isPlayoffContender?: { team1?: boolean; team2?: boolean }
  redFlags?: string[]
}

export type TankingEvidenceLike = {
  teamName?: string
  currentRecord?: { wins?: number; losses?: number }
  weekNumber?: number
  illegalOrSuspiciousStarters?: {
    slotPosition?: string
    startedPlayerName?: string
    startedPlayerStatus?: string
    benchedBetterOption?: string
    benchedBetterOptionProjection?: number
    startedPlayerProjection?: number
  }[]
  consecutiveWeeksWithSuspiciousLineup?: number
  pointsLeftOnBench?: number
  eliminatedFromPlayoffs?: boolean
  redFlags?: string[]
}

export type IntegrityFlagRow = {
  id: string
  flagType: string
  severity: string
  status: string
  summary: string
  aiConfidence: number
  tradeTransactionId: string | null
  affectedTeamNames?: string[]
  createdAt: string
  evidenceJson: unknown
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

/** `critical` is not a severity the engines emit today; accepted so a future one renders. */
function normalizeSeverity(raw: string): 'critical' | 'high' | 'medium' | 'low' {
  const s = raw.trim().toLowerCase()
  if (s === 'critical') return 'critical'
  if (s === 'high') return 'high'
  if (s === 'low') return 'low'
  return 'medium'
}

/**
 * Age, from the flag's own `createdAt`. Rendered as a relative phrase because
 * that is the question a commissioner is actually asking ("how long has this
 * been sitting open"), and an absolute timestamp buries it.
 */
function ageLabel(iso: string): string | null {
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return null
  const days = Math.floor((Date.now() - then) / 86_400_000)
  if (days <= 0) return 'flagged today'
  if (days === 1) return 'flagged yesterday'
  if (days < 30) return `flagged ${days} days ago`
  const months = Math.round(days / 30)
  return `flagged ${months} month${months === 1 ? '' : 's'} ago`
}

function assetLine(assets: TradeAsset[] | undefined): string | null {
  if (!Array.isArray(assets) || assets.length === 0) return null
  const names = assets.map((a) => (typeof a?.name === 'string' ? a.name.trim() : '')).filter(Boolean)
  return names.length > 0 ? names.join(', ') : null
}

function fmtValue(n: unknown): string | null {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(1) : null
}

// ── Sub-views ───────────────────────────────────────────────────────────────

/**
 * The side-by-side value comparison. Drawn only when BOTH sides resolved to real
 * assets — a one-sided render would read as "this manager gave nothing away",
 * which is a much stronger accusation than "we could not price one side".
 */
function TradeSides({ ev }: { ev: CollusionEvidenceLike }) {
  const aName = ev.team1?.teamName?.trim()
  const bName = ev.team2?.teamName?.trim()
  const aAssets = assetLine(ev.assetsTeam1Gave)
  const bAssets = assetLine(ev.assetsTeam2Gave)
  if (!aAssets || !bAssets) return null

  const aValue = fmtValue(ev.team1TotalValue)
  const bValue = fmtValue(ev.team2TotalValue)

  return (
    <div className="af-cm-sides">
      <div className="af-cm-side">
        <div className="af-cm-side-who af-num">{aName ? `${aName} gave` : 'Side A gave'}</div>
        <p className="af-cm-side-assets">{aAssets}</p>
        {aValue ? <div className="af-cm-side-value af-num">value {aValue}</div> : null}
      </div>
      <div className="af-cm-side">
        <div className="af-cm-side-who af-num">{bName ? `${bName} gave` : 'Side B gave'}</div>
        <p className="af-cm-side-assets">{bAssets}</p>
        {bValue ? <div className="af-cm-side-value af-num">value {bValue}</div> : null}
      </div>
    </div>
  )
}

function TankingStats({ ev }: { ev: TankingEvidenceLike }) {
  const weeks = ev.consecutiveWeeksWithSuspiciousLineup
  const bench = ev.pointsLeftOnBench
  const rec = ev.currentRecord
  const stats: { label: string; value: string; tone?: 'warn' }[] = []

  if (typeof weeks === 'number' && weeks > 0) {
    stats.push({ label: 'Suspicious weeks', value: weeks === 1 ? '1' : `${weeks} in a row`, tone: 'warn' })
  }
  if (typeof bench === 'number' && bench > 0) {
    stats.push({ label: 'Left on bench', value: `${bench.toFixed(1)} pts`, tone: 'warn' })
  }
  if (typeof rec?.wins === 'number' && typeof rec?.losses === 'number') {
    stats.push({ label: 'Record', value: `${rec.wins}–${rec.losses}` })
  }
  /*
   * "Eliminated" is a real, decision-relevant boolean and both of its states are
   * worth showing: a manager who is already out has a motive, and one who is not
   * is the more interesting flag. So `false` renders "Not yet" rather than being
   * dropped the way an absent number is.
   */
  if (typeof ev.eliminatedFromPlayoffs === 'boolean') {
    stats.push({ label: 'Eliminated', value: ev.eliminatedFromPlayoffs ? 'Yes' : 'Not yet' })
  }

  if (stats.length === 0) return null
  return (
    <div className="af-cm-statgrid">
      {stats.map((s) => (
        <div key={s.label}>
          <div className="af-cm-stat-label">{s.label}</div>
          <div className="af-cm-stat-value af-num" data-tone={s.tone ?? undefined}>
            {s.value}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Card ────────────────────────────────────────────────────────────────────

export function IntegrityFlagCard({
  flag,
  onDismiss,
  onEscalate,
  onMessage,
  busy = false,
}: {
  flag: IntegrityFlagRow
  onDismiss?: (flag: IntegrityFlagRow) => void
  onEscalate?: (flag: IntegrityFlagRow) => void
  onMessage?: (flag: IntegrityFlagRow) => void
  busy?: boolean
}) {
  const severity = normalizeSeverity(flag.severity)
  const isCollusion = flag.flagType.trim().toLowerCase() === 'collusion'
  const ev = asRecord(flag.evidenceJson)

  const { context, hasDecidableEvidence } = useMemo(() => {
    const bullets: string[] = []
    if (isCollusion) {
      const c = ev as CollusionEvidenceLike
      const t1Out = c.isPlayoffContender?.team1 === false
      const t2Out = c.isPlayoffContender?.team2 === false
      if (t1Out && t2Out) bullets.push('Both managers are eliminated from playoff contention.')
      else if (t1Out || t2Out) bullets.push('One of the two managers is eliminated from playoff contention.')

      const prior = c.priorTradesBetweenPair
      if (typeof prior === 'number' && prior > 0) {
        bullets.push(
          `${prior + 1}${prior + 1 === 2 ? 'nd' : prior + 1 === 3 ? 'rd' : 'th'} trade between this pair this season — repeat-partner signal.`,
        )
      }
      for (const rf of Array.isArray(c.redFlags) ? c.redFlags : []) {
        if (typeof rf === 'string' && rf.trim()) bullets.push(rf.trim())
      }
      const sidesResolved = Boolean(assetLine(c.assetsTeam1Gave) && assetLine(c.assetsTeam2Gave))
      return { context: bullets, hasDecidableEvidence: sidesResolved }
    }

    const t = ev as TankingEvidenceLike
    const first = Array.isArray(t.illegalOrSuspiciousStarters) ? t.illegalOrSuspiciousStarters[0] : undefined
    if (first) {
      /*
       * The single most damning line on the card, assembled only from fields the
       * engine actually populated. Each clause is dropped independently rather
       * than the whole sentence being skipped, because "started X (OUT)" is
       * already worth reading without a projection attached.
       */
      const parts: string[] = []
      if (first.slotPosition) parts.push(`Slot ${first.slotPosition}`)
      const who = first.startedPlayerName?.trim()
      const status = first.startedPlayerStatus?.trim()
      if (who) {
        const startProj = first.startedPlayerProjection
        const benchProj = first.benchedBetterOptionProjection
        /*
         * ⚠ THE PROJECTION CLAUSE ATTACHES TO THE "started" CLAUSE, IT IS NOT A
         * THIRD ·-SEPARATED PART. Joining it separately produced "started
         * K. Walker (OUT) · at 0.0 projected over…", which reads as two facts
         * rather than one sentence. Caught by the test below this file's fixture.
         */
        const projection =
          typeof startProj === 'number' && typeof benchProj === 'number'
            ? ` at ${startProj.toFixed(1)} projected over a bench option at ${benchProj.toFixed(1)}`
            : ''
        parts.push(`started ${who}${status ? ` (${status})` : ''}${projection}`)
      }
      if (parts.length > 0) bullets.push(`${parts.join(' · ')}.`)
    }
    for (const rf of Array.isArray(t.redFlags) ? t.redFlags : []) {
      if (typeof rf === 'string' && rf.trim()) bullets.push(rf.trim())
    }
    const suspicious = Array.isArray(t.illegalOrSuspiciousStarters) ? t.illegalOrSuspiciousStarters.length : 0
    return { context: bullets, hasDecidableEvidence: suspicious > 0 }
  }, [ev, isCollusion])

  const age = ageLabel(flag.createdAt)
  const confidencePct = Number.isFinite(flag.aiConfidence) ? Math.round(flag.aiConfidence * 100) : null

  /*
   * ⚠ BUILD RULE 3, ENFORCED HERE RATHER THAN BY THE CALLER. A flag whose
   * evidence does not support a decision is informational: neutral card, no
   * action row. Repeat-partner frequency is the canonical example — it raises
   * the review priority of the individual trades, and on its own it is not
   * something to accuse anyone over.
   */
  const actionable = flag.status === 'open' && hasDecidableEvidence

  const messageLabel = (() => {
    const names = Array.isArray(flag.affectedTeamNames) ? flag.affectedTeamNames.filter(Boolean) : []
    if (isCollusion) return 'Message both'
    return names.length === 1 ? `Message ${names[0]}` : 'Message manager'
  })()

  return (
    <article
      className="af-cm-flagcard"
      data-sev={actionable ? severity : 'medium'}
      data-testid={`integrity-flag-${flag.id}`}
    >
      <div className="af-cm-flagcard-top">
        <div className="af-cm-flagcard-tags">
          <span className="af-cm-sev af-num" data-sev={actionable ? severity : 'medium'}>
            {isCollusion ? 'Collusion' : 'Tanking'} &middot; {severity}
          </span>
          <span className="af-cm-state af-num">{flag.status}</span>
        </div>
        <div className="af-cm-flagcard-meta af-num">
          {[confidencePct != null ? `Confidence ${confidencePct}%` : null, age].filter(Boolean).join(' · ')}
        </div>
      </div>

      <h3 className="af-cm-flagcard-lead">{flag.summary}</h3>

      {isCollusion ? <TradeSides ev={ev as CollusionEvidenceLike} /> : <TankingStats ev={ev as TankingEvidenceLike} />}

      {context.length > 0 ? (
        <ul className="af-cm-evidence">
          {context.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : null}

      {actionable ? (
        <div className="af-cm-actions">
          {/*
            Build rule 2: an escalation path, a communication path, and Dismiss.
            Never a lone Dismiss — a commissioner given only "make this go away"
            will make it go away.
          */}
          {onEscalate ? (
            <button
              type="button"
              className={`af-btn ${severity === 'high' || severity === 'critical' ? 'af-cm-btn-warn' : ''}`}
              onClick={() => onEscalate(flag)}
              disabled={busy}
            >
              {isCollusion ? 'Open review' : 'Escalate'}
            </button>
          ) : null}
          {onMessage ? (
            <button type="button" className="af-btn af-btn--ghost" onClick={() => onMessage(flag)} disabled={busy}>
              {messageLabel}
            </button>
          ) : null}
          {onDismiss ? (
            <button type="button" className="af-btn af-btn--ghost" onClick={() => onDismiss(flag)} disabled={busy}>
              Dismiss
            </button>
          ) : null}
          {/*
            Says where the actual power lives. Integrity flags are a review
            surface; reversing a trade is a league-settings action, and a
            commissioner who expects "Open review" to undo the trade will be
            surprised at the worst possible moment.
          */}
          {isCollusion ? (
            <span className="af-cm-actions-note">Reversing a trade happens in league settings, not here.</span>
          ) : null}
        </div>
      ) : flag.status === 'open' ? (
        <p className="af-cm-actions-note" style={{ marginLeft: 0, marginTop: 14 }}>
          Frequency alone is not proof &mdash; it raises the review priority of each individual trade.
        </p>
      ) : null}
    </article>
  )
}

export default IntegrityFlagCard
