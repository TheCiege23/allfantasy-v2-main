'use client'

import Link from 'next/link'
import { Sparkles } from 'lucide-react'
import { AF_PLANS, AF_TOKEN_COST_TIERS, type AfPlanId } from '@/lib/tournament/af-premium-plans'
import { WarRoomPanel } from '@/components/tournament/TournamentWarRoomPrimitives'
import { PremiumFeatureLock } from '@/components/tournament/PremiumFeatureLock'
import { hasAfCommissionerTier } from '@/lib/tournament/resolve-af-plan-from-subscription'

export function TournamentSubscriptionTokensPanel({
  entitlements,
}: {
  /** Optional: from session/billing when wired */
  entitlements?: { plan: AfPlanId | null; afTokensRemaining: number | null } | null
}) {
  const plan = entitlements?.plan ?? null
  const tokens = entitlements?.afTokensRemaining

  return (
    <div className="space-y-6">
      <WarRoomPanel
        title="Subscription access"
        subtitle="AF Pro (player AI), AF Commissioner (ops AI), AF Supreme (both). Locked controls show upgrade paths."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          {(Object.keys(AF_PLANS) as AfPlanId[]).map((id) => {
            const p = AF_PLANS[id]
            const active = plan === id
            return (
              <div
                key={id}
                className={`rounded-xl border px-4 py-4 transition-all ${
                  active
                    ? 'border-cyan-400/40 bg-cyan-500/10 shadow-[0_0_32px_-8px_rgba(34,211,238,0.25)]'
                    : 'border-white/[0.08] bg-black/20 hover:border-white/[0.12]'
                }`}
              >
                <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/40">{p.shortLabel}</p>
                <p className="mt-2 text-lg font-bold text-white">{p.label}</p>
                <p className="mt-2 text-xs leading-relaxed text-white/50">{p.description}</p>
                <ul className="mt-3 space-y-1.5 text-[11px] text-white/55">
                  {p.unlocks.map((u) => (
                    <li key={u} className="flex gap-2">
                      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-400/70" />
                      {u}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/settings"
            className="inline-flex items-center justify-center rounded-xl border border-cyan-500/35 bg-cyan-500/15 px-4 py-2.5 text-sm font-semibold text-cyan-50 hover:bg-cyan-500/25"
          >
            Manage subscription
          </Link>
        </div>
        {!hasAfCommissionerTier(plan) ? (
          <div className="mt-4">
            <PremiumFeatureLock requiredPlan="af_commissioner" featureLabel="Advanced tournament automation" />
          </div>
        ) : null}
      </WarRoomPanel>

      <WarRoomPanel title="AF Tokens" subtitle="Premium AI burns tokens by depth — quick (1), standard (2), deep (3).">
        <div className="grid gap-3 md:grid-cols-3">
          {(Object.keys(AF_TOKEN_COST_TIERS) as Array<keyof typeof AF_TOKEN_COST_TIERS>).map((key) => {
            const tier = AF_TOKEN_COST_TIERS[key]
            return (
            <div key={key} className="rounded-xl border border-white/[0.07] bg-black/25 px-4 py-3">
              <p className="font-mono text-2xl font-bold text-white">{tier.tokens}</p>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">tokens</p>
              <p className="mt-2 text-xs text-white/50">{tier.examples}</p>
            </div>
            )
          })}
        </div>
        <p className="mt-4 text-sm text-white/45">
          Balance
          {tokens != null ? (
            <>
              : <span className="font-mono font-bold text-cyan-200/90">{tokens}</span>
            </>
          ) : (
            ' will appear here when billing is linked.'
          )}
        </p>
      </WarRoomPanel>
    </div>
  )
}
