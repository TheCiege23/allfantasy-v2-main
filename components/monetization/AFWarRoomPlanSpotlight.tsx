'use client'

import Link from 'next/link'
import { CheckCircle2, Coins, Crown, Shield, Telescope } from 'lucide-react'
import {
  trackTokenPurchaseClicked,
  trackUpgradeEntryClicked,
} from '@/lib/monetization-analytics'

const AF_WAR_ROOM_FEATURES = [
  'Draft build strategy',
  'Draft prep',
  'Future game planning',
  '3-5 year strategy planning',
  'Draft intelligence and roster construction support',
]

const DIFFERENTIATION = [
  {
    title: 'AF Legacy',
    icon: Telescope,
    copy: 'Premium draft and long-horizon strategy tier for individual managers.',
    tone: 'border-violet-400/35 bg-violet-500/10 text-violet-100',
  },
  {
    title: 'AF Pro',
    icon: Crown,
    copy: 'Player-specific tier for trades, waivers, matchups, and lineup decisions.',
    tone: 'border-cyan-400/35 bg-cyan-500/10 text-cyan-100',
  },
  {
    title: 'AF Commissioner',
    icon: Shield,
    copy: 'League governance and commissioner automation workflows.',
    tone: 'border-amber-400/35 bg-amber-500/10 text-amber-100',
  },
]

export function AFWarRoomPlanSpotlight({ className = '' }: { className?: string }) {
  return (
    <section
      className={`rounded-2xl border border-violet-400/20 bg-violet-500/[0.06] p-4 ${className}`}
      data-testid="af-war-room-spotlight"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">Why AF Legacy</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/upgrade?plan=war_room"
            onClick={() =>
              trackUpgradeEntryClicked({
                targetPlan: 'war_room',
                surface: 'af_war_room_spotlight',
                pagePath: window.location.pathname,
              })
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-violet-400/35 bg-violet-500/15 px-3 py-1.5 text-xs font-medium text-violet-100 hover:bg-violet-500/25"
            data-testid="af-war-room-upgrade-link"
          >
            <Telescope className="h-3.5 w-3.5" />
            Upgrade to AF Legacy
          </Link>
          <Link
            href="/tokens?ruleCode=ai_war_room_multi_step_planning"
            onClick={() =>
              trackTokenPurchaseClicked({
                ruleCode: 'ai_war_room_multi_step_planning',
                surface: 'af_war_room_spotlight',
                pagePath: window.location.pathname,
              })
            }
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/35 bg-amber-500/15 px-3 py-1.5 text-xs font-medium text-amber-100 hover:bg-amber-500/25"
            data-testid="af-war-room-token-link"
          >
            <Coins className="h-3.5 w-3.5" />
            Buy tokens
          </Link>
        </div>
      </div>

      <p className="mt-1 text-xs text-white/65">
        AF Legacy is the premium strategy and drafting tier. Use subscription access or tokens where policy allows.
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <article className="rounded-lg border border-white/10 bg-black/25 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-violet-200/90">AF Legacy includes</p>
          <ul className="mt-2 space-y-1.5 text-xs text-white/85">
            {AF_WAR_ROOM_FEATURES.map((item) => (
              <li key={item} className="flex items-start gap-1.5" data-testid="af-war-room-feature-item">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-300" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-lg border border-white/10 bg-black/25 p-3">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-white/75">How tiers differ</p>
          <div className="mt-2 space-y-2">
            {DIFFERENTIATION.map(({ title, icon: Icon, copy, tone }) => (
              <div
                key={title}
                className={`rounded-lg border px-2.5 py-2 text-xs ${tone}`}
                data-testid={`af-war-room-plan-diff-${title.toLowerCase().replace(/\s+/g, '-')}`}
              >
                <p className="inline-flex items-center gap-1.5 font-semibold">
                  <Icon className="h-3.5 w-3.5" />
                  {title}
                </p>
                <p className="mt-1">{copy}</p>
              </div>
            ))}
          </div>
        </article>
      </div>
    </section>
  )
}
