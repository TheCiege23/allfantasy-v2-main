'use client'

import { useEffect, useState } from 'react'
import { readLedgerRecordView, type LedgerRecordView } from '@/lib/chimmy-outcomes/ledgerRecord'
import { readInactiveFlagView, type InactiveFlagView } from '@/lib/commissioner-hub/inactiveFlagView'

/**
 * AllFantasy's graded record across everyone (`GET /api/advice-record`), for the surfaces that show it beside
 * their own call. One request per page load, shared by every caller; a failure is "no record", never an
 * error on the surface — the call it sits beside is the thing the user came for.
 */

let pending: Promise<{ record?: unknown; inactiveFlags?: unknown } | null> | null = null

/** The one request behind every reader below. */
function loadAdviceRecordBody(): Promise<{ record?: unknown; inactiveFlags?: unknown } | null> {
  pending ??= fetch('/api/advice-record', { credentials: 'same-origin' })
    .then(async (res) => (res.ok ? ((await res.json().catch(() => null)) as { record?: unknown; inactiveFlags?: unknown } | null) : null))
    .catch(() => null)
  return pending
}

export function loadAdviceRecord(): Promise<LedgerRecordView | null> {
  return loadAdviceRecordBody().then((b) => readLedgerRecordView(b?.record))
}

/** The commissioner "inactive" flag's graded record (`lib/commissioner-hub/inactiveFlagLedger.ts`). */
export function loadInactiveFlagRecord(): Promise<InactiveFlagView | null> {
  return loadAdviceRecordBody().then((b) => readInactiveFlagView(b?.inactiveFlags))
}

/** Test hook: forget the shared request. */
export function __resetAdviceRecordForTests(): void {
  pending = null
}

export function useInactiveFlagRecord(enabled = true): InactiveFlagView | null {
  const [record, setRecord] = useState<InactiveFlagView | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void loadInactiveFlagRecord().then((r) => {
      if (live) setRecord(r)
    })
    return () => {
      live = false
    }
  }, [enabled])
  return record
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
