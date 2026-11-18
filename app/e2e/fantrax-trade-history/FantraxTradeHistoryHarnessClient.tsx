'use client'

import { useEffect, useState } from 'react'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-import.css'
import { FantraxTradeHistoryUpload } from '@/components/core-app/import/FantraxTradeHistoryUpload'

/**
 * Renders the trade-history upload panel inside the import screen's own root
 * classes, with the upload endpoint stubbed so each result state can be shown.
 * `?state=` picks the canned response; `?auto=1` submits a sample file on load so
 * the result is on screen without a manual upload.
 */

const RESPONSES: Record<string, { status: number; body: Record<string, unknown> }> = {
  ok: {
    status: 200,
    body: { pickTradesInFile: 10, added: 10, stored: 10, unreadablePickRows: 0, unknownTeams: [], rounds: [1, 2, 3, 4, 5] },
  },
  warn: {
    status: 200,
    body: {
      pickTradesInFile: 4, added: 3, stored: 13, unreadablePickRows: 1,
      unknownTeams: ['#27 Houston Oilers'], rounds: [2, 5, 6, 7],
    },
  },
  err: {
    status: 400,
    body: {
      error:
        'That does not look like a Fantrax trade history export. On Fantrax, open Transactions, History, Trades, then download the CSV.',
    },
  },
}

export default function FantraxTradeHistoryHarnessClient() {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const state = params.get('state') ?? 'ok'
    const canned = RESPONSES[state] ?? RESPONSES.ok!
    const realFetch = window.fetch.bind(window)
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/api/league/import/fantrax/trade-history')) {
        return new Response(JSON.stringify(canned.body), {
          status: canned.status,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return realFetch(input, init)
    }) as typeof window.fetch
    setReady(true)

    /*
     * Timers are cleared on cleanup because React's dev-mode double mount runs
     * this effect twice: two submits race, and the second one fires after the
     * first has already cleared the chosen file, leaving an error on screen.
     */
    const timers: number[] = []
    if (params.get('auto') === '1') {
      /* Give React a tick to mount the form, then fill it and submit. */
      timers.push(window.setTimeout(() => {
        const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')
        const form = document.querySelector<HTMLFormElement>('form')
        if (!fileInput || !form) return
        const transfer = new DataTransfer()
        transfer.items.add(new File(['"Player","From","To"'], 'Fantrax-Transaction-History-Trade.csv', { type: 'text/csv' }))
        fileInput.files = transfer.files
        fileInput.dispatchEvent(new Event('change', { bubbles: true }))
        timers.push(window.setTimeout(() => form.requestSubmit(), 50))
      }, 100))
    }
    return () => {
      timers.forEach((t) => window.clearTimeout(t))
      window.fetch = realFetch
    }
  }, [])

  return (
    <div className="af-core af-im" style={{ minHeight: '100vh', padding: 24 }}>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        {ready ? <FantraxTradeHistoryUpload defaultLeagueId="tau9a8fomvmq84sx" /> : null}
      </div>
    </div>
  )
}
