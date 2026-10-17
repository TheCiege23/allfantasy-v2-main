'use client'

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AdminAIMetricsBundle } from '@/lib/ai/admin/getAIMetrics'

export function AITimeSeriesChart({ series }: { series: AdminAIMetricsBundle['timeSeries'] }) {
  const data = series.map((p) => ({
    ...p,
    follow: p.followRatePct ?? null,
    outcome: p.avgOutcomeScore != null ? p.avgOutcomeScore * 100 : null,
  }))

  return (
    <div className="rounded-xl border border-white/10 bg-black/25 p-4">
      <h3 className="text-sm font-semibold text-white">Time series</h3>
      <p className="text-[11px] text-white/45">Daily: follow rate, outcome ×100 (scale), platform usage proxy</p>
      <div className="mt-4 h-72">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
            <XAxis dataKey="date" tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }} />
            <YAxis yAxisId="left" tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }} />
            <YAxis yAxisId="right" orientation="right" tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }} />
            <Tooltip
              contentStyle={{ background: '#111118', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8 }}
            />
            <Legend />
            <Line yAxisId="left" type="monotone" dataKey="follow" name="Follow %" stroke="#22d3ee" dot={false} strokeWidth={2} />
            <Line yAxisId="left" type="monotone" dataKey="outcome" name="Outcome×100" stroke="#a78bfa" dot={false} strokeWidth={2} />
            <Line yAxisId="right" type="monotone" dataKey="usageCount" name="Usage" stroke="#fbbf24" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
