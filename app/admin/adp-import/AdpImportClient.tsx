'use client'

import { useEffect, useState } from 'react'
import { SUPPORTED_SPORTS } from '@/lib/sport-scope'
import { validateObservedMarketAdpBoard, type ObservedMarketAdpBoard } from '@/lib/adp/observedMarketAdpBoard'

const INPUT = 'mt-1 w-full rounded-xl border border-white/20 bg-slate-950 p-3 text-white'
const BUTTON = 'rounded-xl bg-cyan-300 px-5 py-3 font-bold text-slate-950 disabled:opacity-40'
type Preview = { board: ObservedMarketAdpBoard; accepted: number }

export default function AdpImportClient() {
  const [interactive, setInteractive] = useState(false)
  useEffect(() => setInteractive(true), [])
  const [sport, setSport] = useState('NFL')
  const [season, setSeason] = useState(String(new Date().getFullYear()))
  const [format, setFormat] = useState<'redraft' | 'dynasty'>('redraft')
  const [scoring, setScoring] = useState('PPR')
  const [json, setJson] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const invalidate = () => { setPreview(null); setMessage(''); setError('') }
  const expected = { sport, season: Number(season), format, scoring: scoring.trim() }

  async function submit(dryRun: boolean) {
    setBusy(true); setError(''); setMessage('')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 300000)
    try {
      if (!dryRun && !preview) throw new Error('Validate this export before importing.')
      const board = validateObservedMarketAdpBoard(dryRun ? JSON.parse(json) : preview!.board, expected)
      const response = await fetch('/api/admin/fantasy-data/adp-import', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify({ dryRun, expected, board }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Export rejected.')
      if (result.dryRun !== dryRun || !Number.isInteger(result.accepted) || result.accepted !== board.players.length) throw new Error('Unexpected import response. Validate the export again.')
      setPreview(dryRun ? { board, accepted: result.accepted } : null)
      setMessage(dryRun ? 'Validation passed. No data has been written.' : `Imported ${result.accepted} player observation${result.accepted === 1 ? '' : 's'}.`)
    } catch (failure) {
      setPreview(null)
      setError(failure instanceof Error && failure.name === 'AbortError' ? 'Request timed out. Check import status before retrying.' : failure instanceof Error ? failure.message : 'Unable to process export.')
    } finally { clearTimeout(timer); setBusy(false) }
  }

  async function loadFile(file?: File) {
    invalidate()
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { setJson(''); setError('Export must be at most 10 MB.'); return }
    setBusy(true)
    try { setJson(await file.text()) } catch { setJson(''); setError('Unable to read this file.') }
    finally { setBusy(false) }
  }

  return <section className="mt-6 rounded-2xl border border-white/15 bg-white/5 p-5">
    <fieldset disabled={busy || !interactive} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label>Sport<select className={INPUT} value={sport} onChange={e => { invalidate(); setSport(e.target.value) }}>{SUPPORTED_SPORTS.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>Season<input className={INPUT} type="number" min="2000" max="2200" value={season} onChange={e => { invalidate(); setSeason(e.target.value) }} /></label>
        <label>Draft format<select className={INPUT} value={format} onChange={e => { invalidate(); setFormat(e.target.value as 'redraft' | 'dynasty') }}><option value="redraft">Redraft</option><option value="dynasty">Dynasty</option></select></label>
        <label>Scoring context<input className={INPUT} maxLength={32} value={scoring} onChange={e => { invalidate(); setScoring(e.target.value) }} /></label>
      </div>
      <p className="text-sm text-white/65">The context must exactly match the export. Observations must be within seven days, include canonical player IDs and sample counts, and declare licensed observed-draft evidence.</p>
      <label className="block">JSON export file<input className="mt-2 block w-full" type="file" accept=".json,application/json" onChange={e => void loadFile(e.target.files?.[0])} /></label>
      <label className="block">Export JSON<textarea className={INPUT + ' min-h-48 font-mono text-xs'} value={json} onChange={e => { invalidate(); setJson(e.target.value) }} /></label>
      <button type="button" className={BUTTON} disabled={!json.trim()} onClick={() => void submit(true)}>Validate export</button>
      {preview && <div className="rounded-xl border border-cyan-200/30 p-4">
        <p>{preview.accepted} players · {preview.board.sport} · {preview.board.season} · {preview.board.format} · {preview.board.scoring}</p>
        <p className="mt-1 text-sm text-white/70">Source: {preview.board.source} · Observed: {preview.board.asOf}</p>
        <p className="my-3 text-sm">Import replaces this source&apos;s board for the matching context and week.</p>
        <button type="button" className={BUTTON} onClick={() => void submit(false)}>Import validated export</button>
      </div>}
    </fieldset>
    {busy && <p role="status" className="mt-4">Processing export…</p>}
    {message && <p role="status" className="mt-4 text-cyan-200">{message}</p>}
    {error && <p role="alert" className="mt-4 whitespace-pre-wrap text-rose-200">{error}</p>}
  </section>
}
