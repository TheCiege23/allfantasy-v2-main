'use client'

/**
 * ApplyLineupConfirmModal — user-confirmed Apply Lineup action for
 * `/lineup-optimizer`. Wraps the pure `foldOptimizerIntoApplyLineupPayload`
 * helper so users can review every section change *before* the modal
 * issues `POST /api/leagues/[leagueId]/roster/ai-apply-lineup`.
 *
 * Safety rules baked in:
 *   • Never POSTs without a valid `leagueId`, a non-null persisted roster,
 *     and an optimizer result that the fold helper marks `safeToApply`.
 *   • Gates the Confirm button behind the `pro_autocoach` entitlement
 *     using `useEntitlement` (the same hook the rest of the app uses).
 *   • Demo rosters (no league context) keep the Confirm button disabled.
 *   • All known server error codes are mapped to honest messages — 409
 *     `ROSTER_ILLEGAL` re-renders the server's blocking reasons instead
 *     of our preview, so users see the authoritative legality verdict.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, ShieldCheck, AlertTriangle, Lock, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useEntitlement } from '@/hooks/useEntitlement'
import {
  foldOptimizerIntoApplyLineupPayload,
  type OptimizerResultLike,
  type RosterFoldBlockingReason,
} from '@/lib/lineup-optimizer/foldOptimizerIntoApplyLineupPayload'

const BLOCKING_REASON_LABELS: Record<RosterFoldBlockingReason, string> = {
  no_optimizer_result: 'Run "Analyze lineup" first.',
  no_persisted_roster: 'No saved league roster to apply to.',
  unfilled_slots: 'Optimizer left one or more starting slots empty.',
  starter_not_on_roster: 'Optimizer suggested a player not on your roster.',
  locked_player_section_change: 'A locked player would have to move sections.',
  duplicate_player: 'A player appears in more than one starting slot.',
  dropped_player: 'A player would be dropped from your roster entirely.',
  empty_starters: 'No starters were produced for this lineup.',
}

interface ServerLegality {
  blockingReasons?: string[]
  highlightedPlayerIds?: string[]
  isLineupLocked?: boolean
}

interface ApplyLineupConfirmModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Required to POST. When missing, modal stays in "demo" disabled state. */
  leagueId: string | null
  week?: number | null
  /** Raw `roster` value from `/api/league/roster` (i.e. `Roster.playerData`). */
  currentPersistedRoster: unknown
  /** Latest optimizer engine result. */
  optimizerResult: OptimizerResultLike | null
  /** From `/api/league/roster` → `lineupLock.lockedPlayerIds`. */
  lockedPlayerIds: ReadonlyArray<string>
  /** True when the user is on a sample/demo roster (no league bound). */
  isDemoRoster: boolean
  /** Called after a successful 200 so the parent can refetch league data. */
  onApplied?: () => void
}

type ApplyState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'success'; week: number | null }
  | {
      kind: 'error'
      message: string
      upgrade?: boolean
      legality?: ServerLegality | null
    }

