'use client'

import { useParams, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import {
  Biohazard,
  Globe,
  Radio,
  Shield,
  Skull,
  Sparkles,
  Trophy,
} from 'lucide-react'
import { ZombieEventFeed } from '@/app/zombie/components/ZombieEventFeed'
import { ZombieGlassPanel } from '@/components/zombie/ZombieGlassPanel'
import {
  formatZombieTierLabel,
  getZombieSportHeroPreset,
  resolveZombieUniverseTier,
  zombieTierBadgeClasses,
} from '@/lib/zombie/zombie-visual-system'
import {
  CommissionerFeederGrid,
  type FeederCard,
} from '@/components/commissioner-hub/CommissionerFeederGrid'
import { resolveHubAccent } from '@/lib/commissioner-hub/feeder-accent'

type LevelRow = {
  id: string
  name: string
  rankOrder: number
  tierLabel?: string | null
  tierTheme?: string | null
}

type HubLeague = {
  leagueId: string
  name: string | null
  sport?: string | null
  level?: LevelRow | null
}

type UniverseHubPayload = {
  universe: {
    id: string
    name: string
    sport: string
    levels?: LevelRow[]
    leagues: HubLeague[]
  }
  counts: { survivorCount: number; zombieCount: number; whispererCount: number; leagueCount: number }
  animations: Array<{
    id: string
    animationType: string
    week: number
    metadata: unknown
    createdAt: string
    leagueId: string
  }>
  announcements: Array<{
    id: string
    type: string
    title: string
    content: string
    week: number | null
    createdAt: string
  }>
  topByPpw: Array<{ displayName: string; leagueName: string; currentSeasonPPW: number }>
}

export default function ZombieUniverseHubPage() {
  const { universeId } = useParams<{ universeId: string }>() ?? ({} as { universeId: string })
  const [data, setData] = useState<UniverseHubPayload | null>(null)
  const router = useRouter()

  useEffect(() => {
    if (!universeId) return
    fetch(`/api/zombie/universe-hub?universeId=${encodeURIComponent(universeId)}`, { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => setData(null))
  }, [universeId])

  // Solo zombie universes (single_gamma tier) skip the universe hub entirely —
  // there's nothing to commission across multiple leagues, so route the user
  // straight to the standard league dashboard.
  useEffect(() => {
    const leagues = data?.universe?.leagues ?? []
    if (leagues.length === 1 && leagues[0]?.leagueId) {
      router.replace(`/league/${encodeURIComponent(leagues[0].leagueId)}`)
    }
  }, [data?.universe?.leagues, router])

  const preset = useMemo(() => getZombieSportHeroPreset(data?.universe?.sport), [data?.universe?.sport])

  const sortedLeagues = useMemo(() => {
    const list = data?.universe?.leagues ?? []
    return [...list].sort((a, b) => {
      const ra = a.level?.rankOrder ?? 999
      const rb = b.level?.rankOrder ?? 999
      if (ra !== rb) return ra - rb
      return (a.name ?? a.leagueId).localeCompare(b.name ?? b.leagueId)
    })
  }, [data?.universe?.leagues])

  const zombieAccent = useMemo(() => resolveHubAccent('zombie'), [])

  const feederCards: FeederCard[] = useMemo(() => {
    return sortedLeagues.map((l) => {
      const tier = resolveZombieUniverseTier(l.level ?? null)
      const tierLabel = formatZombieTierLabel(tier, l.level?.tierLabel ?? l.level?.name)
      return {
        id: l.leagueId,
        href: `/zombie/${l.leagueId}`,
        name: l.name ?? l.leagueId,
        sport: l.sport ?? preset.sport ?? null,
        tierLabel: tierLabel ?? null,
      }
    })
  }, [sortedLeagues, preset.sport])

  if (!data?.universe) {
    return <p className="text-[13px] text-[var(--zombie-text-dim)]">Loading universe…</p>
  }

  const u = data.universe
  const counts = data.counts

  return (
    <div className="min-h-screen bg-[var(--zombie-bg)] px-4 py-6 text-[var(--zombie-text-mid)]">
      <section className="zombie-hero-shell relative mb-8 border border-white/10 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        <div className="zombie-hero-fog" aria-hidden />
        <div className={clsx('pointer-events-none absolute inset-0', preset.overlayClass)} aria-hidden />
        <div className="zombie-drift-particles opacity-[0.28]" aria-hidden />

        <div className="relative z-[1] p-5 sm:p-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--zombie-toxic)]/35 bg-black/35 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-[var(--zombie-toxic)]">
              <Radio className="h-3.5 w-3.5" aria-hidden />
              Universe tracker
            </span>
            <span className="rounded-full border border-white/12 bg-white/[0.05] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/65">
              {preset.sport} · {preset.label}
            </span>
          </div>

          <div className="mt-5 flex flex-wrap items-start gap-4">
            <div className="zombie-toxic-ring flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[var(--zombie-toxic)]/40 bg-black/45 sm:h-16 sm:w-16">
              <Globe className="h-8 w-8 text-[var(--zombie-toxic)] sm:h-9 sm:w-9" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">{u.name}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/70">{preset.tagline}</p>
            </div>
          </div>

          {u.levels && u.levels.length > 0 ? (
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/40">Tier ladder</span>
              {[...u.levels]
                .sort((a, b) => a.rankOrder - b.rankOrder)
                .map((lv) => {
                  const tier = resolveZombieUniverseTier(lv)
                  return (
                    <span
                      key={lv.id}
                      className={clsx(
                        'rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.14em]',
                        zombieTierBadgeClasses(tier),
                      )}
                    >
                      {formatZombieTierLabel(tier, lv.tierLabel ?? lv.name)}
                    </span>
                  )
                })}
            </div>
          ) : null}

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-2xl border border-emerald-500/22 bg-emerald-500/[0.07] px-3 py-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
                <Shield className="h-3.5 w-3.5 text-emerald-300" aria-hidden />
                Survivors
              </p>
              <p className="mt-2 text-2xl font-black tabular-nums text-white">{counts.survivorCount}</p>
            </div>
            <div className="rounded-2xl border border-lime-500/25 bg-lime-500/[0.06] px-3 py-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
                <Skull className="h-3.5 w-3.5 text-lime-300" aria-hidden />
                Zombies
              </p>
              <p className="mt-2 text-2xl font-black tabular-nums text-white">{counts.zombieCount}</p>
            </div>
            <div className="rounded-2xl border border-fuchsia-500/25 bg-fuchsia-950/25 px-3 py-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
                <Sparkles className="h-3.5 w-3.5 text-fuchsia-300" aria-hidden />
                Whisperers
              </p>
              <p className="mt-2 text-2xl font-black tabular-nums text-white">{counts.whispererCount}</p>
            </div>
            <div className="rounded-2xl border border-amber-500/28 bg-amber-500/[0.08] px-3 py-3">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">
                <Biohazard className="h-3.5 w-3.5 text-amber-200" aria-hidden />
                Leagues
              </p>
              <p className="mt-2 text-2xl font-black tabular-nums text-white">{counts.leagueCount}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <CommissionerFeederGrid
          leagues={feederCards}
          accent={zombieAccent}
          title="Linked leagues"
          hint="Click a feeder to open the league workspace. Tiers follow the universe ladder from the commissioner setup."
        />

        <ZombieGlassPanel
          title="Commissioner deep controls"
          eyebrow="Per-league"
          icon={<Shield className="h-5 w-5 text-amber-200" />}
        >
          <p className="mb-3 text-[12px] text-white/55">
            Whisperer edits, item audits, ambush overrides, payment tracking, and emergency corrections for each linked league.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {sortedLeagues.map((l) => (
              <a
                key={l.leagueId}
                href={`/league/${encodeURIComponent(l.leagueId)}/zombie-commissioner`}
                className="flex items-center justify-between rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2 text-[13px] text-white/85 hover:bg-amber-500/[0.12]"
              >
                <span className="truncate font-semibold">{l.name ?? l.leagueId}</span>
                <span className="text-[11px] uppercase tracking-[0.14em] text-amber-200/80">Open</span>
              </a>
            ))}
          </div>
        </ZombieGlassPanel>

        <ZombieGlassPanel title="Top survivors (PPW)" eyebrow="Cross-league" icon={<Trophy className="h-5 w-5 text-amber-200" />} variant="reward">
          {data.topByPpw.length === 0 ? (
            <p className="text-sm text-white/55">No PPW stats yet this season.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-white/[0.07] bg-black/20">
              <table className="w-full min-w-[320px] text-left text-[13px]">
                <thead className="text-[11px] uppercase tracking-[0.15em] text-white/45">
                  <tr>
                    <th className="p-3 font-semibold">#</th>
                    <th className="p-3 font-semibold">Manager</th>
                    <th className="p-3 font-semibold">League</th>
                    <th className="p-3 font-semibold">PPW</th>
                  </tr>
                </thead>
                <tbody>
                  {data.topByPpw.map((r, i) => (
                    <tr key={`${r.displayName}-${i}`} className="border-t border-white/[0.06] bg-white/[0.02]">
                      <td className="p-3 tabular-nums text-white/50">{i + 1}</td>
                      <td className="p-3 font-medium text-white">{r.displayName}</td>
                      <td className="p-3 text-white/65">{r.leagueName}</td>
                      <td className="p-3 font-semibold tabular-nums text-amber-100">{r.currentSeasonPPW.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ZombieGlassPanel>

        <ZombieGlassPanel title="Notable events" eyebrow="Universe feed" icon={<Skull className="h-5 w-5 text-red-300" />} variant="danger">
          <ZombieEventFeed
            animations={data.animations.map((a) => ({
              id: a.id,
              animationType: a.animationType,
              week: a.week,
              metadata: a.metadata,
              createdAt: a.createdAt,
            }))}
            announcements={data.announcements}
            maxItems={8}
          />
        </ZombieGlassPanel>
      </div>
    </div>
  )
}
