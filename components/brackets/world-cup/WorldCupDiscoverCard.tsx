"use client"

import Link from "next/link"
import { useMemo } from "react"
import { Globe2, Lock, Shield, Users } from "lucide-react"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"

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
  // Hydration-safe: locale comes from the global LanguageProviderClient.
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])

  const blocked = card.joinBlockedReason != null
  const reasonLabel =
    card.joinBlockedReason === "full"
      ? t("wc.discover.card.blockedFull")
      : card.joinBlockedReason === "locked_no_late_join"
        ? t("wc.discover.card.blockedClosed")
        : null

  return (
    <div
      data-testid={`world-cup-discover-card-${card.id}`}
      className="flex flex-col rounded-xl border border-white/10 bg-white/[0.04] p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Globe2 className="h-4 w-4 shrink-0 text-white/65" />
            <h3 className="truncate font-black text-white">{card.name}</h3>
          </div>
          <p className="mt-1 text-xs text-white/45">
            {card.seasonYear} · {card.status === "open" ? t("wc.discover.card.statusOpen") : card.status}
          </p>
        </div>
        {blocked ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-400/15 px-2 py-0.5 text-[11px] font-bold text-white/85">
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
          <span className="inline-flex items-center gap-1 rounded-md bg-amber-400/10 px-2 py-1 text-white/75">
            <Shield className="h-3 w-3" />
            {t("wc.discover.card.password")}
          </span>
        ) : null}
        {card.poolLocked && !blocked ? (
          <span className="rounded-md bg-cyan-400/10 px-2 py-1 text-white/70">{t("wc.discover.card.lateJoin")}</span>
        ) : null}
      </div>

      <div className="mt-4 flex min-w-0 flex-wrap gap-2">
        <Link
          href={`/brackets/world-cup/${card.id}`}
          className="inline-flex min-h-11 min-w-0 flex-1 touch-manipulation items-center justify-center rounded-lg border border-white/15 bg-white/[0.06] px-3 py-2 text-xs font-bold text-white/80 hover:bg-white/[0.1]"
        >
          {t("wc.discover.card.preview")}
        </Link>
        <button
          type="button"
          data-testid={`world-cup-discover-join-${card.id}`}
          disabled={blocked}
          onClick={onJoin}
          className="inline-flex min-h-11 min-w-0 flex-1 touch-manipulation items-center justify-center rounded-lg bg-cyan-300 px-3 py-2 text-xs font-black text-black disabled:cursor-not-allowed disabled:opacity-35"
        >
          {t("wc.discover.card.join")}
        </button>
      </div>
    </div>
  )
}
