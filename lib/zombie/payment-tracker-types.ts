/**
 * Commissioner payment tracker stored under `ZombieLeague.commissionerUiPrefs.paymentTracker`.
 */
export type ZombiePaymentEntryStatus = 'unpaid' | 'partial' | 'paid' | 'waived'

export type ZombiePaymentTrackerEntry = {
  userId: string
  rosterId: string
  displayName: string
  expectedAmount: number
  amountPaid: number
  status: ZombiePaymentEntryStatus
  paidAt?: string | null
  method?: string | null
  notes?: string | null
  remindersSent: number
}

export type ZombiePaymentTrackerPrefs = {
  dueDate?: string | null
  entries: ZombiePaymentTrackerEntry[]
}

function emptyPaymentTrackerPrefs(): ZombiePaymentTrackerPrefs {
  return { dueDate: null, entries: [] }
}

export function parsePaymentTrackerPrefs(raw: unknown): ZombiePaymentTrackerPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyPaymentTrackerPrefs()
  const o = raw as Record<string, unknown>
  const dueDate = typeof o.dueDate === 'string' ? o.dueDate : o.dueDate === null ? null : undefined
  const entriesRaw = Array.isArray(o.entries) ? o.entries : []
  const entries: ZombiePaymentTrackerEntry[] = []
  for (const row of entriesRaw) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue
    const r = row as Record<string, unknown>
    const userId = typeof r.userId === 'string' ? r.userId : ''
    const rosterId = typeof r.rosterId === 'string' ? r.rosterId : ''
    if (!userId || !rosterId) continue
    const status =
      r.status === 'partial' || r.status === 'paid' || r.status === 'waived' ? r.status : 'unpaid'
    entries.push({
      userId,
      rosterId,
      displayName: typeof r.displayName === 'string' ? r.displayName : 'Manager',
      expectedAmount: typeof r.expectedAmount === 'number' && Number.isFinite(r.expectedAmount) ? r.expectedAmount : 0,
      amountPaid: typeof r.amountPaid === 'number' && Number.isFinite(r.amountPaid) ? r.amountPaid : 0,
      status,
      paidAt: typeof r.paidAt === 'string' ? r.paidAt : r.paidAt === null ? null : undefined,
      method: typeof r.method === 'string' ? r.method : r.method === null ? null : undefined,
      notes: typeof r.notes === 'string' ? r.notes : r.notes === null ? null : undefined,
      remindersSent:
        typeof r.remindersSent === 'number' && Number.isFinite(r.remindersSent) ? Math.max(0, r.remindersSent) : 0,
    })
  }
  return { dueDate: dueDate ?? null, entries }
}

export function mergeTrackerWithRosters(args: {
  saved: ZombiePaymentTrackerPrefs
  rows: {
    userId: string
    rosterId: string
    displayName: string
    defaultExpected: number
  }[]
}): ZombiePaymentTrackerEntry[] {
  const byUser = new Map(args.saved.entries.map((e) => [e.userId, e]))
  return args.rows.map((r) => {
    const prev = byUser.get(r.userId)
    if (prev) {
      return {
        ...prev,
        rosterId: r.rosterId,
        displayName: prev.displayName || r.displayName,
        expectedAmount: prev.expectedAmount > 0 ? prev.expectedAmount : r.defaultExpected,
      }
    }
    return {
      userId: r.userId,
      rosterId: r.rosterId,
      displayName: r.displayName,
      expectedAmount: r.defaultExpected,
      amountPaid: 0,
      status: 'unpaid' as const,
      paidAt: null,
      method: null,
      notes: null,
      remindersSent: 0,
    }
  })
}
