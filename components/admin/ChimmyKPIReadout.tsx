'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'

type StatTotals = {
  messages_sent: number
  responses_rendered: number
  chip_clicks: number
  followup_clicks: number
  helpful: number
  unhelpful: number
  helpful_rate: number | null
  chip_click_through_rate: number | null
  followup_click_through_rate: number | null
  formatter_fallback_count: number
  contract_validation_failure_count: number
  mode_changes: number
}

type SurfaceRow = {
  surface: string
  messages_sent: number
  responses_rendered: number
  chip_clicks: number
  followup_clicks: number
  helpful: number
  unhelpful: number
}

type ModeRow = {
  mode: string
  messages_sent: number
  responses_rendered: number
  chip_clicks: number
  followup_clicks: number
  helpful: number
  unhelpful: number
}

type TopicRow = {
  topic: string
  messages_sent: number
  helpful: number
  unhelpful: number
}

type DayRow = {
  date: string
  messages_sent: number
  responses_rendered: number
  chip_clicks: number
  followup_clicks: number
  helpful: number
  unhelpful: number
}

type ChimmyRollup = {
  period: { from: string; to: string }
  totals: StatTotals
  by_surface: SurfaceRow[]
  by_mode: ModeRow[]
  by_topic: TopicRow[]
  by_day: DayRow[]
  event_count: number
}

type RollupResponse = {
  ok: boolean
  rollup?: ChimmyRollup
  truncated?: boolean
  error?: string
}

function toISODate(input: Date): string {
  return input.toISOString().slice(0, 10)
}

function getLastNDaysRange(days: number, now: Date = new Date()): { from: string; to: string } {
  const safeDays = Number.isFinite(days) ? Math.max(1, Math.floor(days)) : 7
  const end = new Date(now)
  end.setUTCHours(0, 0, 0, 0)

  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - (safeDays - 1))

  return { from: toISODate(start), to: toISODate(end) }
}

function formatPercent(value: number | null): string {
  if (value == null || Number.isNaN(value)) return '-'
  return `${(value * 100).toFixed(1)}%`
}

