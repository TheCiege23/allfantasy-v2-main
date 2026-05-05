'use client'

import { useState, useEffect, useCallback } from 'react'
import { CheckCircle, AlertCircle, XCircle, Loader } from 'lucide-react'
import type { DraftValidationReport, ValidationResult } from '@/lib/draft/validation/DraftValidationOrchestrator'

/**
 * Canonical fix-action keys emitted by the validation orchestrator. Each key
 * corresponds to a `LeagueSettingsModal` panel id; the parent component is
 * responsible for the mapping (so this component stays navigation-free).
 */
export type PreDraftFixAction =
  | 'invite_managers'
  | 'set_draft_order'
  | 'configure_roster'
  | 'configure_scoring'
  | 'fix_duplicate_managers'
  | 'configure_draft_type'

interface PreDraftWizardProps {
  leagueId: string
  draftId: string
  onClose: () => void
  onValidationComplete?: (canStart: boolean) => void
  /**
   * Parent-supplied handler for "Fix" button clicks. The wizard never
   * navigates on its own — it forwards the canonical fix-action key and lets
   * the parent (`DraftRoomPageClient`) deep-link the settings modal in place.
   */
  onFixAction?: (action: PreDraftFixAction) => void
}

interface ChecklistItemProps {
  result: ValidationResult
  onFix?: (action: string) => void
}

function ChecklistItem({ result, onFix }: ChecklistItemProps) {
  const statusIcons = {
    pass: <CheckCircle className="h-5 w-5 text-emerald-400" />,
    fail: <XCircle className="h-5 w-5 text-red-400" />,
    warning: <AlertCircle className="h-5 w-5 text-amber-400" />,
  }

  const statusColors = {
    pass: 'border-emerald-500/30 bg-emerald-500/10',
    fail: 'border-red-500/30 bg-red-500/10',
    warning: 'border-amber-500/30 bg-amber-500/10',
  }

  const textColors = {
    pass: 'text-emerald-200',
    fail: 'text-red-200',
    warning: 'text-amber-200',
  }

  return (
    <div
      className={`rounded-lg border p-4 ${statusColors[result.status]}`}
      data-testid="pre-draft-validation-check"
      data-status={result.status}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {statusIcons[result.status]}
          <div className="flex-1">
            <p className={`font-medium ${textColors[result.status]}`}>{result.label}</p>
            {result.message && <p className="mt-1 text-xs text-white/60">{result.message}</p>}
          </div>
        </div>
        {result.fixAction && result.status !== 'pass' ? (() => {
          // Capture the narrowed `fixAction` so the click closure doesn't
          // lose the truthy narrowing from the surrounding && guard.
          const fixAction = result.fixAction
          return (
            <button
              onClick={() => onFix?.(fixAction)}
              className="shrink-0 rounded border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/20"
            >
              Fix
            </button>
          )
        })() : null}
      </div>
    </div>
  )
}

export function PreDraftWizard({
  leagueId,
  draftId,
  onClose,
  onValidationComplete,
  onFixAction,
}: PreDraftWizardProps) {
  const [report, setReport] = useState<DraftValidationReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadValidation = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/leagues/${leagueId}/draft/${draftId}/validate-pre-draft`, {
        method: 'GET',
      })

      if (!res.ok) {
        throw new Error('Failed to load validation')
      }

      const data = (await res.json()) as DraftValidationReport
      setReport(data)
      onValidationComplete?.(data.canStartDraft)
    } catch (err) {
      console.error('[PreDraftWizard] validation error:', err)
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }, [leagueId, draftId, onValidationComplete])

  useEffect(() => {
    loadValidation()
  }, [loadValidation])

  useEffect(() => {
    const handler = () => {
      void loadValidation()
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('af-pre-draft-checklist-refresh', handler)
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('af-pre-draft-checklist-refresh', handler)
      }
    }
  }, [loadValidation])

  const handleFixAction = (action: string) => {
    // Forward only the canonical action keys we know how to route. Unknown
    // keys are ignored on the wizard side — the parent owns the mapping.
    const canonical: PreDraftFixAction[] = [
      'invite_managers',
      'set_draft_order',
      'configure_roster',
      'configure_scoring',
      'fix_duplicate_managers',
      'configure_draft_type',
    ]
    if ((canonical as readonly string[]).includes(action)) {
      onFixAction?.(action as PreDraftFixAction)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4 rounded-lg border border-white/10 bg-black/40 p-6">
        <div className="flex items-center justify-center gap-2">
          <Loader className="h-5 w-5 animate-spin text-white/60" />
          <p className="text-white/60">Running validation checks...</p>
        </div>
      </div>
    )
  }

  if (error || !report) {
    return (
      <div className="space-y-4 rounded-lg border border-red-500/30 bg-red-500/10 p-6">
        <div className="flex items-start gap-3">
          <XCircle className="h-5 w-5 shrink-0 text-red-400" />
          <div className="flex-1">
            <p className="font-medium text-red-200">{error || 'Validation error'}</p>
            <button
              onClick={loadValidation}
              className="mt-2 rounded border border-red-400/50 bg-red-500/20 px-3 py-1 text-xs font-medium text-red-200 hover:bg-red-500/30"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {report.canStartDraft ? (
        <div data-testid="pre-draft-validation-pass">
          <h2 className="text-lg font-bold text-white">Pre-Draft Checklist</h2>
          <p className="mt-1 text-sm text-white/60">All checks passed. Ready to start draft.</p>
        </div>
      ) : (
        <div data-testid="pre-draft-validation-blocked">
          <h2 className="text-lg font-bold text-white">Pre-Draft Checklist</h2>
          <p className="mt-1 text-sm text-white/60">Some checks failed. Please fix before starting.</p>
        </div>
      )}

      <div className="space-y-3">
        {report.results.map((result) => (
          <ChecklistItem key={result.key} result={result} onFix={handleFixAction} />
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-white/10 pt-4">
        <button
          onClick={onClose}
          className="rounded border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10"
        >
          Close
        </button>
        <button
          onClick={loadValidation}
          className="rounded border border-white/20 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10"
        >
          Refresh
        </button>
      </div>
    </div>
  )
}
