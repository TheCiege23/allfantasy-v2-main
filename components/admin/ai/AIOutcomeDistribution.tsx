'use client'

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { AdminAIMetricsBundle } from '@/lib/ai/admin/getAIMetrics'

export function AIOutcomeDistribution({ buckets }: { buckets: AdminAIMetricsBundle['outcomeDistribution'] }) {
  const data = buckets.map((b) => ({ name: b.label, count: b.count }))
  const max = Math.max(1, ...buckets.map((b) => b.count))

  return (
    <div className="rounded-xl border border-white/10 bg-black/25 p-4">
      <h3 className="text-sm font-semibold text-white">Outcome distribution</h3>
      <p className="text-[11px] text-white/45">Resolved scores from ai_recommendation_outcomes</p>
      <div className="mt-4 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
            <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.5)', fontSize: 11 }} interval={0} angle={-12} height={48} />
            <YAxis domain={[0, max]} tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 11 }} />
            <Tooltip
              contentStyle={{ background: '#111118', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8 }}
            />
            <Bar dataKey="count" fill="#22c55e" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
