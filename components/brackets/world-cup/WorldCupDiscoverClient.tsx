"use client"

import Image from "next/image"
import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useOptionalLanguage } from "@/components/i18n/LanguageProviderClient"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"

const WC_LOGO_SRC = "/images/brackets/world-cup/af-world-cup-logo.png"
import WorldCupDiscoverCard from "./WorldCupDiscoverCard"
import WorldCupInviteJoinPanel, {
  type WorldCupInviteJoinPanelHandle,
} from "./WorldCupInviteJoinPanel"

type DiscoverCardApi = {
  id: string
  name: string
  seasonYear: number
  status: string
  inviteCode: string
  participantCount: number
  maxParticipants: number
  joinBlockedReason: "full" | "locked_no_late_join" | null
  requiresJoinPassword: boolean
  poolLocked: boolean
}

export default function WorldCupDiscoverClient() {
  // Hydration-safe: locale comes from the global LanguageProviderClient.
  const { language } = useOptionalLanguage()
  const t = useMemo(() => makeWcT(language), [language])

  const joinPanelRef = useRef<WorldCupInviteJoinPanelHandle>(null)
  const joinAnchorRef = useRef<HTMLDivElement>(null)

  const [q, setQ] = useState("")
  const [debouncedQ, setDebouncedQ] = useState("")
  const [seasonYear, setSeasonYear] = useState<string>("")
  const [status, setStatus] = useState<string>("all")
  const [loading, setLoading] = useState(true)
  const [challenges, setChallenges] = useState<DiscoverCardApi[]>([])

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(q.trim()), 320)
    return () => window.clearTimeout(t)
  }, [q])

  const fetchDiscover = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (debouncedQ) params.set("q", debouncedQ)
      if (seasonYear && Number.isFinite(Number(seasonYear))) params.set("seasonYear", seasonYear)
      if (status && status !== "all") params.set("status", status)
      params.set("take", "48")

      const res = await fetch(`/api/brackets/world-cup/discover?${params.toString()}`, {
        cache: "no-store",
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(
          (data as { error?: string }).error || t("wc.discover.errors.couldNotLoad")
        )
        return
      }
      setChallenges((data as { challenges?: DiscoverCardApi[] }).challenges ?? [])
    } finally {
      setLoading(false)
    }
  }, [debouncedQ, seasonYear, status, t])

  useEffect(() => {
    void fetchDiscover()
  }, [fetchDiscover])

  const handleCardJoin = useCallback(
    (card: DiscoverCardApi) => {
      if (card.joinBlockedReason) return
      void joinPanelRef.current?.previewInvite(card.inviteCode)
      joinAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    },
    []
  )

  return (
    <div data-testid="world-cup-discover-root" className="mx-auto flex max-w-5xl flex-col gap-6 px-3 py-6 sm:gap-8 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          href="/brackets/world-cup"
          className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-white/60 hover:text-white"
        >
          {t("wc.discover.backToHub")}
        </Link>
        <Link
          href="/brackets/world-cup/create"
          className="rounded-lg bg-cyan-300 px-4 py-2 text-sm font-black text-black"
        >
          {t("wc.discover.createPool")}
        </Link>
      </div>

      <header className="rounded-xl border border-white/10 bg-white/[0.04] p-4 sm:p-6">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-300/35 bg-cyan-300/10 p-1.5">
          <Image
            src={WC_LOGO_SRC}
            alt="AllFantasy World Cup"
            width={44}
            height={44}
            className="h-full w-full object-contain"
          />
        </div>
        <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{t("wc.discover.title")}</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/55">
          {t("wc.discover.subtitle")}
        </p>
      </header>

      <div ref={joinAnchorRef}>
        <WorldCupInviteJoinPanel
          ref={joinPanelRef}
          title={t("wc.discover.joinPanelTitle")}
          onPreviewLoaded={() =>
            joinAnchorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
        />
      </div>

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="block min-w-[200px] flex-1 text-xs text-white/60">
            {t("wc.discover.search.label")}
            <input
              data-testid="world-cup-discover-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("wc.discover.search.placeholder")}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="block w-full min-w-[120px] sm:w-40 text-xs text-white/60">
            {t("wc.discover.season.label")}
            <input
              data-testid="world-cup-discover-season"
              value={seasonYear}
              onChange={(e) => setSeasonYear(e.target.value)}
              placeholder={t("wc.discover.season.placeholder")}
              inputMode="numeric"
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="block w-full min-w-[140px] sm:w-44 text-xs text-white/60">
            {t("wc.discover.statusFilter.label")}
            <select
              data-testid="world-cup-discover-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
            >
              <option value="all">{t("wc.discover.statusFilter.all")}</option>
              <option value="open">{t("wc.discover.statusFilter.open")}</option>
              <option value="locked">{t("wc.discover.statusFilter.locked")}</option>
              <option value="final">{t("wc.discover.statusFilter.final")}</option>
            </select>
          </label>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-16 text-sm text-white/45">
            <Loader2 className="h-5 w-5 animate-spin" />
            {t("wc.discover.loading")}
          </div>
        ) : challenges.length === 0 ? (
          <div
            data-testid="world-cup-discover-empty"
            className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-12 text-center text-sm text-white/45"
          >
            {t("wc.discover.empty")}
          </div>
        ) : (
          <div
            data-testid="world-cup-discover-grid"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {challenges.map((c) => (
              <WorldCupDiscoverCard
                key={c.id}
                card={{
                  id: c.id,
                  name: c.name,
                  seasonYear: c.seasonYear,
                  status: c.status,
                  participantCount: c.participantCount,
                  maxParticipants: c.maxParticipants,
                  joinBlockedReason: c.joinBlockedReason,
                  requiresJoinPassword: c.requiresJoinPassword,
                  poolLocked: c.poolLocked,
                }}
                onJoin={() => handleCardJoin(c)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
