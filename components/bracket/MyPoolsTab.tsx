"use client"

import Link from 'next/link'
import { resolveBracketChallengeLabel, resolveBracketSportUI } from '@/lib/bracket-challenge'

type PoolItem = {
  id?: string
  href?: string
  name?: string
  members?: number
  entries?: number
  sport?: string | null
  challengeType?: string | null
  bracketType?: string | null
}

function resolveBracketPoolHref(poolId: string, href?: string): string {
  const canonicalHref = `/brackets/leagues/${poolId}`
  if (typeof href !== "string") return canonicalHref
  const trimmed = href.trim()
  if (!trimmed) return canonicalHref
  if (trimmed.startsWith("/brackets/world-cup/")) return trimmed
  if (trimmed.startsWith("/brackets/leagues/")) return trimmed
  return canonicalHref
}

export default function MyPoolsTab({ pools }: { pools?: PoolItem[] | null }) {
  const normalizedPools = Array.isArray(pools)
    ? Array.from(
        pools.reduce((map, pool) => {
          const id = typeof pool?.id === "string" ? pool.id.trim() : ""
          if (!id) return map

          const nextPool = {
            id,
            href: resolveBracketPoolHref(id, pool.href),
            name: typeof pool.name === "string" && pool.name.trim() ? pool.name : "Untitled Pool",
            members: Number.isFinite(pool.members) ? Number(pool.members) : 0,
            entries: Number.isFinite(pool.entries) ? Number(pool.entries) : 0,
            sport: typeof pool.sport === "string" && pool.sport.trim() ? pool.sport : "BRACKET",
            challengeType: pool.challengeType ?? null,
            bracketType: pool.bracketType ?? null,
          }

          const existing = map.get(id)
          if (!existing) {
            map.set(id, nextPool)
            return map
          }

          map.set(id, {
            ...existing,
            href: existing.href || nextPool.href,
            name: existing.name || nextPool.name,
            members: Math.max(existing.members, nextPool.members),
            entries: Math.max(existing.entries, nextPool.entries),
            sport: existing.sport || nextPool.sport,
            challengeType: existing.challengeType || nextPool.challengeType,
            bracketType: existing.bracketType || nextPool.bracketType,
          })
          return map
        }, new Map<string, {
          id: string
          href: string
          name: string
          members: number
          entries: number
          sport: string
          challengeType: string | null
          bracketType: string | null
        }>()).values()
      )
    : []

  function logPoolClick(poolId: string, href: string) {
    if (process.env.NODE_ENV !== "production") {
      console.info("[brackets] clicked pool id", { poolId, href })
    }
  }

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">My Pools</h3>
        <Link href="/brackets" className="text-xs text-cyan-300 hover:underline">View all</Link>
      </div>
      {normalizedPools.length === 0 ? (
        <p className="text-sm text-white/60">No pools yet. Create or join a pool to get started.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-white/10">
          <table className="min-w-full text-left text-xs text-white/80">
            <thead className="bg-white/5 text-white/55">
              <tr>
                <th className="px-3 py-2 font-medium">Pool</th>
                <th className="px-3 py-2 font-medium">Members</th>
                <th className="px-3 py-2 font-medium">Entries</th>
              </tr>
            </thead>
            <tbody>
              {normalizedPools.slice(0, 6).map((p) => {
                const sportUI = resolveBracketSportUI(p.sport ?? "BRACKET")
                const challengeLabel = resolveBracketChallengeLabel({
                  sport: p.sport ?? "BRACKET",
                  challengeType: p.challengeType,
                  bracketType: p.bracketType,
                })
                const href = resolveBracketPoolHref(p.id, p.href)
                if (process.env.NODE_ENV !== "production") {
                  console.info("[MyPoolsTab] pool href", { id: p.id, sport: p.sport, href })
                }
                return (
                  <tr key={p.id} className="border-t border-white/10">
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <Link
                          href={href}
                          className="hover:underline"
                          onClick={() => logPoolClick(p.id, href)}
                        >
                          {p.name}
                        </Link>
                        <div className="inline-flex items-center gap-1 text-[11px] text-white/60">
                          <span className="inline-flex items-center gap-1 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-1.5 py-0.5 text-cyan-200/90">
                            <span className="font-semibold">{sportUI.badge}</span>
                            <span>{sportUI.shortLabel}</span>
                          </span>
                          <span>{challengeLabel}</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2">{p.members}</td>
                    <td className="px-3 py-2">{p.entries}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
