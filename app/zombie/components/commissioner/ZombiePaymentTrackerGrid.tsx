'use client'

import { useCallback, useEffect, useState } from 'react'
import { SettingsSection, SettingsRow, Input } from '@/app/league/[leagueId]/tabs/settings/components'
import type { ZombiePaymentEntryStatus, ZombiePaymentTrackerEntry } from '@/lib/zombie/payment-tracker-types'

type TrackerResponse = {
  isPaid: boolean
  dueDate: string | null
  entries: ZombiePaymentTrackerEntry[]
  canEdit: boolean
}

export function ZombiePaymentTrackerGrid({ leagueId, canEdit }: { leagueId: string; canEdit: boolean }) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<TrackerResponse | null>(null)
  const [dueDate, setDueDate] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/zombie/payment-tracker?leagueId=${encodeURIComponent(leagueId)}`, {
        credentials: 'include',
      })
      if (!res.ok) return
      const j = (await res.json()) as TrackerResponse
      setData(j)
      setDueDate(j.dueDate ?? '')
    } finally {
      setLoading(false)
    }
  }, [leagueId])

  useEffect(() => {
    void load()
  }, [load])

  const persist = async (next: { entries: ZombiePaymentTrackerEntry[]; dueDate?: string | null }) => {
    const bodyDue = next.dueDate === undefined ? (dueDate || null) : next.dueDate
    await fetch('/api/zombie/payment-tracker', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        leagueId,
        entries: next.entries,
        dueDate: bodyDue,
      }),
    }).catch(() => {})
    void load()
  }

  const exportCsv = () => {
    if (!data?.entries.length) return
    const headers = ['displayName', 'userId', 'expectedAmount', 'amountPaid', 'status', 'method', 'notes', 'remindersSent']
    const lines = [headers.join(',')]
    for (const e of data.entries) {
      lines.push(
        [
          JSON.stringify(e.displayName),
          e.userId,
          e.expectedAmount,
          e.amountPaid,
          e.status,
          JSON.stringify(e.method ?? ''),
          JSON.stringify(e.notes ?? ''),
          e.remindersSent,
        ].join(','),
      )
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `zombie-payments-${leagueId.slice(0, 8)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading) return <p className="text-[12px] text-white/45">Loading payment tracker…</p>
  if (!data?.isPaid) {
    return (
      <p className="text-[11px] text-white/40">
        Payment tracking is available when the league is set to <span className="text-white/60">Paid</span> mode.
      </p>
    )
  }

  const editable = canEdit && data.canEdit
  const rows = data.entries

  return (
    <SettingsSection id="zm-payment-tracker" title="Member payment tracker">
      <p className="mb-3 text-[11px] leading-relaxed text-white/45">
        Commissioner-only notes; members see amounts and status without notes. Export is CSV for your records.
      </p>
      <SettingsRow
        label="Due date"
        description="Shown in reminders — optional."
        control={
          <Input
            type="date"
            className="w-44"
            disabled={!editable}
            value={dueDate ? dueDate.slice(0, 10) : ''}
            onChange={(e) => setDueDate(e.target.value)}
            onBlur={() => void persist({ entries: rows, dueDate: dueDate || null })}
            data-testid="zombie-payment-due-date"
          />
        }
      />
      <div className="mb-2 flex justify-end">
        <button
          type="button"
          disabled={!editable}
          className="rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-[11px] text-white/80 hover:bg-white/10 disabled:opacity-40"
          onClick={() => exportCsv()}
          data-testid="zombie-payment-export-csv"
        >
          Export CSV
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full min-w-[720px] border-collapse text-left text-[11px]">
          <thead className="bg-white/[0.04] text-white/55">
            <tr>
              <th className="px-2 py-2 font-semibold">Team</th>
              <th className="px-2 py-2 font-semibold">Due</th>
              <th className="px-2 py-2 font-semibold">Paid</th>
              <th className="px-2 py-2 font-semibold">Status</th>
              <th className="px-2 py-2 font-semibold">Method</th>
              {editable && <th className="px-2 py-2 font-semibold">Notes</th>}
              <th className="px-2 py-2 font-semibold">Nudges</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.userId} className="border-t border-white/10">
                <td className="px-2 py-2 text-white/90">{e.displayName}</td>
                <td className="px-2 py-2">
                  <Input
                    type="number"
                    className="w-20"
                    disabled={!editable}
                    value={e.expectedAmount}
                    onChange={(ev) => {
                      const v = Number(ev.target.value) || 0
                      if (!data) return
                      setData({
                        ...data,
                        entries: rows.map((x) => (x.userId === e.userId ? { ...x, expectedAmount: v } : x)),
                      })
                    }}
                    onBlur={(ev) => {
                      const v = Number(ev.target.value) || 0
                      const next = rows.map((x) => (x.userId === e.userId ? { ...x, expectedAmount: v } : x))
                      void persist({ entries: next })
                    }}
                  />
                </td>
                <td className="px-2 py-2">
                  <Input
                    type="number"
                    className="w-20"
                    disabled={!editable}
                    value={e.amountPaid}
                    onChange={(ev) => {
                      const v = Number(ev.target.value) || 0
                      if (!data) return
                      setData({
                        ...data,
                        entries: rows.map((x) => (x.userId === e.userId ? { ...x, amountPaid: v } : x)),
                      })
                    }}
                    onBlur={(ev) => {
                      const v = Number(ev.target.value) || 0
                      const next = rows.map((x) => (x.userId === e.userId ? { ...x, amountPaid: v } : x))
                      void persist({ entries: next })
                    }}
                  />
                </td>
                <td className="px-2 py-2">
                  <select
                    className="rounded border border-white/15 bg-[#050a18] px-1.5 py-1 text-white disabled:opacity-50"
                    disabled={!editable}
                    value={e.status}
                    onChange={(ev) => {
                      const status = ev.target.value as ZombiePaymentEntryStatus
                      const next = rows.map((x) => (x.userId === e.userId ? { ...x, status } : x))
                      if (data) setData({ ...data, entries: next })
                      void persist({ entries: next })
                    }}
                    data-testid={`zombie-payment-status-${e.userId.slice(0, 6)}`}
                  >
                    <option value="unpaid">unpaid</option>
                    <option value="partial">partial</option>
                    <option value="paid">paid</option>
                    <option value="waived">waived</option>
                  </select>
                </td>
                <td className="px-2 py-2">
                  <Input
                    className="w-28"
                    disabled={!editable}
                    placeholder="LS / FC / etc."
                    value={e.method ?? ''}
                    onChange={(ev) => {
                      const v = ev.target.value
                      if (!data) return
                      setData({
                        ...data,
                        entries: rows.map((x) => (x.userId === e.userId ? { ...x, method: v } : x)),
                      })
                    }}
                    onBlur={(ev) => {
                      const v = ev.target.value
                      const next = rows.map((x) => (x.userId === e.userId ? { ...x, method: v } : x))
                      void persist({ entries: next })
                    }}
                  />
                </td>
                {editable && (
                  <td className="px-2 py-2">
                    <Input
                      className="w-36"
                      disabled={!editable}
                      value={e.notes ?? ''}
                      onChange={(ev) => {
                        const v = ev.target.value
                        if (!data) return
                        setData({
                          ...data,
                          entries: rows.map((x) => (x.userId === e.userId ? { ...x, notes: v } : x)),
                        })
                      }}
                      onBlur={(ev) => {
                        const v = ev.target.value
                        const next = rows.map((x) => (x.userId === e.userId ? { ...x, notes: v } : x))
                        void persist({ entries: next })
                      }}
                    />
                  </td>
                )}
                <td className="px-2 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-white/60">{e.remindersSent}</span>
                    <button
                      type="button"
                      disabled={!editable}
                      className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-100/95 disabled:opacity-40"
                      onClick={() => {
                        const next = rows.map((x) =>
                          x.userId === e.userId ? { ...x, remindersSent: x.remindersSent + 1 } : x,
                        )
                        if (data) setData({ ...data, entries: next })
                        void persist({ entries: next })
                      }}
                      data-testid={`zombie-payment-nudge-${e.userId.slice(0, 6)}`}
                    >
                      +1 nudge
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SettingsSection>
  )
}
