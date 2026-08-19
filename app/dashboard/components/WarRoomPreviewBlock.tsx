'use client'

import Link from 'next/link'
import { Swords } from 'lucide-react'

const SPORT_TILES = [
  { sport: 'NFL', status: 'Active' as const },
  { sport: 'NBA', status: 'Preview' as const },
  { sport: 'MLB', status: 'Preview' as const },
  { sport: 'NHL', status: 'Preview' as const },
  { sport: 'Soccer', status: 'Preview' as const },
]

export function WarRoomPreviewBlock() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-cyan-300/20 bg-[radial-gradient(circle_at_12%_0%,rgba(34,211,238,0.18),transparent_34%),radial-gradient(circle_at_100%_10%,rgba(251,191,36,0.13),transparent_30%),linear-gradient(135deg,rgba(2,8,23,0.98),rgba(8,13,31,0.95))] p-4 shadow-[0_24px_72px_-44px_rgba(34,211,238,0.95)]">
      <div className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/70 to-transparent" aria-hidden />
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-2xl border border-cyan-300/25 bg-cyan-300/[0.10] shadow-[0_0_22px_-10px_rgba(34,211,238,0.95)]">
          <Swords className="h-4 w-4 text-cyan-100" />
        </span>
        <p className="text-[12px] font-black uppercase tracking-[0.18em] text-cyan-100/78">AF Legacy</p>
        <span className="ml-auto rounded-full border border-amber-300/35 bg-amber-300/[0.10] px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-amber-100">
          NFL Active
        </span>
      </div>

      <p className="mb-3 max-w-lg text-[13px] leading-5 text-white/68">
        NFL draft intelligence is fully active. More sports are being tuned through the shared AllFantasy engine.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        {SPORT_TILES.map(({ sport, status }) => (
          <div
            key={sport}
            className={`rounded-full border px-3 py-1.5 text-[11px] font-black ${
              status === 'Active'
                ? 'border-cyan-300/40 bg-cyan-300/[0.12] text-cyan-50'
                : 'border-white/10 bg-white/[0.035] text-white/42'
            }`}
          >
            {sport}
            <span
              className={`ml-1.5 font-normal ${status === 'Active' ? 'text-cyan-400/80' : 'text-white/25'}`}
            >
              · {status}
            </span>
          </div>
        ))}
      </div>

      <Link
        href="/war-room"
        className="inline-flex min-h-11 items-center gap-2 rounded-2xl border border-cyan-200/35 bg-gradient-to-r from-cyan-300 to-cyan-100 px-4 py-2.5 text-[13px] font-black text-slate-950 shadow-[0_8px_24px_-12px_rgba(34,211,238,0.95)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_30px_-14px_rgba(34,211,238,1)] active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/70"
      >
        <Swords className="h-3.5 w-3.5" />
        Open AF Legacy
      </Link>
    </section>
  )
}
