'use client'

import { useState } from 'react'
import { AlertTriangle, Axe, Eye, Lock, Megaphone, RefreshCw, Shield, Users, Wallet } from 'lucide-react'
import type { ChopPreview, ChopPreviewRow } from '@/lib/guillotine/chopPreview'

/**
 * The commissioner's "chop week preview": this week's chop run on the scores as they stand, with
 * nothing written (lib/guillotine/chopPreview.ts). AF Commissioner; a free commissioner gets the
 * upgrade line instead.
 */
const STATUS_LABEL: Record<ChopPreviewRow['status'], string> = { chopped: 'Chopped', danger: 'Danger zone', immune: 'Immune', safe: 'Safe' }

export function GuillotineChopPreview({ leagueId }: { leagueId: string }) {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ready'; preview: ChopPreview }
    | { kind: 'locked'; upgrade: string }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  const load = async () => {
    setState({ kind: 'loading' })
    try {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/guillotine/summary?view=preview`, { credentials: 'include', cache: 'no-store' })
      const d = await res.json().catch(() => ({}))
      if (res.status === 402) {
        setState({ kind: 'locked', upgrade: typeof d?.upgradePath === 'string' && d.upgradePath.startsWith('/') ? d.upgradePath : '/commissioner-upgrade' })
        return
      }
      if (!res.ok) {
        setState({ kind: 'error', message: d?.error ?? 'Could not build the preview.' })
        return
      }
      setState({ kind: 'ready', preview: d as ChopPreview })
    } catch {
      setState({ kind: 'error', message: 'Could not reach the server. Try again.' })
    }
  }

  return (
    <div className="mt-4 border-t border-white/10 pt-4" data-testid="guillotine-chop-preview">
      <strong className="block text-[13px] uppercase tracking-wide opacity-70">Chop week preview</strong>
      <p className="mt-1 text-[12px] opacity-60">See who would be chopped, the danger zone, the FAAB split and the chat post before anything runs. Nothing changes.</p>
      <div className="nl-actions mt-2">
        <button type="button" className="nl-button" disabled={state.kind === 'loading'} onClick={() => void load()} data-testid="guillotine-chop-preview-open">
          {state.kind === 'ready' ? <RefreshCw size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
          {state.kind === 'loading' ? 'Checking this week…' : state.kind === 'ready' ? 'Refresh the preview' : "Preview this week's chop"}
        </button>
      </div>

      {state.kind === 'locked' ? (
        <p role="status" className="mt-2 text-[12px] opacity-80" data-testid="guillotine-chop-preview-locked">
          <Lock size={12} aria-hidden className="mr-1 inline" />
          The chop preview is part of AF Commissioner. <a href={state.upgrade} className="font-semibold underline">Upgrade</a>
        </p>
      ) : null}
      {state.kind === 'error' ? <p role="status" className="mt-2 text-[12px] opacity-80">{state.message}</p> : null}
      {state.kind === 'ready' ? <PreviewBody preview={state.preview} /> : null}
    </div>
  )
}

function PreviewBody({ preview }: { preview: ChopPreview }) {
  return (
    <div className="mt-3 space-y-3" data-testid="guillotine-chop-preview-body" data-outcome={preview.outcome}>
      <p className="text-[14px] font-semibold" data-testid="guillotine-chop-preview-headline">{preview.headline}</p>

      {preview.blockers.length ? (
        <ul className="space-y-1 rounded-lg border border-amber-400/40 p-2 text-[12px]" data-testid="guillotine-chop-preview-blockers">
          {preview.blockers.map((b) => (
            <li key={b} className="flex gap-2"><AlertTriangle size={14} aria-hidden className="mt-0.5 shrink-0 text-amber-300" />{b}</li>
          ))}
        </ul>
      ) : null}

      {preview.rows.length ? (
        <table className="w-full text-[13px]" data-testid="guillotine-chop-preview-table">
          <caption className="sr-only">Week {preview.week} scores, lowest first</caption>
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide opacity-60">
              <th scope="col" className="py-1 font-semibold">Team</th>
              <th scope="col" className="py-1 text-right font-semibold">Points</th>
              <th scope="col" className="py-1 text-right font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {preview.rows.map((row) => (
              <tr key={row.rosterId} className="border-t border-white/5" data-status={row.status} data-testid={`guillotine-chop-preview-row-${row.rosterId}`}>
                <td className="py-1.5 pr-2">
                  {row.name}
                  {row.faabChange ? (
                    <span className="block text-[11px] opacity-60">FAAB {row.faabChange > 0 ? `+$${row.faabChange}` : `−$${Math.abs(row.faabChange)}`}</span>
                  ) : null}
                </td>
                <td className="py-1.5 text-right tabular-nums">{row.points.toFixed(1)}</td>
                <td className="py-1.5 text-right">
                  <span className={row.status === 'chopped' ? 'font-semibold text-red-300' : row.status === 'danger' ? 'text-amber-300' : row.status === 'immune' ? 'text-sky-300' : 'opacity-60'}>
                    {row.status === 'chopped' ? <Axe size={12} aria-hidden className="mr-1 inline" /> : row.status === 'immune' ? <Shield size={12} aria-hidden className="mr-1 inline" /> : null}
                    {STATUS_LABEL[row.status]}
                    {row.status === 'danger' && row.margin != null ? ` (+${row.margin.toFixed(1)})` : ''}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {preview.outcome === 'chop' ? (
        <ul className="space-y-2 text-[13px]">
          {preview.chopLine != null ? (
            <li className="flex gap-2"><Axe size={16} aria-hidden className="mt-0.5 shrink-0 opacity-70" /><span>Chop line: {preview.chopLine.toFixed(1)} points{preview.tiebreak ? `. A tie on the line goes to: ${preview.tiebreak}.` : '.'}</span></li>
          ) : null}
          {preview.release ? (
            <li className="flex gap-2"><Users size={16} aria-hidden className="mt-0.5 shrink-0 opacity-70" /><span>{preview.release.players} {preview.release.players === 1 ? 'player goes' : 'players go'} to waivers — {preview.release.when.toLowerCase()}.</span></li>
          ) : null}
          {preview.faab ? (
            <li className="flex gap-2" data-testid="guillotine-chop-preview-faab"><Wallet size={16} aria-hidden className="mt-0.5 shrink-0 opacity-70" /><span>{preview.faab.note}</span></li>
          ) : null}
          {preview.announcement ? (
            <li className="flex gap-2"><Megaphone size={16} aria-hidden className="mt-0.5 shrink-0 opacity-70" /><span>League chat will say: <q data-testid="guillotine-chop-preview-announcement">{preview.announcement}</q></span></li>
          ) : null}
        </ul>
      ) : null}

      {preview.notes.map((n) => (
        <p key={n} className="text-[12px] opacity-70">{n}</p>
      ))}
    </div>
  )
}
