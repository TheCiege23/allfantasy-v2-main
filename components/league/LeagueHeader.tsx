import Link from 'next/link'
import { ChevronLeft, Settings, Shield } from 'lucide-react'
import type { LeagueHeaderInfo } from '@/components/league/types'

export default function LeagueHeader({
  league,
}: {
  league: LeagueHeaderInfo
}) {
  return (
    <div className="sticky top-0 z-40 border-b border-white/10 bg-[#0B0F1E]/95 px-4 pb-3 pt-4 backdrop-blur">
      <div className="flex h-14 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/core"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white/90 transition hover:bg-white/5"
          >
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-[#EF4444] px-1.5 text-[11px] font-semibold text-white">
            75
          </div>
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#1C2539] text-[#00D4AA]">
            {league.avatarUrl ? (
              <img src={league.avatarUrl} alt={league.name} className="h-9 w-9 rounded-full object-cover" />
            ) : (
              <Shield className="h-4.5 w-4.5" />
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold text-white">{league.name}</div>
            <div className="truncate text-[11px] uppercase tracking-[0.18em] text-[#8B9DB8]">
              {league.sport}
              {league.season ? ` • ${league.season}` : ''}
            </div>
          </div>
        </div>
        <Link
          href={`/league/${league.id}?tab=DRAFT`}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-white/90 transition hover:bg-white/5"
        >
          <Settings className="h-5 w-5" />
        </Link>
      </div>
    </div>
  )
}
