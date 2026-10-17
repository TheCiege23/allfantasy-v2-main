import Link from 'next/link'
import { Plus, Users, Trophy, MessageCircle, Sparkles, History, Goal, Globe2 } from 'lucide-react'
import { getPrimaryChimmyEntry } from '@/lib/ai-product-layer'

/**
 * Bracket hub quick-action cards. Theme-safe across Light / Dark / AF / System modes —
 * uses CSS variables (var(--text), var(--muted), var(--accent-cyan-strong), etc.) instead
 * of hardcoded `text-white` which was unreadable in Light mode.
 */
export default function BracketHomeTabs({ poolCount }: { poolCount: number }) {
  const chimmyHref = getPrimaryChimmyEntry().href
  const cards = [
    { href: '/brackets/leagues/new?challengeType=playoff_challenge', label: 'Create Pool', desc: 'Set scoring, sport, challenge type, privacy, and invite link.', icon: Plus },
    { href: '/brackets/leagues/new?challengeType=playoff_challenge', label: 'Playoff Challenge', desc: 'Start a sport-specific playoff bracket challenge instantly.', icon: Goal },
    { href: '/brackets/world-cup', label: 'FIFA World Cup Bracket', desc: 'Run a 2026 knockout bracket with invite links, picks, and leaderboard.', icon: Globe2 },
    { href: '/brackets/join', label: 'Join Pool', desc: 'Enter invite code and start competing quickly.', icon: Users },
    { href: '/brackets', label: 'My Pools', desc: `${poolCount} active pool${poolCount === 1 ? '' : 's'} in your account.`, icon: Trophy },
    { href: '/messages', label: 'Pool Chat', desc: 'Jump into chat, polls, and talk with Chimmy.', icon: MessageCircle },
    { href: chimmyHref, label: 'Ask Chimmy', desc: 'Get safe vs contrarian guidance instantly.', icon: Sparkles },
    { href: '/brackets', label: 'History', desc: 'Review prior entries and finishing trends.', icon: History },
  ]

  return (
    <section className="mode-readable grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => {
        const Icon = card.icon
        return (
          <Link
            key={`${card.label}-${card.href}`}
            href={card.href}
            className="group rounded-xl border p-4 transition hover:opacity-90"
            style={{
              borderColor: 'var(--border)',
              background: 'color-mix(in srgb, var(--panel) 88%, transparent)',
              color: 'var(--text)',
            }}
          >
            <div
              className="mb-2 inline-flex rounded-lg border p-2"
              style={{
                borderColor: 'color-mix(in srgb, var(--accent-cyan) 24%, transparent)',
                background: 'color-mix(in srgb, var(--accent-cyan) 12%, transparent)',
              }}
            >
              <Icon className="h-4 w-4" style={{ color: 'var(--accent-cyan-strong)' }} />
            </div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{card.label}</h3>
            <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>{card.desc}</p>
          </Link>
        )
      })}
    </section>
  )
}
