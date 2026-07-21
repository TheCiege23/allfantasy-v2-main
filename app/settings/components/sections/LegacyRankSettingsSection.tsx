"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Trophy, Medal, Crown, Users, CalendarDays } from "lucide-react"

/**
 * Legacy (rank / XP / career / achievements) — READ-ONLY.
 *
 * Every value here is real:
 *   - rank ring, level, tier, XP-to-next  → GET /api/user/rank
 *   - career grid (record/titles/…)       → same payload's career* fields
 *   - achievements                         → GET /api/achievements
 * The design handoff's showcase / visibility / banner PICKERS are intentionally
 * omitted: there is no backend to persist a showcase config (confirmed — no
 * columns, not in ProfileUpdatePayload), so shipping those controls would be
 * dead UI. See memory `settings-panels-data-backing`.
 */

type RankData = {
  tier?: string | null
  level?: number | null
  levelName?: string | null
  tierGroup?: string | null
  xpTotal?: number | string | null
  xpIntoLevel?: number | null
  xpForLevel?: number | null
  progressPct?: number | null
  nextLevelName?: string | null
  careerWins?: number | null
  careerLosses?: number | null
  careerChampionships?: number | null
  careerPlayoffAppearances?: number | null
  careerSeasonsPlayed?: number | null
  careerLeaguesPlayed?: number | null
  rankProcessing?: boolean | null
}

type Achievement = {
  id: string
  name: string
  description?: string
  icon?: string
  tier?: string
  earned?: boolean
  earnedAt?: string | null
}

const num = (v: unknown): number | null =>
  v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null

export function LegacyRankSettingsSection() {
  const [rank, setRank] = useState<RankData | null>(null)
  const [achievements, setAchievements] = useState<Achievement[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [rankRes, achRes] = await Promise.all([
        fetch("/api/user/rank", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/achievements", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ])
      if (cancelled) return
      if (rankRes && typeof rankRes === "object") setRank(rankRes as RankData)
      if (achRes && Array.isArray(achRes.achievements)) setAchievements(achRes.achievements as Achievement[])
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const level = num(rank?.level) ?? num(rank ? (rank as Record<string, unknown>).xpLevel : null)
  const pct = Math.max(0, Math.min(100, num(rank?.progressPct) ?? 0))
  const xpInto = num(rank?.xpIntoLevel)
  const xpFor = num(rank?.xpForLevel)
  const xpTotal = num(rank?.xpTotal)

  const careerTiles = [
    { key: "record", label: "Record", icon: Trophy, value: winLoss(rank) },
    { key: "titles", label: "Titles", icon: Crown, value: fmt(rank?.careerChampionships) },
    { key: "playoffs", label: "Playoffs", icon: Medal, value: fmt(rank?.careerPlayoffAppearances) },
    { key: "seasons", label: "Seasons", icon: CalendarDays, value: fmt(rank?.careerSeasonsPlayed) },
    { key: "leagues", label: "Leagues", icon: Users, value: fmt(rank?.careerLeaguesPlayed) },
  ]
  const hasCareer = careerTiles.some((t) => t.value !== "—")

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>Legacy</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          Your rank, XP, and career across every AllFantasy league.
        </p>
      </div>

      {/* Rank card */}
      <div className="rounded-xl border p-5" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
        {loading ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>Loading your rank…</p>
        ) : level == null && xpTotal == null ? (
          <div className="text-sm" style={{ color: "var(--muted)" }}>
            {rank?.rankProcessing
              ? "Your rank is being calculated — check back after your next synced game."
              : "No rank yet. Import or play a league to start earning XP."}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-6">
            <div
              className="grid h-24 w-24 shrink-0 place-items-center rounded-full"
              style={{ background: `conic-gradient(var(--accent-cyan) ${pct}%, var(--border) ${pct}% 100%)` }}
              aria-hidden="true"
            >
              <div
                className="flex h-[76px] w-[76px] flex-col items-center justify-center rounded-full"
                style={{ background: "var(--panel2)" }}
              >
                <span className="text-xl font-bold" style={{ color: "var(--text)" }}>{level ?? "—"}</span>
                <span className="text-[9px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>Level</span>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              {rank?.tierGroup || rank?.tier ? (
                <div
                  className="text-xs font-bold uppercase tracking-wide"
                  style={{ color: "var(--accent-cyan-strong)" }}
                >
                  {rank?.tierGroup ?? rank?.tier}
                </div>
              ) : null}
              {rank?.levelName ? (
                <div className="mt-0.5 text-lg font-semibold" style={{ color: "var(--text)" }}>{rank.levelName}</div>
              ) : null}
              <div className="mt-1.5 text-xs" style={{ color: "var(--muted)" }}>
                {xpInto != null && xpFor != null
                  ? `${xpInto.toLocaleString()} / ${xpFor.toLocaleString()} XP`
                  : xpTotal != null
                    ? `${xpTotal.toLocaleString()} XP total`
                    : ""}
                {rank?.nextLevelName ? ` · next: ${rank.nextLevelName}` : ""}
              </div>
              <div className="mt-2 h-1.5 max-w-sm overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--accent-cyan)" }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Career grid */}
      {hasCareer ? (
        <div className="rounded-xl border p-5" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
          <p className="mb-4 text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>Career</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {careerTiles.map(({ key, label, icon: Icon, value }) => (
              <div key={key} className="flex flex-col gap-1">
                <Icon className="h-4 w-4" style={{ color: "var(--accent-cyan-strong)" }} />
                <span className="text-lg font-bold" style={{ color: "var(--text)" }}>{value}</span>
                <span className="text-[10.5px]" style={{ color: "var(--muted)" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Achievements */}
      <div className="rounded-xl border p-5" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
        <div className="mb-4 flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>Achievements</p>
          <Link href="/af-legacy" className="text-xs font-medium" style={{ color: "var(--accent-cyan-strong)" }}>
            View all
          </Link>
        </div>
        {loading ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>Loading…</p>
        ) : !achievements || achievements.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>No achievements available yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {achievements.map((a) => {
              const earned = Boolean(a.earned)
              return (
                <div
                  key={a.id}
                  className="flex items-start gap-2.5 rounded-lg border p-3"
                  style={{
                    borderColor: earned ? "var(--accent-cyan)" : "var(--border)",
                    background: earned ? "color-mix(in srgb, var(--accent-cyan) 12%, transparent)" : "transparent",
                    opacity: earned ? 1 : 0.55,
                  }}
                  title={a.description ?? a.name}
                >
                  <span className="text-lg leading-none">{earned ? (a.icon || "🏆") : "🔒"}</span>
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold" style={{ color: "var(--text)" }}>{a.name}</div>
                    <div className="text-[10.5px]" style={{ color: "var(--muted)" }}>
                      {earned ? "Unlocked" : "Locked"}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function fmt(v: number | null | undefined): string {
  const n = num(v)
  return n == null ? "—" : n.toLocaleString()
}

function winLoss(rank: RankData | null): string {
  const w = num(rank?.careerWins)
  const l = num(rank?.careerLosses)
  if (w == null && l == null) return "—"
  return `${w ?? 0}-${l ?? 0}`
}
