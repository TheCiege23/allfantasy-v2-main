import PlayerHeadshot from '@/components/league/PlayerHeadshot'
import type { LeagueTradeBlockItem, LeagueTradeHistoryItem } from '@/components/league/types'

export function TradeBlockCarousel({
  items,
}: {
  items: LeagueTradeBlockItem[]
}) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:none]">
      {items.length === 0 ? (
        <div className="rounded-2xl border border-[#1E2A42] bg-[#131929] px-4 py-5 text-[14px] text-[#8B9DB8]">
          No trade block players yet.
        </div>
      ) : (
        items.map((item) => (
          <div key={item.id} className="min-w-[88px] text-center">
            <div className="mx-auto flex h-[68px] w-[68px] items-center justify-center rounded-full border-2 border-[#00D4AA] bg-[#131929]">
              <PlayerHeadshot src={item.headshotUrl} alt={item.name} size={60} />
            </div>
            <div className="mt-2 truncate text-[14px] font-semibold text-white">{item.name}</div>
            <div className="truncate text-[12px] text-[#8B9DB8]">{item.sublabel}</div>
          </div>
        ))
      )}
    </div>
  )
}

export function ActiveTradeCard({
  trade,
}: {
  trade: LeagueTradeHistoryItem
}) {
  return (
    <div className="rounded-2xl border border-[#1E2A42] bg-[#131929] p-4">
      <div className="flex items-center justify-between gap-2">
        <span
          className={`rounded-full px-2 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${
            trade.direction === 'incoming'
              ? 'bg-emerald-500/15 text-emerald-300'
              : trade.direction === 'outgoing'
                ? 'bg-amber-500/15 text-amber-300'
                : 'bg-white/10 text-[#CBD5E1]'
          }`}
        >
          {trade.direction}
        </span>
        <span className="text-[12px] text-[#8B9DB8]">{trade.timestamp}</span>
      </div>
      <div className="mt-3 text-[18px] font-semibold text-white">{trade.partnerName}</div>
      <div className="text-[14px] text-[#8B9DB8]">2-way trade</div>
      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <div className="space-y-2">
          {trade.sent.map((asset) => (
            <div key={asset.id} className="flex items-center gap-2">
              <PlayerHeadshot src={asset.headshotUrl} alt={asset.label} size={34} />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-white">{asset.label}</div>
                {asset.sublabel ? <div className="text-[11px] text-[#8B9DB8]">{asset.sublabel}</div> : null}
              </div>
            </div>
          ))}
        </div>
        <div className="text-center text-[24px] text-white/70">⇄</div>
        <div className="space-y-2">
          {trade.received.map((asset) => (
            <div key={asset.id} className="flex items-center gap-2">
              <PlayerHeadshot src={asset.headshotUrl} alt={asset.label} size={34} />
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-white">{asset.label}</div>
                {asset.sublabel ? <div className="text-[11px] text-[#8B9DB8]">{asset.sublabel}</div> : null}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