export function ApplyLineupConfirmModal({
  open,
  onOpenChange,
  leagueId,
  week,
  currentPersistedRoster,
  optimizerResult,
  lockedPlayerIds,
  isDemoRoster,
  onApplied,
}: ApplyLineupConfirmModalProps) {
  const [state, setState] = useState<ApplyState>({ kind: 'idle' })
  const ent = useEntitlement('pro_autocoach')

  const fold = useMemo(
    () =>
      foldOptimizerIntoApplyLineupPayload({
        currentPersistedRoster,
        optimizerResult,
        lockedPlayerIds,
        week: typeof week === 'number' ? week : undefined,
      }),
    [currentPersistedRoster, optimizerResult, lockedPlayerIds, week]
  )

  const hasLeague = Boolean(leagueId)
  const hasAccess = ent.featureAccess === true
  const entLoading = ent.loading

  // Confirm is enabled only when every safety gate passes.
  const canConfirm =
    !isDemoRoster &&
    hasLeague &&
    hasAccess &&
    fold.safeToApply &&
    fold.payload != null &&
    state.kind !== 'submitting' &&
    state.kind !== 'success'

  const handleConfirm = async () => {
    if (!leagueId || !fold.payload) return
    setState({ kind: 'submitting' })
    try {
      const res = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/roster/ai-apply-lineup`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fold.payload),
        }
      )
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { week?: number }
        setState({ kind: 'success', week: data.week ?? null })
        onApplied?.()
        return
      }
      let body: any = null
      try {
        body = await res.json()
      } catch {
        /* ignore */
      }
      if (res.status === 401) {
        setState({ kind: 'error', message: 'Sign in required to apply lineups.' })
        return
      }
      if (res.status === 403 && body?.code === 'ENTITLEMENT') {
        setState({
          kind: 'error',
          message:
            body?.message ||
            'Apply Lineup requires the Pro AutoCoach subscription feature.',
          upgrade: true,
        })
        return
      }
      if (res.status === 403) {
        setState({
          kind: 'error',
          message:
            body?.message ||
            'Roster changes are not allowed for this league right now.',
        })
        return
      }
      if (res.status === 404) {
        setState({ kind: 'error', message: 'League or roster not found.' })
        return
      }
      if (res.status === 409) {
        setState({
          kind: 'error',
          message: 'Your roster would be illegal after this change.',
          legality: body?.rosterLegality ?? null,
        })
        return
      }
      if (res.status === 400) {
        setState({
          kind: 'error',
          message:
            body?.message ||
            'Could not validate the lineup. Re-run Analyze and try again.',
        })
        return
      }
      setState({ kind: 'error', message: 'Server error. Please try again.' })
    } catch {
      setState({
        kind: 'error',
        message: 'Network error. Please check your connection and try again.',
      })
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (!next && state.kind !== 'submitting') {
      // Reset transient state when closing.
      setState({ kind: 'idle' })
    }
    onOpenChange(next)
  }

  // ---------- precomputed UI bits ----------
  const movedToStarters = fold.diff.movedToStarters
  const movedToBench = fold.diff.movedToBench
  const unchanged = fold.diff.unchangedStarters
  const blockedLocked = fold.diff.blockedLockedPlayers
  const missing = fold.diff.missingFromRoster
  const preserved = fold.diff.preserved

  const noChanges =
    movedToStarters.length === 0 &&
    movedToBench.length === 0 &&
    blockedLocked.length === 0 &&
    missing.length === 0

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="border-white/15 bg-[#0a1228] text-white sm:max-w-lg"
        data-testid="lineup-optimizer-apply-confirm-modal"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <ShieldCheck className="h-5 w-5 text-cyan-300" />
            Review & apply lineup
          </DialogTitle>
          <DialogDescription className="text-white/70">
            We&apos;ll send these starter changes to your league roster. IR,
            taxi, and devy slots stay exactly where they are.
          </DialogDescription>
        </DialogHeader>

        <div
          className="max-h-[60vh] space-y-4 overflow-y-auto pr-1 text-sm"
          data-testid="lineup-optimizer-apply-diff"
        >
          {/* Demo / no-league banner */}
          {isDemoRoster && (
            <Banner tone="warn">
              You&apos;re viewing a demo roster. Connect a league to apply
              lineup changes.
            </Banner>
          )}
          {!isDemoRoster && !hasLeague && (
            <Banner tone="warn">
              No league selected. Open the optimizer with{' '}
              <code className="text-white">?leagueId=…</code> or pick a league
              above.
            </Banner>
          )}

          {/* Entitlement state */}
          {!hasLeague ? null : entLoading ? (
            <Banner tone="info">Checking subscription…</Banner>
          ) : hasAccess ? null : (
            <Banner tone="warn">
              <span className="block">
                {ent.entitlement?.message ||
                  'Apply Lineup requires the Pro AutoCoach subscription feature.'}
              </span>
              <Link
                href={ent.upgradePath || '/pricing'}
                className="mt-2 inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200"
              >
                Upgrade <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Banner>
          )}

          {/* Blocking reasons (preview-side) */}
          {fold.blockingReasons.length > 0 && hasLeague && !isDemoRoster && (
            <Banner tone="warn">
              <div className="font-semibold text-white">
                Cannot apply this lineup:
              </div>
              <ul className="mt-1 list-disc pl-5 text-white/80">
                {fold.blockingReasons.map((r) => (
                  <li key={r}>{BLOCKING_REASON_LABELS[r]}</li>
                ))}
              </ul>
            </Banner>
          )}

          {/* Diff sections — only meaningful when fold succeeded */}
          {fold.payload && noChanges && (
            <Banner tone="info">
              No starter changes — your current lineup already matches the
              optimizer&apos;s recommendation.
            </Banner>
          )}

          {movedToStarters.length > 0 && (
            <DiffSection
              title={`Moving to starters (${movedToStarters.length})`}
              tone="positive"
            >
              {movedToStarters.map((p) => (
                <DiffRow
                  key={`mv-st-${p.id}`}
                  primary={p.name}
                  secondary={`${p.slotCode} · from ${p.fromSection}`}
                />
              ))}
            </DiffSection>
          )}

          {movedToBench.length > 0 && (
            <DiffSection
              title={`Moving to bench (${movedToBench.length})`}
              tone="neutral"
            >
              {movedToBench.map((p) => (
                <DiffRow
                  key={`mv-bn-${p.id}`}
                  primary={p.name}
                  secondary={`from ${p.fromSection}`}
                />
              ))}
            </DiffSection>
          )}

          {unchanged.length > 0 && (
            <DiffSection
              title={`Staying in starters (${unchanged.length})`}
              tone="muted"
            >
              {unchanged.map((p) => (
                <DiffRow
                  key={`un-${p.id}`}
                  primary={p.name}
                  secondary={p.slotCode}
                />
              ))}
            </DiffSection>
          )}

          {blockedLocked.length > 0 && (
            <DiffSection
              title={`Blocked by lock (${blockedLocked.length})`}
              tone="danger"
            >
              {blockedLocked.map((p) => (
                <DiffRow
                  key={`lk-${p.id}`}
                  primary={
                    <span className="inline-flex items-center gap-1">
                      <Lock className="h-3.5 w-3.5 text-amber-300" />
                      {p.name}
                    </span>
                  }
                  secondary={p.reason}
                />
              ))}
            </DiffSection>
          )}

          {missing.length > 0 && (
            <DiffSection
              title={`Not on roster (${missing.length})`}
              tone="danger"
            >
              {missing.map((p) => (
                <DiffRow
                  key={`mi-${p.id}`}
                  primary={p.name}
                  secondary={p.slotCode}
                />
              ))}
            </DiffSection>
          )}

          {(preserved.ir.length > 0 ||
            preserved.taxi.length > 0 ||
            preserved.devy.length > 0) && (
            <DiffSection title="Untouched slots" tone="muted">
              {preserved.ir.length > 0 && (
                <DiffRow primary={`IR (${preserved.ir.length})`} secondary="preserved" />
              )}
              {preserved.taxi.length > 0 && (
                <DiffRow primary={`Taxi (${preserved.taxi.length})`} secondary="preserved" />
              )}
              {preserved.devy.length > 0 && (
                <DiffRow primary={`Devy (${preserved.devy.length})`} secondary="preserved" />
              )}
            </DiffSection>
          )}

          {/* Server-side error feedback */}
          {state.kind === 'error' && (
            <Banner tone="danger">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
                <div className="space-y-1">
                  <div className="font-semibold text-white">{state.message}</div>
                  {state.legality?.blockingReasons &&
                    state.legality.blockingReasons.length > 0 && (
                      <ul className="list-disc pl-5 text-white/80">
                        {state.legality.blockingReasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    )}
                  {state.upgrade && (
                    <Link
                      href={ent.upgradePath || '/pricing'}
                      className="inline-flex items-center gap-1 text-cyan-300 hover:text-cyan-200"
                    >
                      Upgrade to Pro AutoCoach{' '}
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>
              </div>
            </Banner>
          )}

          {state.kind === 'success' && (
            <Banner tone="positive">
              <div className="font-semibold text-white">Lineup applied.</div>
              <div className="text-white/80">
                {state.week != null
                  ? `Saved for week ${state.week}.`
                  : 'Saved to your league roster.'}
              </div>
            </Banner>
          )}
        </div>

        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="ghost"
            onClick={() => handleOpenChange(false)}
            disabled={state.kind === 'submitting'}
            className="text-white/70 hover:text-white"
            data-testid="lineup-optimizer-apply-cancel"
          >
            {state.kind === 'success' ? 'Close' : 'Cancel'}
          </Button>
          {state.kind !== 'success' && (
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={!canConfirm}
              className="gap-2 border border-cyan-400/40 bg-cyan-500/20 text-cyan-50 hover:bg-cyan-500/30 disabled:cursor-not-allowed disabled:opacity-50"
              data-testid="lineup-optimizer-apply-confirm"
            >
              {state.kind === 'submitting' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Applying…
                </>
              ) : (
                <>Confirm & apply</>
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* --------------------------------- bits --------------------------------- */

function Banner({
  children,
  tone,
}: {
  children: React.ReactNode
  tone: 'info' | 'positive' | 'warn' | 'danger'
}) {
  const cls =
    tone === 'positive'
      ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
      : tone === 'warn'
        ? 'border-amber-400/30 bg-amber-500/10 text-amber-100'
        : tone === 'danger'
          ? 'border-red-400/30 bg-red-500/10 text-red-100'
          : 'border-white/15 bg-white/5 text-white/80'
  return <div className={`rounded-md border px-3 py-2 ${cls}`}>{children}</div>
}

function DiffSection({
  title,
  tone,
  children,
}: {
  title: string
  tone: 'positive' | 'neutral' | 'muted' | 'danger'
  children: React.ReactNode
}) {
  const titleCls =
    tone === 'positive'
      ? 'text-emerald-200'
      : tone === 'danger'
        ? 'text-red-200'
        : tone === 'neutral'
          ? 'text-white/90'
          : 'text-white/60'
  return (
    <section className="rounded-md border border-white/10 bg-white/[0.02] p-3">
      <h4 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${titleCls}`}>
        {title}
      </h4>
      <div className="space-y-1.5">{children}</div>
    </section>
  )
}

function DiffRow({
  primary,
  secondary,
}: {
  primary: React.ReactNode
  secondary?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-white">{primary}</span>
      {secondary != null && (
        <span className="text-xs text-white/60">{secondary}</span>
      )}
    </div>
  )
}
