import { Shield, SquarePen } from 'lucide-react'
import type { LeagueSettingsItem } from '@/components/league/types'

export default function LeagueSettings({
  items,
}: {
  items: LeagueSettingsItem[]
}) {
  return (
    <section className="rounded-2xl border border-[#1E2A42] bg-[#131929] p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Shield className="h-4.5 w-4.5 text-[#8B9DB8]" />
          <h2 className="text-[18px] font-semibold text-white">League Settings</h2>
        </div>
        <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#00D4AA]">
          <SquarePen className="h-3.5 w-3.5" />
          Edit
        </span>
      </div>
      <div className="mt-4 space-y-4">
        {items.map((item) => (
          <div key={item.id}>
            <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#8B9DB8]">
              <span>{item.label}</span>
              {item.badge ? (
                <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] tracking-[0.14em] text-white/70">
                  {item.badge}
                </span>
              ) : null}
            </div>
            <div className="whitespace-pre-line text-[14px] leading-6 text-white">{item.value}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
