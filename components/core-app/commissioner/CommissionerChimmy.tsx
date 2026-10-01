'use client'

import { useState } from 'react'

type ChatResult = { answer?: string; source?: 'ai' | 'template'; error?: string; code?: string; preview?: { tokenCost?: number; currentBalance?: number } }

/** Read-only commissioner guidance. The chat route checks league role and token consent. */
export function CommissionerChimmy({ leagueId }: { leagueId: string }) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<ChatResult | null>(null)
  const [busy, setBusy] = useState(false)
  const ask = async (confirmed: boolean): Promise<ChatResult> => {
    const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/ai-commissioner/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: question.trim(), confirmTokenSpend: confirmed }),
    })
    const result = await response.json() as ChatResult
    if (!response.ok && result.code !== 'token_confirmation_required') throw new Error(result.error ?? 'Chimmy could not answer')
    return result
  }
  const submit = async () => {
    if (!question.trim()) return
    setBusy(true); setAnswer(null)
    try {
      let result = await ask(false)
      if (result.code === 'token_confirmation_required') {
        const cost = result.preview?.tokenCost
        const accepted = window.confirm(`Use ${cost ?? 'the stated number of'} token${cost === 1 ? '' : 's'} for this commissioner question? Current balance: ${result.preview?.currentBalance ?? 'unknown'}.`)
        if (!accepted) return
        result = await ask(true)
      }
      setAnswer(result)
    } catch (cause) { setAnswer({ error: cause instanceof Error ? cause.message : 'Chimmy could not answer' }) }
    finally { setBusy(false) }
  }
  return <div className="mt-4 rounded border border-white/15 p-4" data-testid="commissioner-chimmy">
    <h3 className="font-semibold">Ask Chimmy about this league</h3>
    <p className="mt-1 text-sm opacity-70">Guidance uses the selected league’s evidence. If this league belongs to a network you own, Chimmy also knows its member names. It cannot make rulings or change settings here.</p>
    <label className="mt-3 block text-sm">Question<textarea className="mt-1 block w-full rounded border border-white/25 bg-transparent p-2" rows={3} maxLength={1000} value={question} onChange={(event) => setQuestion(event.target.value)} /></label>
    <button type="button" className="mt-3 rounded border border-amber-400/60 px-3 py-2 text-sm" disabled={busy || !question.trim()} onClick={() => void submit()}>{busy ? 'Asking…' : 'Ask Chimmy'}</button>
    {answer?.answer && <div className="mt-3 whitespace-pre-wrap text-sm" aria-live="polite">{answer.answer}<p className="mt-2 opacity-60">{answer.source === 'template' ? 'Template guidance' : 'AI guidance'} · review evidence before acting.</p></div>}
    {answer?.error && <p className="mt-3 text-sm text-red-300" role="alert">{answer.error}</p>}
  </div>
}
