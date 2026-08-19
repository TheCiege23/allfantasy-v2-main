'use client'

import Link from 'next/link'
import { Lock, Sparkles, Coins } from 'lucide-react'
import type { AfPlanId } from '@/lib/tournament/af-premium-plans'
import { AF_PLANS } from '@/lib/tournament/af-premium-plans'
import {
  SURVIVOR_PREMIUM_COMMAND_TILES,
  canAccessSurvivorPremiumTile,
  type SurvivorPremiumTileGate,
} from '@/lib/survivor/survivor-premium-access'
import { SURVIVOR_AI_ACTIONS } from '@/lib/survivor/survivor-ai-token-catalog'
import { WarRoomPanel, WarRoomStatOrb } from '@/components/tournament/TournamentWarRoomPrimitives'
import { SurvivorTokenHistoryStrip } from '@/components/survivor/SurvivorTokenHistoryStrip'
import { SurvivorAiMeteredSmokeButton } from '@/components/survivor/SurvivorAiMeteredSmokeButton'
import { cn } from '@/lib/utils'

function SurvivorPremiumTileCard({
  tile,
  plan,
  tokensRemaining,
}: {
  tile: SurvivorPremiumTileGate
  plan: AfPlanId | null
  tokensRemaining: number | null
}) {
  const unlocked = canAccessSurvivorPremiumTile(plan, tile)
  const upgradePlan = tile.requiredPlan

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-2xl border bg-gradient-to-br p-4 transition-all',
        unlocked
          ? 'border-white/[0.12] from-white/[0.06] via-transparent to-emerald-500/[0.04] shadow-[0_0_40px_-12px_rgba(52,211,153,0.15)]'
          : 'border-amber-500/20 from-amber-950/25 via-transparent to-black/40',
      )}
    >
      {!unlocked ? (
        <div
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(245,158,11,0.12),transparent_55%)]"
          aria-hidden
        />
      ) : null}
      <div className="relative flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/40">
            {tile.requiredPlan === 'af_supreme'
              ? 'Supreme'
              : tile.requiredPlan === 'af_commissioner'
                ? 'Commissioner'
                : 'Pro'}
          </p>
          <h3 className="mt-1 text-base font-bold text-white">{tile.title}</h3>
          <p className="mt-1 text-[12px] leading-snug text-white/55">{tile.subtitle}</p>
        </div>
        {unlocked ? (
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-500/15 text-emerald-200">
            <Sparkles className="h-4 w-4" aria-hidden />
          </span>
        ) : (
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200">
            <Lock className="h-4 w-4" aria-hidden />
          </span>
        )}
      </div>
      <div className="relative mt-3 flex flex-wrap items-center gap-2 text-[11px]">
        {!unlocked ? (
          <>
            <span className="rounded-lg border border-amber-500/25 bg-amber-950/30 px-2 py-1 font-semibold text-amber-100/90">
              Locked · {AF_PLANS[upgradePlan].label}
            </span>
            <Link
              href="/settings"
              className="font-semibold text-cyan-300 underline-offset-2 hover:text-cyan-200 hover:underline"
            >
              Upgrade
            </Link>
          </>
        ) : (
          <span className="rounded-lg border border-white/[0.08] bg-black/30 px-2 py-1 text-white/60">
            Live intel{tile.tokenEligible ? ' · AF Tokens on deep runs' : ''}
          </span>
        )}
        {tile.tokenEligible && unlocked && typeof tokensRemaining === 'number' ? (
          <span className="inline-flex items-center gap-1 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-2 py-1 font-mono text-cyan-100/90">
            <Coins className="h-3.5 w-3.5" aria-hidden />
            {tokensRemaining} AF
          </span>
        ) : null}
      </div>
    </div>
  )
}

export function SurvivorPremiumCommandCenterPanel({
  leagueId,
  plan,
  tokensRemaining,
}: {
  leagueId: string
  plan: AfPlanId | null
  tokensRemaining: number | null
}) {
  const playerActions = SURVIVOR_AI_ACTIONS.filter((a) => a.lane === 'player')
  const hostActions = SURVIVOR_AI_ACTIONS.filter((a) => a.lane === 'host')

  return (
    <div className="space-y-6" data-testid="survivor-premium-command-center">
      <WarRoomPanel
        title="Premium Survivor command center"
        subtitle="Tournament-grade intel — tiered by AF Pro, AF Commissioner, and AF Supreme. Advanced reports can burn AF Tokens."
      >
        <p className="text-sm leading-relaxed text-white/55">
          Player lens unlocks with <span className="text-emerald-200/90">AF Pro</span>. Host automation and fairness
          tools unlock with <span className="text-amber-100/90">AF Commissioner</span>. Full combined story + controls
          unlock with <span className="text-violet-200/90">AF Supreme</span> (Pro + Commissioner + Legacy
          class access).
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {SURVIVOR_PREMIUM_COMMAND_TILES.map((tile) => (
            <SurvivorPremiumTileCard
              key={tile.tileId}
              tile={tile}
              plan={plan}
              tokensRemaining={tokensRemaining}
            />
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-[11px] text-white/45">
          <Link href={`/survivor/${leagueId}/chimmy`} className="text-emerald-300 hover:text-emerald-200">
            @Chimmy hub →
          </Link>
          <span className="text-white/25">|</span>
          <Link href="/tokens" className="text-cyan-300 hover:text-cyan-200">
            AF Token packs
          </Link>
        </div>
      </WarRoomPanel>

      <div className="grid gap-4 lg:grid-cols-3">
        <WarRoomStatOrb
          label="AF plan"
          value={plan ? AF_PLANS[plan].shortLabel : '—'}
          hint="Pro / Commissioner / Supreme"
          accent="cyan"
        />
        <WarRoomStatOrb
          label="Token balance"
          value={typeof tokensRemaining === 'number' ? String(tokensRemaining) : '—'}
          hint="Preflight + confirm on 2–3 burns"
          accent="amber"
        />
        <WarRoomStatOrb
          label="Engine modules"
          value="v2"
          hint="Confessionals · clues · minigames · exile variants"
          accent="violet"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SurvivorTokenHistoryStrip />
        <SurvivorAiMeteredSmokeButton leagueId={leagueId} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <WarRoomPanel title="Player actions · token costs" subtitle="1 / 2 / 3 AF Tokens — requires AF Pro (or Supreme).">
          <ul className="max-h-64 space-y-2 overflow-y-auto pr-1 text-[12px] text-white/65">
            {playerActions.map((a) => (
              <li
                key={a.id}
                className="flex justify-between gap-2 rounded-lg border border-white/[0.06] bg-black/25 px-2 py-1.5"
              >
                <span>{a.label}</span>
                <span className="font-mono text-cyan-200/90">{a.tokenCost}</span>
              </li>
            ))}
          </ul>
        </WarRoomPanel>
        <WarRoomPanel title="Host / commissioner actions · token costs" subtitle="Requires AF Commissioner (or Supreme).">
          <ul className="max-h-64 space-y-2 overflow-y-auto pr-1 text-[12px] text-white/65">
            {hostActions.map((a) => (
              <li
                key={a.id}
                className="flex justify-between gap-2 rounded-lg border border-white/[0.06] bg-black/25 px-2 py-1.5"
              >
                <span>{a.label}</span>
                <span className="font-mono text-amber-200/90">{a.tokenCost}</span>
              </li>
            ))}
          </ul>
        </WarRoomPanel>
      </div>
    </div>
  )
}
