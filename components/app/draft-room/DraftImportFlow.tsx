'use client'

import { useState, useCallback, useEffect, useRef, type ChangeEvent } from 'react'
import { Upload, AlertCircle, CheckCircle, RotateCcw } from 'lucide-react'

type DraftImportFlowProps = {
  leagueId: string
  onSuccess?: () => void
  onClose?: () => void
}

type ValidateResult = {
  valid: boolean
  parseError?: string
  report?: { errors: Array<{ code: string; message: string; field?: string }>; warnings: Array<{ code: string; message: string; field?: string }>; canProceed: boolean }
  preview?: {
    summary: { pickCount: number; tradedPickCount: number; keeperCount: number; slotOrderLength: number }
    picks?: Array<{ overall: number; round: number; slot: number; displayName?: string | null; playerName: string; position: string }>
    slotOrder?: Array<{ slot: number; rosterId: string; displayName: string }>
    metadata?: { rounds?: number; teamCount?: number; draftType?: 'snake' | 'linear' | 'auction'; thirdRoundReversal?: boolean }
  }
}

export function DraftImportFlow({ leagueId, onSuccess, onClose }: DraftImportFlowProps) {
  const [jsonInput, setJsonInput] = useState('')
  const [validateResult, setValidateResult] = useState<ValidateResult | null>(null)
  const [validateLoading, setValidateLoading] = useState(false)
  const [commitLoading, setCommitLoading] = useState(false)
  const [rollbackLoading, setRollbackLoading] = useState(false)
  const [hasBackup, setHasBackup] = useState(false)
  const [importEnabled, setImportEnabled] = useState(true)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const fetchBackupStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/import/backup-status`)
      const data = await res.json().catch(() => ({}))
      setHasBackup(!!data.hasBackup)
      setImportEnabled(data.importEnabled !== false)
    } catch {
      setHasBackup(false)
      setImportEnabled(true)
    }
  }, [leagueId])

  useEffect(() => {
    fetchBackupStatus()
  }, [fetchBackupStatus])

  const handleValidate = useCallback(async () => {
    setMessage(null)
    setValidateLoading(true)
    setValidateResult(null)
    try {
      let payload: unknown
      try {
        payload = jsonInput.trim() ? JSON.parse(jsonInput) : {}
      } catch {
        setValidateResult({ valid: false, parseError: 'Invalid JSON' })
        setValidateLoading(false)
        return
      }
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/import/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload }),
      })
      const data = await res.json().catch(() => ({}))
      setValidateResult({
        valid: data.valid ?? false,
        parseError: data.parseError,
        report: data.report,
        preview: data.preview,
      })
    } catch (e) {
      setValidateResult({ valid: false, parseError: (e as Error).message })
    } finally {
      setValidateLoading(false)
    }
  }, [leagueId, jsonInput])

  const handleCommit = useCallback(async () => {
    if (!validateResult?.valid || !validateResult.preview || validateResult.report?.canProceed === false) return
    setMessage(null)
    setCommitLoading(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/import/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preview: validateResult.preview }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setMessage({ type: 'success', text: 'Import committed. A backup was saved for rollback.' })
        setValidateResult(null)
        setJsonInput('')
        setFileName(null)
        setHasBackup(true)
        onSuccess?.()
      } else {
        setMessage({ type: 'error', text: data.error || 'Commit failed' })
      }
    } catch (e) {
      setMessage({ type: 'error', text: (e as Error).message })
    } finally {
      setCommitLoading(false)
    }
  }, [leagueId, validateResult, onSuccess])

  const handleRollback = useCallback(async () => {
    setMessage(null)
    setRollbackLoading(true)
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/draft/import/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        setMessage({ type: 'success', text: 'Rollback complete. Draft state restored.' })
        setHasBackup(false)
        onSuccess?.()
      } else {
        setMessage({ type: 'error', text: data.error || 'Rollback failed' })
      }
    } catch (e) {
      setMessage({ type: 'error', text: (e as Error).message })
    } finally {
      setRollbackLoading(false)
    }
  }, [leagueId, onSuccess])

  const handleOpenFilePicker = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileInputChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const text = await file.text()
      setJsonInput(text)
      setFileName(file.name)
      setValidateResult(null)
      setMessage(null)
    } catch {
      setMessage({ type: 'error', text: 'Could not read file contents.' })
    } finally {
      event.target.value = ''
    }
  }, [])

  const canCommit = Boolean(validateResult?.valid && validateResult.preview && validateResult.report?.canProceed !== false)
  const preview = validateResult?.preview
  const report = validateResult?.report
  const previewPicks = preview?.picks ?? []
  const previewSlotOrder = preview?.slotOrder ?? []
  const hasReport = Boolean(report && (report.errors.length > 0 || report.warnings.length > 0))

  return (
    <div className="space-y-4 rounded-lg border border-white/10 bg-black/20 p-4" data-testid="draft-import-flow-root">
      <div className="flex items-center gap-2 text-sm font-medium text-white">
        <Upload className="h-4 w-4 text-cyan-400" />
        Import draft data
      </div>
      <p className="text-xs text-white/60">
        Upload or paste JSON with draftOrder, picks, and optionally tradedPicks, keeperConfig, keeperSelections, metadata.
      </p>
      {!importEnabled && (
        <div
          className="rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-200"
          data-testid="draft-import-disabled-message"
        >
          Draft import is currently disabled in draft variant settings.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json,text/plain"
          className="hidden"
          data-testid="draft-import-file-input"
          onChange={handleFileInputChange}
        />
        <button
          type="button"
          onClick={handleOpenFilePicker}
          disabled={!importEnabled}
          className="rounded border border-white/20 bg-black/20 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
          data-testid="draft-import-upload-file"
        >
          Upload JSON file
        </button>
        <span className="text-[11px] text-white/50">{fileName ? `Loaded: ${fileName}` : 'No file selected'}</span>
      </div>
      <textarea
        value={jsonInput}
        onChange={(e) => setJsonInput(e.target.value)}
        disabled={!importEnabled}
        placeholder='{"draftOrder":[{"slot":1,"displayName":"Team 1"},...],"picks":[{"overall":1,"round":1,"slot":1,"playerName":"...","position":"QB",...},...]}'
        className="h-32 w-full rounded border border-white/20 bg-black/40 px-3 py-2 font-mono text-xs text-white placeholder:text-white/40"
        aria-label="Import JSON"
        data-testid="draft-import-json-input"
      />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleValidate}
          disabled={validateLoading || !importEnabled}
          className="rounded bg-cyan-600 px-3 py-1.5 text-xs text-white hover:bg-cyan-500 disabled:opacity-50"
          data-testid="draft-import-validate"
        >
          {validateLoading ? 'Validating...' : 'Validate (dry run)'}
        </button>
        {validateResult?.valid && validateResult.preview && (
          <button
            type="button"
            onClick={handleCommit}
            disabled={commitLoading || !canCommit || !importEnabled}
            className="rounded bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-500 disabled:opacity-50"
            data-testid="draft-import-commit"
          >
            {commitLoading ? 'Committing...' : 'Commit import'}
          </button>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10"
            data-testid="draft-import-cancel"
          >
            Cancel
          </button>
        )}
      </div>

      {validateResult?.parseError && (
        <div className="flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-200" data-testid="draft-import-parse-error">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{validateResult.parseError}</span>
        </div>
      )}
      {hasReport && (
        <div className="space-y-1 rounded border border-white/10 bg-black/30 p-2 text-xs" data-testid="draft-import-report">
          <div className="mb-1 text-white/60">
            {report?.errors.length ?? 0} errors, {report?.warnings.length ?? 0} warnings
          </div>
          {report?.errors.map((e, i) => (
            <div key={i} className="text-red-300">
              <span className="font-medium">{e.code}</span>: {e.message}
              {e.field && <span className="text-white/50"> ({e.field})</span>}
            </div>
          ))}
          {report?.warnings.map((w, i) => (
            <div key={i} className="text-amber-300">
              <span className="font-medium">{w.code}</span>: {w.message}
            </div>
          ))}
        </div>
      )}
      {validateResult?.valid && preview?.summary && (
        <div
          className="flex items-center gap-2 rounded border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-200"
          data-testid="draft-import-preview-summary"
        >
          <CheckCircle className="h-4 w-4 shrink-0" />
          <span>
            Preview: {preview.summary.pickCount} picks, {preview.summary.tradedPickCount} traded picks, {preview.summary.keeperCount} keepers,{' '}
            {preview.summary.slotOrderLength} slots.
          </span>
        </div>
      )}
      {validateResult?.valid && preview?.metadata && (
        <div className="rounded border border-white/10 bg-black/20 p-2 text-[11px] text-white/70">
          Metadata: rounds {preview.metadata.rounds ?? '-'}, teams {preview.metadata.teamCount ?? '-'}, draft type{' '}
          {preview.metadata.draftType ?? '-'}, 3RR {preview.metadata.thirdRoundReversal ? 'yes' : 'no'}
        </div>
      )}
      {validateResult?.valid && previewSlotOrder.length > 0 && (
        <div className="rounded border border-white/10 bg-black/20 p-2 text-xs" data-testid="draft-import-preview-slot-order">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-white/50">Draft order preview</div>
          <div className="space-y-0.5">
            {previewSlotOrder.slice(0, 6).map((entry) => (
              <div key={`${entry.slot}:${entry.rosterId}`} className="text-white/80">
                Slot {entry.slot}: {entry.displayName}
              </div>
            ))}
            {previewSlotOrder.length > 6 && <div className="text-white/40">...and {previewSlotOrder.length - 6} more slots</div>}
          </div>
        </div>
      )}
      {validateResult?.valid && previewPicks.length > 0 && (
        <div className="rounded border border-white/10 bg-black/20 p-2 text-xs" data-testid="draft-import-preview-picks">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-white/50">Pick preview</div>
          <div className="space-y-0.5">
            {previewPicks.slice(0, 6).map((pick) => (
              <div key={`${pick.overall}:${pick.playerName}`} className="text-white/80">
                #{pick.overall} (R{pick.round} S{pick.slot}): {pick.playerName} - {pick.position}
              </div>
            ))}
            {previewPicks.length > 6 && <div className="text-white/40">...and {previewPicks.length - 6} more picks</div>}
          </div>
        </div>
      )}

      {message && (
        <div
          className={`rounded border p-2 text-xs ${
            message.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-red-500/30 bg-red-500/10 text-red-200'
          }`}
          data-testid="draft-import-message"
        >
          {message.text}
        </div>
      )}

      {hasBackup && (
        <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
          <span className="text-xs text-white/60">Last import can be undone.</span>
          <button
            type="button"
            onClick={handleRollback}
            disabled={rollbackLoading || !importEnabled}
            className="inline-flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
            data-testid="draft-import-rollback"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {rollbackLoading ? 'Rolling back...' : 'Rollback last import'}
          </button>
        </div>
      )}
    </div>
  )
}
