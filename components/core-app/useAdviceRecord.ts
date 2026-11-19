'use client'

import { useEffect, useState } from 'react'
import { readLedgerRecordView, type LedgerRecordView } from '@/lib/chimmy-outcomes/ledgerRecord'

/**
 * AllFantasy's graded record across everyone (`GET /api/advice-record`), for the surfaces that show it beside
 * their own call. One request per page load, shared by every caller; a failure is "no record", never an
 * error on the surface — the call it sits beside is the thing the user came for.
 */

let pending: Promise<LedgerRecordView | null> | null = null

export function loadAdviceRecord(): Promise<LedgerRecordView | null> {
  pending ??= fetch('/api/advice-record', { credentials: 'same-origin' })
    .then(async (res) => (res.ok ? readLedgerRecordView(((await res.json().catch(() => null)) as { record?: unknown } | null)?.record) : null))
    .catch(() => null)
  return pending
}

/** Test hook: forget the shared request. */
export function __resetAdviceRecordForTests(): void {
  pending = null
}

export function useAdviceRecord(enabled = true): LedgerRecordView | null {
  const [record, setRecord] = useState<LedgerRecordView | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void loadAdviceRecord().then((r) => {
      if (live) setRecord(r)
    })
    return () => {
      live = false
    }
  }, [enabled])
  return record
}
