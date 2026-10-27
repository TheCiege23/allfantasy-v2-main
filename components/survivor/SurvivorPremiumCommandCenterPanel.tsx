'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Lock, Sparkles } from 'lucide-react'
import type { AfPlanId } from '@/lib/tournament/af-premium-plans'
import { AF_PLANS } from '@/lib/tournament/af-premium-plans'
import { upgradePathForPlan } from '@/lib/monetization/upgradeDestination'
import {
  SURVIVOR_PREMIUM_COMMAND_TILES,
  resolveSurvivorPremiumTileAccess,
  type SurvivorPremiumTileAccess,
  type SurvivorPremiumTileGate,
} from '@/lib/survivor/survivor-premium-access'
import { SurvivorPremiumTileDetail } from '@/components/survivor/SurvivorPremiumTileDetail'
import { SURVIVOR_SOLD_AI_ACTIONS } from '@/lib/survivor/survivor-ai-token-catalog'
import { WarRoomPanel, WarRoomStatOrb } from '@/components/tournament/TournamentWarRoomPrimitives'
import { SurvivorTokenHistoryStrip } from '@/components/survivor/SurvivorTokenHistoryStrip'
import { SurvivorAiMeteredSmokeButton } from '@/components/survivor/SurvivorAiMeteredSmokeButton'
import { cn } from '@/lib/utils'

type TileAccess = SurvivorPremiumTileAccess | null

function SurvivorPremiumTileCard({
  tile,
  access,
  selected,
  onOpen,
}: {
  tile: SurvivorPremiumTileGate
  /** The server's decision; null while it loads. */
  access: TileAccess
  selected: boolean
  onOpen: () => void
}) {
  const comingNext = tile.status !== 'live'
  const unlocked = access?.ok === true
  const planLocked = access?.ok === false && access.reason === 'plan_required'
  const hostOnly = access?.ok === false && access.reason === 'commissioner_only'
  const upgradePlan = tile.requiredPlan
  const body = (
    <>
      <div className="relative flex items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/40">
            {tile.requiredPlan === 'af_supreme' ? 'Supreme' : tile.requiredPlan === 'af_commissioner' ? 'Commissioner' : 'Pro'}
          </p>
          <h3 className="mt-1 text-base font-bold text-white">{tile.title}</h3>
          <p className="mt-1 text-[12px] leading-snug text-white/55">{tile.subtitle}</p>
        </div>
        {unlocked ? (
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-emerald-400/25 bg-emerald-500/15 text-emerald-200">
            <Sparkles className="h-4 w-4" aria-hidden />
          </span>
        ) : planLocked ? (
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-200">
            <Lock className="h-4 w-4" aria-hidden />
          </span>
        ) : null}
      </div>
      <div className="relative mt-3 flex flex-wrap items-center gap-2 text-[11px]">
        {comingNext ? (
          <span className="rounded-lg border border-white/[0.08] bg-black/30 px-2 py-1 text-white/55">Coming next</span>
        ) : planLocked ? (
          <>
            <span className="rounded-lg border border-amber-500/25 bg-amber-950/30 px-2 py-1 font-semibold text-amber-100/90">
              Locked · {AF_PLANS[upgradePlan].label}
            </span>
            <Link href={upgradePathForPlan(upgradePlan)} className="font-semibold text-cyan-300 underline-offset-2 hover:text-cyan-200 hover:underline">
              Upgrade
            </Link>
          </>
        ) : hostOnly ? (
          <span className="rounded-lg border border-white/[0.08] bg-black/30 px-2 py-1 text-white/55">Commissioner only</span>
        ) : unlocked ? (
          <span className="rounded-lg border border-emerald-400/20 bg-emerald-500/10 px-2 py-1 font-semibold text-emerald-100">{selected ? 'Showing below' : 'Open'}</span>
        ) : (
          <span className="rounded-lg border border-white/[0.08] bg-black/30 px-2 py-1 text-white/45">Checking your plan…</span>
        )}
      </div>
    </>
  )
  const frame = cn(
    'relative block w-full overflow-hidden rounded-2xl border bg-gradient-to-br p-4 text-left transition-all',
    unlocked
      ? cn('border-white/[0.12] from-white/[0.06] via-transparent to-emerald-500/[0.04] hover:border-emerald-400/40', selected && 'border-emerald-400/50')
      : comingNext ? 'border-white/[0.08] from-white/[0.02] via-transparent to-black/30 opacity-80' : 'border-amber-500/20 from-amber-950/25 via-transparent to-black/40',
  )
  return unlocked ? (
    <button type="button" onClick={onOpen} aria-pressed={selected} className={frame} data-testid={`survivor-premium-tile-${tile.tileId}`}>{body}</button>
  ) : (
    <div className={frame} data-testid={`survivor-premium-tile-${tile.tileId}`}>{body}</div>
  )
}

