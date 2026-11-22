'use client'

import { useState } from 'react'
import { useSurvivorAiRequest } from '@/hooks/useSurvivorAiRequest'
import { SurvivorTokenSpendConfirmDialog } from '@/components/survivor/SurvivorTokenSpendConfirmDialog'

/**
 * Developer / commissioner smoke test: runs a metered Survivor AI type (tribal_help = 2 tokens for subscribers).
 * Demonstrates 409 → confirm → retry flow.
 */
export function SurvivorAiMeteredSmokeButton({ leagueId }: { leagueId: string }) {
  const { run, loading } = useSurvivorAiRequest()
  const [msg, setMsg] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{ cost: number; label?: string } | null>(null)

  const execute = async (confirmed: boolean) => {
    if (confirmed) setDialog(null)
    setMsg(null)
    const r = await run(leagueId, 'tribal_help', confirmed)
    if (r.ok && r.body?.narrative) {
      setMsg('OK — Chimmy response received (metered path satisfied).')
      setDialog(null)
      return
    }
    if (r.status === 409 && r.body?.code === 'token_confirmation_required' && r.body.preview) {
      setDialog({
        cost: Number(r.body.preview.tokenCost ?? 2),
        label: r.body.preview.featureLabel ?? 'Survivor Chimmy — tribal_help',
      })
      setMsg('Confirmation required — use the dialog to spend tokens.')
      return
    }
    setDialog(null)
    setMsg(r.body?.message ?? r.body?.error ?? `Request failed (${r.status})`)
  }

  return (
    <div className="rounded-xl border border-white/[0.08] bg-black/25 px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">API smoke test</p>
      <p className="mt-1 text-xs text-white/55">
        Runs <span className="font-mono text-white/80">tribal_help</span> (2-token rule for subscribers). Opens confirm
        dialog when the server requires explicit spend.
      </p>
      <button
        type="button"
        disabled={loading}
        onClick={() => void execute(false)}
        className="mt-3 rounded-xl border border-violet-500/35 bg-violet-500/10 px-4 py-2 text-xs font-semibold text-violet-100 hover:bg-violet-500/20 disabled:opacity-50"
        data-testid="survivor-ai-smoke-tribal-help"
      >
        {loading ? 'Running…' : 'Run tribal_help (metered)'}
      </button>
      {msg ? <p className="mt-2 text-xs text-white/60">{msg}</p> : null}

      <SurvivorTokenSpendConfirmDialog
        open={dialog !== null}
        title="Confirm Survivor Chimmy spend"
        tokenCost={dialog?.cost ?? 2}
        featureLabel={dialog?.label}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          void execute(true)
        }}
      />
    </div>
  )
}
