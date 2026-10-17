import Link from 'next/link'
import PlayerHeadshot from '@/components/league/PlayerHeadshot'
import type { LeagueActivityItem } from '@/components/league/types'

function badgeClasses(tone: LeagueActivityItem['badgeTone']) {
  if (tone === 'green') return 'bg-emerald-500/15 text-emerald-300'
  if (tone === 'teal') return 'bg-[#0F3D35] text-[#00D4AA]'
  return 'bg-white/10 text-[#CBD5E1]'
}

export default function ActivityFeed({
  items,
}: {
  items: LeagueActivityItem[]
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[24px] font-semibold text-white">Activity</h2>
        <Link href="/feed" className="text-[15px] font-semibold text-[#00D4AA]">
          View all
        </Link>
      </div>
      <div className="space-y-5">
        {items.length === 0 ? (
          <div className="rounded-2xl border border-[#1E2A42] bg-[#131929] p-4 text-[14px] text-[#8B9DB8]">
            No league activity yet.
          </div>
        ) : (
          items.map((item) => (
            <div key={item.id} className="rounded-2xl border border-[#1E2A42] bg-[#131929] p-4">
              <div className="flex flex-wrap items-center gap-2 text-[13px]">
                <span className="font-semibold text-white">{item.managerName}</span>
                <span className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${badgeClasses(item.badgeTone)}`}>
                  {item.badge}
                </span>
                <span className="ml-auto text-[#8B9DB8]">{item.timestamp}</span>
              </div>
              {item.summary ? <div className="mt-3 text-[15px] font-semibold text-white">{item.summary}</div> : null}
              <div className="mt-3 space-y-3">
                {item.lines.map((line, index) => (
                  <div key={`${item.id}-${index}`} className="flex items-center gap-3">
                    {line.playerName ? <PlayerHeadshot src={line.headshotUrl} alt={line.playerName} size={36} /> : null}
                    <div className="min-w-0 flex-1">
                      <div className={`text-[12px] font-semibold ${line.type === 'drop' ? 'text-[#EF4444]' : line.type === 'add' ? 'text-[#00D4AA]' : 'text-[#CBD5E1]'}`}>
                        {line.label}
                      </div>
                      {line.playerName ? <div className="truncate text-[16px] font-semibold text-white">{line.playerName}</div> : null}
                      {line.playerMeta ? <div className="truncate text-[12px] text-[#8B9DB8]">{line.playerMeta}</div> : null}
                    </div>
                    {index === 0 && item.amountLabel ? (
                      <div className="text-right text-[12px] font-semibold text-white">{item.amountLabel}</div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
