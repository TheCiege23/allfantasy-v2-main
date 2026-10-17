'use client'

/**
 * "Send a test" — asks /api/push/test to send one sample trade alert to this account's devices
 * and says plainly what happened. Shown only once alerts are on (the cards decide that).
 *
 * The failure line carries the server's hint, because "it didn't arrive" has several causes that
 * look identical from the phone, and only Apple's answer tells them apart.
 */

import { useState } from 'react'

type Device = { kind: 'iphone' | 'browser'; ok: boolean; code?: string; hint?: string }
type Result = { tone: 'ok' | 'error'; text: string; code?: string }

function describe(data: { sent?: number; devices?: Device[]; message?: string }, status: number): Result {
  if (status === 429 || status === 409) return { tone: 'error', text: data.message ?? 'Try again in a minute.' }
  if (status === 401) return { tone: 'error', text: 'Sign in again, then retry.' }
  const devices = data.devices ?? []
  const sent = data.sent ?? 0
  if (sent > 0) {
    const failed = devices.find((d) => !d.ok)
    const where = sent === 1 ? 'your device' : `${sent} devices`
    return {
      tone: 'ok',
      text: failed
        ? `Sent to ${where}. One other device didn't accept it: ${failed.hint ?? 'delivery failed.'}`
        : `Sent to ${where}. It should pop up within a few seconds.`,
    }
  }
  const first = devices.find((d) => !d.ok)
  return { tone: 'error', text: first?.hint ?? 'The test could not be sent.', code: first?.code }
}

export function SendTestPushButton() {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  async function send() {
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch('/api/push/test', { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      setResult(describe(data, res.status))
    } catch {
      setResult({ tone: 'error', text: "Couldn't reach AllFantasy. Check your connection and try again." })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3" data-testid="send-test-push">
      <button
        type="button"
        disabled={busy}
        onClick={() => void send()}
        className="min-h-[44px] rounded-lg border border-white/15 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Send a test'}
      </button>
      {result ? (
        <p
          role="status"
          className={`mt-2 text-xs ${result.tone === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}
        >
          {result.text}
          {result.code ? <span className="ml-1 opacity-70">({result.code})</span> : null}
        </p>
      ) : null}
    </div>
  )
}

export default SendTestPushButton
