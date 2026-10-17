'use client'

interface PartnerProfile {
  rosterId: string
  name: string
  sampleSize: number
  topOverpayPos?: string
  topDiscountPos?: string
  ldiByPos: Record<string, number>
  meanPremiumPctByPos: Record<string, number>
  tags: string[]
}

const TAG_STYLES: Record<string, string> = {
  'Active Trader': 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
  'Pick Hoarder': 'bg-purple-500/15 text-purple-400 border-purple-500/20',
  'Aggressive': 'bg-red-500/15 text-red-400 border-red-500/20',
  'Learning': 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
}

export function PartnerProfileCard({ profile }: { profile: PartnerProfile }) {
  const positions = Object.entries(profile.ldiByPos)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-sm font-semibold text-white">{profile.name}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">{profile.sampleSize} trades tracked</div>
        </div>
        <div className="flex gap-1 flex-wrap justify-end">
          {profile.tags.map(tag => (
            <span
              key={tag}
              className={`px-1.5 py-0.5 text-[11px] font-semibold rounded border ${TAG_STYLES[tag] ?? 'bg-gray-700/50 text-gray-400 border-gray-600/30'}`}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-gray-800/40 rounded-lg px-3 py-2">
          <div className="text-[11px] text-gray-500 uppercase tracking-wider">Overpays</div>
          <div className="text-sm font-bold text-red-400 mt-0.5">{profile.topOverpayPos ?? '—'}</div>
        </div>
        <div className="bg-gray-800/40 rounded-lg px-3 py-2">
          <div className="text-[11px] text-gray-500 uppercase tracking-wider">Discounts</div>
          <div className="text-sm font-bold text-green-400 mt-0.5">{profile.topDiscountPos ?? '—'}</div>
        </div>
      </div>

      {positions.length > 0 && (
        <div className="space-y-1">
          {positions.map(([pos, ldi]) => {
            const prem = profile.meanPremiumPctByPos[pos] ?? 0
            return (
              <div key={pos} className="flex items-center justify-between text-[11px]">
                <span className="text-gray-400 font-medium">{pos}</span>
                <div className="flex items-center gap-3">
                  <span className="text-gray-500">LDI {Math.round(ldi)}</span>
                  <span className={prem > 0 ? 'text-red-400' : 'text-green-400'}>
                    {prem > 0 ? '+' : ''}{(prem * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
