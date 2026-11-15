'use client'

import { useRef, useState } from 'react'

const SUGGESTIONS = [
  'Who is the best team right now and why?',
  'Which team has the deepest bench?',
  'Who won the most recent trade?',
  'What does League Health say about this league?',
]

/** Shown only when the server's retries and our own silent retry have all failed. */
const FALLBACK_ERROR = "Chimmy couldn't get an answer through just now. Give it another try."
const NETWORK_ERROR = "Couldn't reach Chimmy — check your connection and try again."

type Turn = {
  q: string
  a: string | null
  error?: string
  /** The answer stopped at the model's length limit; offer to continue it. */
  truncated?: boolean
  /** A continue or retry request for this turn is in flight. */
  working?: boolean
}

type ChimmyReply =
  | { ok: true; answer: string; truncated: boolean }
  | { ok: false; status: number; error: string; retryable: boolean }

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * One request, retried ONCE quietly on a 5xx or a dropped connection. The server already retries
 * the model with backoff; this covers the hop between the browser and the server. A 4xx (rate
 * limit, daily cap, bad input) is not retried — waiting a second will not change it.
 */
async function askChimmy(body: { message: string; history: Array<{ q: string; a: string }>; continueFrom?: string }): Promise<ChimmyReply> {
  let last: ChimmyReply = { ok: false, status: 0, error: NETWORK_ERROR, retryable: true }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await sleep(1200)
    try {
      const res = await fetch('/api/demo/chimmy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json().catch(() => ({}))) as { answer?: string; truncated?: boolean; error?: string; retryable?: boolean }
      if (res.ok && typeof json.answer === 'string' && json.answer.trim()) {
        return { ok: true, answer: json.answer, truncated: json.truncated === true }
      }
      last = { ok: false, status: res.status, error: json.error || FALLBACK_ERROR, retryable: res.status >= 500 && json.retryable !== false }
      if (!last.retryable) return last
    } catch {
      last = { ok: false, status: 0, error: NETWORK_ERROR, retryable: true }
    }
  }
  return last
}

export function DemoChimmy() {
  const [input, setInput] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  // Read synchronously inside handlers; state can be one render behind.
  const turnsRef = useRef<Turn[]>([])
  const update = (fn: (t: Turn[]) => Turn[]) => {
    turnsRef.current = fn(turnsRef.current)
    setTurns(turnsRef.current)
  }
  const patch = (index: number, p: Partial<Turn>) => update((t) => t.map((x, i) => (i === index ? { ...x, ...p } : x)))

  /** The finished exchanges before `index`, so a follow-up like "why?" has something to refer to. */
  const historyBefore = (index: number) =>
    turnsRef.current
      .slice(0, index)
      .filter((t) => t.a && !t.error)
      .slice(-3)
      .map((t) => ({ q: t.q, a: t.a! }))

  const run = async (index: number) => {
    const turn = turnsRef.current[index]
    if (!turn) return
    setBusy(true)
    patch(index, { a: null, error: undefined, truncated: false, working: true })
    const reply = await askChimmy({ message: turn.q, history: historyBefore(index) })
    patch(index, reply.ok
      ? { a: reply.answer, truncated: reply.truncated, working: false }
      : { error: reply.error, working: false })
    setBusy(false)
  }

  const ask = async (q: string) => {
    const question = q.trim()
    if (!question || busy) return
    setInput('')
    update((t) => [...t, { q: question, a: null }])
    await run(turnsRef.current.length - 1)
  }

  /** Finish a cut-off answer: the server is sent what was already said and asked to carry on. */
  const continueAnswer = async (index: number) => {
    const turn = turnsRef.current[index]
    if (!turn?.a || busy) return
    setBusy(true)
    patch(index, { working: true })
    const reply = await askChimmy({ message: turn.q, history: historyBefore(index), continueFrom: turn.a })
    if (reply.ok) {
      const joined = /\s$/.test(turn.a) || /^[\s.,;:!?)]/.test(reply.answer) ? turn.a + reply.answer : `${turn.a} ${reply.answer}`
      patch(index, { a: joined, truncated: reply.truncated, working: false })
    } else {
      // Keep the partial answer on screen; the continue button stays so they can try again.
      patch(index, { working: false })
    }
    setBusy(false)
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
              {t.error ? (
                <div className="space-y-2" role="alert">
                  <p>{t.error}</p>
                  <button
                    type="button"
                    onClick={() => void run(i)}
                    disabled={busy}
                    className="af-button-secondary min-h-9 rounded-full px-3 text-xs font-semibold disabled:opacity-50"
                    data-testid="demo-chimmy-retry"
                  >
                    Try again
                  </button>
                </div>
              ) : t.a ? (
                <>
                  {t.a}
                  {t.truncated && (
                    <button
                      type="button"
                      onClick={() => void continueAnswer(i)}
                      disabled={busy}
                      className="mt-2 block text-xs font-semibold underline disabled:opacity-50"
                      data-testid="demo-chimmy-continue"
                    >
                      {t.working ? 'Continuing…' : 'Answer was cut off — tap to continue'}
                    </button>
                  )}
                </>
              ) : (
                <span className="af-muted">Chimmy is thinking…</span>
              )}
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
