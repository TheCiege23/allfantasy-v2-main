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
  // Styled on the Core theme tokens via af-ch-chimmy* (af-commish-hub.css). Tailwind
  // white/colour utilities are forbidden in .af-core: light mode clamps them unreadable.
  return <div className="af-ch-chimmy" data-testid="commissioner-chimmy">
    <h3 className="af-ch-chimmy-title">Ask Chimmy about this league</h3>
    <p className="af-ch-muted">Guidance uses the selected league’s evidence. If this league belongs to a network you own, Chimmy also knows its member names. It cannot make rulings or change settings here.</p>
    <label className="af-ch-chimmy-field">Question<textarea className="af-ch-os-draft" rows={3} maxLength={1000} value={question} onChange={(event) => setQuestion(event.target.value)} /></label>
    <button type="button" className="af-btn af-ch-chimmy-ask" disabled={busy || !question.trim()} onClick={() => void submit()}>{busy ? 'Asking…' : 'Ask Chimmy'}</button>
    {answer?.answer && <div className="af-ch-chimmy-answer" aria-live="polite">{answer.answer}<p className="af-ch-os-stamp">{answer.source === 'template' ? 'Template guidance' : 'AI guidance'} · review evidence before acting.</p></div>}
    {answer?.error && <p className="af-ch-os-note" data-tone="bad" role="alert">{answer.error}</p>}
  </div>
}