export function SurvivorPremiumCommandCenterPanel({
  leagueId,
  plan,
  tokensRemaining,
  isCommissioner,
  tilesOnly = false,
}: {
  leagueId: string
  /** Undefined when the page does not know it; the server's answer is used either way. */
  plan?: AfPlanId | null
  tokensRemaining: number | null
  isCommissioner?: boolean
  /** The player page shows the tiles only; the commissioner hub adds plan, token and price panels. */
  tilesOnly?: boolean
}) {
  // Locks come from the server, which enforces them on every tile request. Until it answers (or
  // if it cannot), the page falls back to the same rules with the plan it was handed.
  const [serverAccess, setServerAccess] = useState<Record<string, SurvivorPremiumTileAccess> | null>(null)
  const [openTileId, setOpenTileId] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/survivor/premium`, { cache: 'no-store', credentials: 'include' })
      .then(res => (res.ok ? res.json() : null))
      .then((body: { tiles?: Array<{ tileId: string; access: SurvivorPremiumTileAccess }> } | null) => {
        if (!cancelled && body?.tiles) setServerAccess(Object.fromEntries(body.tiles.map(t => [t.tileId, t.access])))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [leagueId])
  const accessFor = (tile: SurvivorPremiumTileGate): TileAccess =>
    serverAccess?.[tile.tileId] ?? (plan === undefined ? null : resolveSurvivorPremiumTileAccess({ tileId: tile.tileId, plan, isCommissioner: Boolean(isCommissioner) }))
  const openTile = SURVIVOR_PREMIUM_COMMAND_TILES.find(tile => tile.tileId === openTileId) ?? null
  // Only actions that exist and can be run: the same table the AI route charges from.
  const playerActions = SURVIVOR_SOLD_AI_ACTIONS.filter((a) => a.lane === 'player')
  const hostActions = SURVIVOR_SOLD_AI_ACTIONS.filter((a) => a.lane === 'host')

  return (
    <div className="space-y-6" data-testid="survivor-premium-command-center">
      <WarRoomPanel
        title="Premium Survivor command center"
        subtitle="Tournament-grade intel — tiered by AF Pro, AF Commissioner, and AF Supreme. Advanced reports can burn AF Tokens."
      >
        <p className="text-sm leading-relaxed text-white/55">
          Player lens unlocks with <span className="text-emerald-200/90">AF Pro</span>. Host tools unlock with{' '}
          <span className="text-amber-100/90">AF Commissioner</span>, and story mode controls with{' '}
          <span className="text-violet-200/90">AF Supreme</span> (AF Pro + AF Commissioner in one plan).
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {SURVIVOR_PREMIUM_COMMAND_TILES.map((tile) => (
            <SurvivorPremiumTileCard
              key={tile.tileId}
              tile={tile}
              access={accessFor(tile)}
              selected={openTileId === tile.tileId}
              onOpen={() => setOpenTileId(current => (current === tile.tileId ? null : tile.tileId))}
            />
          ))}
        </div>
        {openTile ? <div className="mt-4"><SurvivorPremiumTileDetail leagueId={leagueId} tileId={openTile.tileId} title={openTile.title} /></div> : null}
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

      {tilesOnly ? null : <>
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
          hint="You confirm the cost before any spend"
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
        <WarRoomPanel title="Player actions · token costs" subtitle="AF Tokens per run, before any plan discount. Every run costs tokens, on a plan or not; the exact cost is shown before you confirm.">
          <ul className="max-h-64 space-y-2 overflow-y-auto pr-1 text-[12px] text-white/65">
            {playerActions.map((a) => (
              <li
                key={a.aiType}
                className="flex justify-between gap-2 rounded-lg border border-white/[0.06] bg-black/25 px-2 py-1.5"
              >
                <span>{a.label}</span>
                <span className="font-mono text-cyan-200/90">{a.tokenCost ?? '—'}</span>
              </li>
            ))}
          </ul>
        </WarRoomPanel>
        <WarRoomPanel title="Host / commissioner actions · token costs" subtitle="Commissioner only. AF Tokens per run, before any plan discount. Every run costs tokens; the exact cost is shown before you confirm.">
          <ul className="max-h-64 space-y-2 overflow-y-auto pr-1 text-[12px] text-white/65">
            {hostActions.map((a) => (
              <li
                key={a.aiType}
                className="flex justify-between gap-2 rounded-lg border border-white/[0.06] bg-black/25 px-2 py-1.5"
              >
                <span>{a.label}</span>
                <span className="font-mono text-amber-200/90">{a.tokenCost ?? '—'}</span>
              </li>
            ))}
          </ul>
        </WarRoomPanel>
      </div>
      </>}
    </div>
  )
}
