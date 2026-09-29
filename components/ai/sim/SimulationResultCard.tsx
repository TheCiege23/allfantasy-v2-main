'use client'

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export function SimulationResultCard({
  title,
  subtitle,
  championshipOdds,
  playoffOdds,
  avgWins,
  iterations,
  weeksSimulated,
}: {
  title: string
  subtitle?: string
  championshipOdds: Record<string, number>
  playoffOdds: Record<string, number>
  avgWins: Record<string, number>
  iterations: number
  weeksSimulated?: number
}) {
  const chartData = Object.entries(championshipOdds)
    .map(([name, v]) => ({ name: name.slice(0, 12), champ: v * 100, playoff: (playoffOdds[name] ?? 0) * 100 }))
    .sort((a, b) => b.champ - a.champ)
    .slice(0, 12)

  return (
    <div className="rounded-xl border border-white/10 bg-[#0c0c14] p-4">
      <div className="mb-3">
        <h4 className="text-sm font-semibold text-white">{title}</h4>
        {subtitle ? <p className="text-[11px] text-white/45">{subtitle}</p> : null}
        <p className="mt-1 text-[11px] text-white/35">
          {iterations} runs{weeksSimulated ? ` · ${weeksSimulated} wks` : ''}
        </p>
      </div>
      <div className="h-48">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 8 }}>
            <XAxis type="number" tick={{ fill: 'rgba(255,255,255,0.45)', fontSize: 10 }} domain={[0, 100]} />
            <YAxis type="category" dataKey="name" width={72} tick={{ fill: 'rgba(255,255,255,0.55)', fontSize: 10 }} />
            <Tooltip
              contentStyle={{ background: '#111118', border: '1px solid rgba(255,255,255,0.12)' }}
              formatter={(value, name) => {
                const v = typeof value === 'number' ? value : Number(value ?? 0)
                const label = name === 'champ' ? 'Title' : 'Playoffs'
                return [`${v.toFixed(1)}%`, label]
              }}
            />
            <Bar dataKey="champ" fill="#a78bfa" name="champ" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-3 grid max-h-32 grid-cols-2 gap-2 overflow-y-auto text-[11px]">
        {Object.entries(avgWins)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([id, w]) => (
            <div key={id} className="flex justify-between gap-2 text-white/70">
              <span className="truncate font-mono text-[11px]">{id}</span>
              <span className="tabular-nums text-cyan-200/90">{w.toFixed(1)} w</span>
            </div>
          ))}
      </div>
    </div>
  )
}
