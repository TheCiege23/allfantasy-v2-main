"use client"

import Link from "next/link"
import { Globe2, Lock, Shield, Users } from "lucide-react"

export type DiscoverCardModel = {
  id: string
  name: string
  seasonYear: number
  status: string
  participantCount: number
  maxParticipants: number
  joinBlockedReason: "full" | "locked_no_late_join" | null
  requiresJoinPassword: boolean
  poolLocked: boolean
}

export default function WorldCupDiscoverCard({
  card,
  onJoin,
}: {
  card: DiscoverCardModel
  onJoin: () => void
}) {
  const blocked = card.joinBlockedReason != null
  const reasonLabel =
    card.joinBlockedReason === "full"
      ? "League full"
      : card.joinBlockedReason === "locked_no_late_join"
        ? "Closed to new players"
        : null

  return (
    <div
      data-testid={`world-cup-discover-card-${card.id}`}
      className="flex flex-col rounded-xl border border-white/10 bg-white/[0.04] p-4 transition hover:border-white/20 hover:bg-white/[0.07] hover:shadow-lg hover:shadow-black/30"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Globe2 className="h-4 w-4 shrink-0 text-cyan-300/80" />
            <h3 className="truncate font-black text-white">{card.name}</h3>
          </div>
          <p className="mt-1 text-xs text-white/45">
            {card.seasonYear} · {card.status === "open" ? "Open" : card.status}
          </p>
        </div>
        {blocked ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-400/15 px-2 py-0.5 text-[10px] font-bold text-rose-100">
            <Lock className="h-3 w-3" />
            {reasonLabel}
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-white/50">
        <span className="inline-flex items-center gap-1 rounded-md bg-white/[0.06] px-2 py-1">
          <Users className="h-3 w-3" />
          {card.participantCount}/{card.maxParticipants}
        </span>
        {card.requiresJoinPassword ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-400/10 px-2 py-1 text-amber-100/90">
            <Shield className="h-3 w-3" />
            Password
          </span>
        ) : null}
        {card.poolLocked && !blocked ? (
          <span className="rounded-md bg-cyan-400/10 px-2 py-1 text-cyan-100/80">Picks locked · late join on</span>
        ) : null}
      </div>

      <div className="mt-4 flex min-w-0 flex-wrap gap-2">
        <Link
          href={`/brackets/world-cup/${card.id}`}
          className="inline-flex min-h-11 min-w-0 flex-1 touch-manipulation items-center justify-center rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-bold text-white/80 transition-colors hover:bg-white/[0.1]"
        >
          Preview
        </Link>
        <button
          type="button"
          data-testid={`world-cup-discover-join-${card.id}`}
          disabled={blocked}
          onClick={onJoin}
          className="inline-flex min-h-11 min-w-0 flex-1 touch-manipulation items-center justify-center rounded-lg bg-cyan-300 px-3 py-2 text-xs font-black text-black transition active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-35"
        >
          Join
        </button>
      </div>
    </div>
  )
}
