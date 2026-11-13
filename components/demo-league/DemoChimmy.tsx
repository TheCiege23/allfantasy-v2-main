'use client'

import { useState } from 'react'

const SUGGESTIONS = [
  'Who is the best team right now and why?',
  'Which team has the deepest bench?',
  'Who won the most recent trade?',
  'What does League Health say about this league?',
]

type Turn = { q: string; a: string | null; error?: string }

export function DemoChimmy() {
  const [input, setInput] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)

  const ask = async (q: string) => {
    const question = q.trim()
    if (!question || busy) return
    setBusy(true)
    setInput('')
    setTurns((t) => [...t, { q: question, a: null }])
    try {
      const res = await fetch('/api/demo/chimmy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: question }),
      })
      const json = (await res.json().catch(() => ({}))) as { answer?: string; error?: string }
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, a: json.answer ?? null, error: res.ok ? undefined : json.error ?? 'Chimmy is unavailable right now.' } : x)))
    } catch {
      setTurns((t) => t.map((x, i) => (i === t.length - 1 ? { ...x, error: 'Network error — try again.' } : x)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" onClick={() => void ask(s)} disabled={busy} className="af-button-secondary min-h-9 rounded-full px-3 text-xs font-semibold disabled:opacity-50">
            {s}
          </button>
        ))}
      </div>
      <ul className="space-y-3" aria-live="polite">
        {turns.map((t, i) => (
          <li key={i} className="space-y-2">
            <p className="af-card-soft ml-auto w-fit max-w-[85%] p-3 text-sm">{t.q}</p>
            <div className="af-card w-fit max-w-[90%] whitespace-pre-wrap p-3 text-sm" data-testid="demo-chimmy-answer">
              {t.error ? <span style={{ color: 'var(--color-danger)' }}>{t.error}</span> : t.a ?? <span className="af-muted">Chimmy is thinking…</span>}
            </div>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void ask(input)
        }}
        className="flex gap-2"
      >
        <label htmlFor="demo-chimmy-input" className="sr-only">Ask Chimmy about the demo league</label>
        <input
          id="demo-chimmy-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={500}
          placeholder="Ask about standings, rosters, trades…"
          className="af-control min-w-0 flex-1 px-3 text-sm"
        />
        <button type="submit" disabled={busy || !input.trim()} className="af-button-primary min-h-11 rounded-xl px-5 text-sm font-semibold disabled:opacity-50">
          Ask
        </button>
      </form>
    </div>
  )
}