export function ChimmyKPIReadout() {
  const defaults = useMemo(() => getLastNDaysRange(7), [])
  const [from, setFrom] = useState(defaults.from)
  const [to, setTo] = useState(defaults.to)

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rollup, setRollup] = useState<ChimmyRollup | null>(null)
  const [truncated, setTruncated] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ from, to })
      const res = await fetch(`/api/ai/analytics/rollup?${params.toString()}`, { cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as RollupResponse

      if (!res.ok || !data.ok || !data.rollup) {
        setRollup(null)
        setTruncated(false)
        setError(data.error || 'Failed to load Chimmy KPI rollup.')
        return
      }

      setRollup(data.rollup)
      setTruncated(Boolean(data.truncated))
    } catch {
      setRollup(null)
      setTruncated(false)
      setError('Failed to load Chimmy KPI rollup.')
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => {
    void load()
  }, [load])

  const totals = rollup?.totals

  return React.createElement('section', { className: 'space-y-4', 'data-testid': 'chimmy-kpi-readout' }, [
    React.createElement('div', { key: 'controls-wrap', className: 'rounded-2xl border border-white/10 bg-white/[0.03] p-4' },
      React.createElement('div', { className: 'flex flex-wrap items-end gap-3' }, [
        React.createElement('label', { key: 'from-label', className: 'text-sm' }, [
          React.createElement('span', { key: 'from-text', className: 'mb-1 block text-white/70' }, 'From'),
          React.createElement('input', {
            key: 'from-input',
            'data-testid': 'chimmy-kpi-from',
            type: 'date',
            value: from,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setFrom(e.target.value),
            className: 'rounded-lg border border-white/15 bg-[#111a2b] px-3 py-2 text-white',
          }),
        ]),
        React.createElement('label', { key: 'to-label', className: 'text-sm' }, [
          React.createElement('span', { key: 'to-text', className: 'mb-1 block text-white/70' }, 'To'),
          React.createElement('input', {
            key: 'to-input',
            'data-testid': 'chimmy-kpi-to',
            type: 'date',
            value: to,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTo(e.target.value),
            className: 'rounded-lg border border-white/15 bg-[#111a2b] px-3 py-2 text-white',
          }),
        ]),
        React.createElement(
          'button',
          {
            key: 'refresh',
            'data-testid': 'chimmy-kpi-refresh',
            type: 'button',
            onClick: () => void load(),
            disabled: loading,
            className: 'rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60',
          },
          loading ? 'Refreshing...' : 'Refresh'
        ),
        truncated
          ? React.createElement(
              'p',
              { key: 'truncated', 'data-testid': 'chimmy-kpi-truncated', className: 'text-xs text-amber-300' },
              'Showing capped result set from the API rollup query.'
            )
          : null,
      ])
    ),
    error
      ? React.createElement(
          'div',
          {
            key: 'error',
            'data-testid': 'chimmy-kpi-error',
            className: 'rounded-xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100',
          },
          error
        )
      : null,
    React.createElement('div', { key: 'metrics', className: 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3' }, [
      React.createElement(Metric, { key: 'm1', label: 'Messages sent', value: totals?.messages_sent ?? 0, testId: 'chimmy-kpi-messages' }),
      React.createElement(Metric, {
        key: 'm2',
        label: 'Responses rendered',
        value: totals?.responses_rendered ?? 0,
        testId: 'chimmy-kpi-responses',
      }),
      React.createElement(Metric, { key: 'm3', label: 'Chip clicks', value: totals?.chip_clicks ?? 0, testId: 'chimmy-kpi-chip-clicks' }),
      React.createElement(Metric, {
        key: 'm4',
        label: 'Follow-up clicks',
        value: totals?.followup_clicks ?? 0,
        testId: 'chimmy-kpi-followup-clicks',
      }),
      React.createElement(Metric, { key: 'm5', label: 'Helpful', value: totals?.helpful ?? 0, testId: 'chimmy-kpi-helpful' }),
      React.createElement(Metric, { key: 'm6', label: 'Unhelpful', value: totals?.unhelpful ?? 0, testId: 'chimmy-kpi-unhelpful' }),
      React.createElement(Metric, {
        key: 'm7',
        label: 'Helpful rate',
        value: formatPercent(totals?.helpful_rate ?? null),
        testId: 'chimmy-kpi-helpful-rate',
      }),
      React.createElement(Metric, {
        key: 'm8',
        label: 'Formatter fallback count',
        value: totals?.formatter_fallback_count ?? 0,
        testId: 'chimmy-kpi-formatter-fallback',
      }),
      React.createElement(Metric, {
        key: 'm9',
        label: 'Contract validation failure count',
        value: totals?.contract_validation_failure_count ?? 0,
        testId: 'chimmy-kpi-contract-failures',
      }),
    ]),
    React.createElement(
      GridSection,
      {
        key: 'surface',
        title: 'By surface',
        testId: 'chimmy-kpi-by-surface',
        emptyLabel: 'No surface data.',
      },
      (rollup?.by_surface ?? []).map((row) =>
        React.createElement(
          'div',
          {
            key: `surface-${row.surface}`,
            className: 'flex items-center justify-between border-b border-white/10 py-2 text-sm',
          },
          [
            React.createElement('span', { key: 'name' }, row.surface),
            React.createElement('span', { key: 'count' }, `${row.messages_sent} msg`),
          ],
        ),
      ),
    ),
    React.createElement(
      GridSection,
      {
        key: 'mode',
        title: 'By mode',
        testId: 'chimmy-kpi-by-mode',
        emptyLabel: 'No mode data.',
      },
      (rollup?.by_mode ?? []).map((row) =>
        React.createElement(
          'div',
          {
            key: `mode-${row.mode}`,
            className: 'flex items-center justify-between border-b border-white/10 py-2 text-sm',
          },
          [
            React.createElement('span', { key: 'name' }, row.mode),
            React.createElement('span', { key: 'count' }, `${row.messages_sent} msg`),
          ],
        ),
      ),
    ),
    React.createElement(
      GridSection,
      {
        key: 'topic',
        title: 'By topic',
        testId: 'chimmy-kpi-by-topic',
        emptyLabel: 'No topic data.',
      },
      (rollup?.by_topic ?? []).map((row) =>
        React.createElement(
          'div',
          {
            key: `topic-${row.topic}`,
            className: 'flex items-center justify-between border-b border-white/10 py-2 text-sm',
          },
          [
            React.createElement('span', { key: 'name' }, row.topic),
            React.createElement('span', { key: 'count' }, `${row.messages_sent} msg`),
          ],
        ),
      ),
    ),
    React.createElement(
      GridSection,
      {
        key: 'day',
        title: 'By day',
        testId: 'chimmy-kpi-by-day',
        emptyLabel: 'No daily data.',
      },
      (rollup?.by_day ?? []).map((row) =>
        React.createElement(
          'div',
          {
            key: `day-${row.date}`,
            className: 'flex items-center justify-between border-b border-white/10 py-2 text-sm',
          },
          [
            React.createElement('span', { key: 'date' }, row.date),
            React.createElement('span', { key: 'count' }, `${row.messages_sent} msg`),
          ],
        ),
      ),
    ),
  ])
}

function Metric(props: { label: string; value: number | string; testId: string }) {
  return React.createElement('div', { className: 'rounded-xl border border-white/10 bg-white/[0.03] p-3', 'data-testid': props.testId }, [
    React.createElement('p', { key: 'label', className: 'text-xs text-white/70' }, props.label),
    React.createElement('p', { key: 'value', className: 'mt-1 text-lg font-semibold' }, props.value),
  ])
}

function GridSection(props: {
  title: string
  /**
   * Optional — the section already handles the empty case via `emptyLabel`,
   * so callers can omit children. Marking it optional aligns the
   * TypeScript-narrowed prop bag with `React.createElement(GridSection, { … })`
   * call sites that pass children as the third argument.
   */
  children?: React.ReactNode
  testId: string
  emptyLabel: string
}) {
  const hasChildren = Boolean((Array.isArray(props.children) ? props.children : [props.children]).filter(Boolean).length)

  return React.createElement('section', { className: 'rounded-xl border border-white/10 bg-white/[0.03] p-3', 'data-testid': props.testId }, [
    React.createElement('h2', { key: 'title', className: 'text-sm font-semibold uppercase tracking-wide text-white/80' }, props.title),
    React.createElement(
      'div',
      { key: 'body', className: 'mt-2' },
      hasChildren
        ? props.children
        : React.createElement('p', { className: 'text-sm text-white/60' }, props.emptyLabel)
    ),
  ])
}
