'use client'

import { useState } from 'react'

/** Questions most managers ask in their first week, one tap each. */
export const ASK_CHIMMY_STARTERS = [
  'How does Survivor work here?',
  'How does voting work?',
  'When is the merge?',
  'How do idols work?',
  'How does Exile Island work?',
  'What happens in a tie?',
] as const

type Turn = { question: string; answer: string }

/** Private Q&A with the Survivor host. Answers come from this league's settings; nobody else sees them. */
export function AskChimmyCard({ leagueId }: { leagueId: string }) {
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ask = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/survivor/chimmy', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, message: trimmed }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || typeof json.reply !== 'string') throw new Error(typeof json.error === 'string' ? json.error : 'Chimmy could not answer right now.')
      setTurns(previous => [{ question: trimmed, answer: json.reply as string }, ...previous].slice(0, 5))
      setQuestion('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Chimmy could not answer right now.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="sv-chimmy-card rounded-xl border p-4" data-testid="ask-chimmy-card">
      <h2 className="sv-kicker text-[13px]">Ask Chimmy</h2>
      <p className="mt-1 text-[12px] text-white/60">Rules for this league, answered privately.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {ASK_CHIMMY_STARTERS.map(starter => (
          <button key={starter} type="button" disabled={busy} onClick={() => void ask(starter)}
            className="min-h-[36px] rounded-full border border-[rgba(240,163,94,0.34)] px-3 text-[12px] text-[#f6d3ae] hover:bg-[rgba(240,163,94,0.13)] disabled:opacity-40">
            {starter}
          </button>
        ))}
      </div>
      <form className="mt-3 flex gap-2" onSubmit={event => { event.preventDefault(); void ask(question) }}>
        <input aria-label="Ask Chimmy a question" value={question} onChange={event => setQuestion(event.target.value)} maxLength={500}
          placeholder="Ask about voting, idols, the merge…" className="min-h-[44px] min-w-0 flex-1 rounded-lg border border-white/15 bg-black/30 px-3 text-[13px] text-white placeholder:text-white/40 focus:border-[rgba(240,163,94,0.55)] focus:outline-none" />
        <button type="submit" disabled={busy || !question.trim()} className="min-h-[44px] rounded-lg bg-[var(--survivor-torch,#f0a35e)] px-4 text-[13px] font-semibold text-[#1a0f05] disabled:opacity-40">
          {busy ? '…' : 'Ask'}
        </button>
      </form>
      {error && <p role="alert" className="mt-3 text-[12px] text-red-200">{error}</p>}
      <ul className="mt-3 space-y-3">
        {turns.map((turn, index) => (
          <li key={`${index}:${turn.question}`} className="rounded-lg border border-white/10 bg-black/20 p-3">
            <p className="text-[12px] font-semibold text-white/80">{turn.question}</p>
            <p className="mt-2 whitespace-pre-line text-[13px] text-white/75">{turn.answer.replace(/\*\*/g, '')}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}
