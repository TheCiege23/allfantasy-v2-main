"use client"

/**
 * BracketsAuthCTA — client island for /brackets session-aware CTAs.
 *
 * Reads useSession() which is pre-seeded by the root layout's initialSession,
 * so signed-in users see authenticated content on first render with no flash.
 *
 * Used in two places in app/brackets/page.tsx:
 *   <BracketsHeroCTA />   — replaces the hero CTA buttons + social proof
 *   <BracketsGuestCard /> — replaces the bottom CTA card section
 */

import Link from "next/link"
import { useSession } from "next-auth/react"
import { Globe2, Plus, Sparkles, Trophy, Users } from "lucide-react"

// ─── Hero CTA buttons (inside the hero section) ──────────────────────────────

export function BracketsHeroCTA() {
  const { status } = useSession()

  // While initialSession propagates — renders nothing (instant in practice
  // because SessionProvider receives the server-preloaded session).
  if (status === "loading") return null

  if (status === "authenticated") {
    return (
      <>
        <div className="mt-9 sm:mt-10">
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href="/brackets/world-cup"
              className="inline-flex min-h-[52px] w-full max-w-xs items-center justify-center gap-2 rounded-2xl px-7 py-3 text-sm font-bold transition-all hover:opacity-90 hover:scale-[1.02] active:scale-[0.98] sm:w-auto sm:min-w-[200px]"
              style={{
                background:
                  "linear-gradient(135deg, var(--accent-cyan), color-mix(in srgb, var(--accent-cyan-strong) 68%, #818cf8))",
                color: "var(--on-accent-bg)",
                boxShadow:
                  "0 10px 36px -10px color-mix(in srgb, var(--accent-cyan) 72%, transparent), 0 0 0 1px color-mix(in srgb, var(--accent-cyan) 28%, transparent)",
              }}
            >
              <Globe2 className="h-4 w-4 shrink-0" />
              World Cup Bracket
            </Link>
            <Link
              href="/brackets/world-cup/create"
              className="inline-flex min-h-[52px] w-full max-w-xs items-center justify-center gap-2 rounded-2xl border px-7 py-3 text-sm font-semibold transition-all hover:opacity-90 sm:w-auto sm:min-w-[160px]"
              style={{
                borderColor: "rgba(255,255,255,0.20)",
                color: "rgba(255,255,255,0.88)",
                background: "rgba(255,255,255,0.06)",
                backdropFilter: "blur(12px)",
              }}
            >
              <Plus className="h-4 w-4 shrink-0" />
              Create Pool
            </Link>
            <Link
              href="/brackets/world-cup/discover"
              className="inline-flex min-h-[52px] w-full max-w-xs items-center justify-center gap-2 rounded-2xl border px-7 py-3 text-sm font-semibold transition-all hover:opacity-90 sm:w-auto sm:min-w-[160px]"
              style={{
                borderColor: "color-mix(in srgb, var(--accent-amber) 34%, transparent)",
                color: "rgba(255,255,255,0.92)",
                background: "color-mix(in srgb, var(--accent-amber) 12%, transparent)",
              }}
            >
              <Trophy className="h-4 w-4 shrink-0" style={{ color: "var(--accent-amber-strong)" }} />
              Discover Pools
            </Link>
          </div>
        </div>

        {/* Social proof */}
        <div className="mt-8 flex justify-center">
          <div
            className="inline-flex items-center gap-3 rounded-full border px-4 py-2"
            style={{
              background: "rgba(255,255,255,0.04)",
              borderColor: "rgba(255,255,255,0.10)",
              backdropFilter: "blur(12px)",
            }}
          >
            <div className="flex -space-x-1.5" aria-hidden="true">
              {(["🇧🇷", "🇫🇷", "🇩🇪", "🇦🇷"] as const).map((flag, i) => (
                <div
                  key={i}
                  className="flex h-6 w-6 items-center justify-center rounded-full border text-xs"
                  style={{ borderColor: "rgba(0,0,0,0.35)", background: "rgba(255,255,255,0.09)" }}
                >
                  {flag}
                </div>
              ))}
            </div>
            <span className="text-[11px] font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>
              Join thousands of fans competing worldwide
            </span>
          </div>
        </div>
      </>
    )
  }

  // Unauthenticated — original guest CTAs
  return (
    <>
      <div className="mt-9 sm:mt-10">
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link
            href="/signup?next=%2Fbrackets&callbackUrl=%2Fbrackets"
            className="inline-flex min-h-[52px] w-full max-w-xs items-center justify-center gap-2 rounded-2xl px-7 py-3 text-sm font-bold transition-all hover:opacity-90 hover:scale-[1.02] active:scale-[0.98] sm:w-auto sm:min-w-[200px]"
            style={{
              background:
                "linear-gradient(135deg, var(--accent-cyan), color-mix(in srgb, var(--accent-cyan-strong) 68%, #818cf8))",
              color: "var(--on-accent-bg)",
              boxShadow:
                "0 10px 36px -10px color-mix(in srgb, var(--accent-cyan) 72%, transparent), 0 0 0 1px color-mix(in srgb, var(--accent-cyan) 28%, transparent)",
            }}
          >
            <Sparkles className="h-4 w-4 shrink-0" />
            Sign Up Free
          </Link>
          <Link
            href="/login?callbackUrl=%2Fbrackets"
            className="inline-flex min-h-[52px] w-full max-w-xs items-center justify-center gap-2 rounded-2xl border px-7 py-3 text-sm font-semibold transition-all hover:opacity-90 sm:w-auto sm:min-w-[160px]"
            style={{
              borderColor: "rgba(255,255,255,0.20)",
              color: "rgba(255,255,255,0.88)",
              background: "rgba(255,255,255,0.06)",
              backdropFilter: "blur(12px)",
            }}
          >
            Sign In
          </Link>
          <Link
            href="/brackets/discover"
            className="inline-flex min-h-[52px] w-full max-w-xs items-center justify-center gap-2 rounded-2xl border px-7 py-3 text-sm font-semibold transition-all hover:opacity-90 sm:w-auto sm:min-w-[160px]"
            style={{
              borderColor: "color-mix(in srgb, var(--accent-amber) 34%, transparent)",
              color: "rgba(255,255,255,0.92)",
              background: "color-mix(in srgb, var(--accent-amber) 12%, transparent)",
            }}
          >
            <Trophy className="h-4 w-4 shrink-0" style={{ color: "var(--accent-amber-strong)" }} />
            Discover Pools
          </Link>
        </div>
      </div>

      {/* Social proof */}
      <div className="mt-8 flex justify-center">
        <div
          className="inline-flex items-center gap-3 rounded-full border px-4 py-2"
          style={{
            background: "rgba(255,255,255,0.04)",
            borderColor: "rgba(255,255,255,0.10)",
            backdropFilter: "blur(12px)",
          }}
        >
          <div className="flex -space-x-1.5" aria-hidden="true">
            {(["🇧🇷", "🇫🇷", "🇩🇪", "🇦🇷"] as const).map((flag, i) => (
              <div
                key={i}
                className="flex h-6 w-6 items-center justify-center rounded-full border text-xs"
                style={{ borderColor: "rgba(0,0,0,0.35)", background: "rgba(255,255,255,0.09)" }}
              >
                {flag}
              </div>
            ))}
          </div>
          <span className="text-[11px] font-medium" style={{ color: "rgba(255,255,255,0.55)" }}>
            Join thousands of fans competing worldwide
          </span>
        </div>
      </div>
    </>
  )
}

// ─── Bottom CTA card (below the hero section) ────────────────────────────────

const FEATURE_TILES = [
  {
    icon: Globe2,
    label: "World Cup Bracket",
    desc: "Full FIFA 2026 bracket with group stage + knockout picks",
    accent: "var(--accent-cyan-strong)",
  },
  {
    icon: Sparkles,
    label: "Chimmy",
    desc: "Win probabilities and upset analysis on every matchup",
    accent: "#c084fc",
  },
  {
    icon: Users,
    label: "Private Pools",
    desc: "Invite friends with a code — your own live leaderboard",
    accent: "var(--accent-amber-strong)",
  },
] as const

export function BracketsGuestCard() {
  const { status } = useSession()

  if (status === "loading") return null

  const isAuthed = status === "authenticated"

  return (
    <div className="mx-auto max-w-5xl px-4 pb-8 sm:px-6">
      <div
        className="mb-10 -mt-6 rounded-3xl border p-6 text-center sm:p-8"
        style={{
          background: "color-mix(in srgb, var(--panel) 92%, transparent)",
          borderColor: "color-mix(in srgb, var(--accent-cyan) 26%, var(--border))",
          boxShadow: "0 28px 64px -32px color-mix(in srgb, var(--accent-cyan) 32%, transparent)",
          backdropFilter: "blur(16px)",
        }}
      >
        <div
          className="mb-3 inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em]"
          style={{
            background: "color-mix(in srgb, var(--accent-cyan) 12%, transparent)",
            borderColor: "color-mix(in srgb, var(--accent-cyan) 28%, transparent)",
            color: "var(--accent-cyan-strong)",
          }}
        >
          <Sparkles className="h-3.5 w-3.5" />
          {isAuthed ? "Your bracket hub" : "Get started free"}
        </div>
        <h2 className="mb-2 text-xl font-bold sm:text-2xl" style={{ color: "var(--text)" }}>
          {isAuthed
            ? "Create a pool. Build your bracket. Climb the leaderboard."
            : "Create a pool. Invite friends. Fill your bracket."}
        </h2>
        <p className="mx-auto mb-6 max-w-md text-sm" style={{ color: "var(--muted)" }}>
          {isAuthed
            ? "Launch a World Cup pool, fill your bracket, and track live scores — all in one place."
            : "Launch your first bracket pool in minutes. Chimmy's analysis on every pick. No fees, no premium tiers. Free forever."}
        </p>

        <div className="flex flex-col items-center gap-2.5 sm:flex-row sm:justify-center sm:gap-3">
          {isAuthed ? (
            <>
              <Link
                href="/brackets/world-cup"
                className="inline-flex w-full min-w-[10rem] items-center justify-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-bold transition hover:opacity-90 sm:w-auto"
                style={{
                  backgroundImage:
                    "linear-gradient(90deg, var(--accent-cyan), color-mix(in srgb, var(--accent-cyan-strong) 72%, #3b82f6))",
                  color: "var(--on-accent-bg)",
                  boxShadow: "0 8px 24px -10px color-mix(in srgb, var(--accent-cyan) 60%, transparent)",
                }}
              >
                <Globe2 className="h-3.5 w-3.5" />
                My World Cup Pools
              </Link>
              <Link
                href="/brackets/world-cup/create"
                className="inline-flex w-full min-w-[10rem] items-center justify-center gap-1.5 rounded-xl border px-5 py-2.5 text-sm font-semibold transition hover:opacity-90 sm:w-auto"
                style={{
                  borderColor: "var(--border)",
                  color: "var(--text)",
                  background: "color-mix(in srgb, var(--panel2) 50%, transparent)",
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                Create Pool
              </Link>
            </>
          ) : (
            <>
              <Link
                href="/signup?next=%2Fbrackets&callbackUrl=%2Fbrackets"
                className="inline-flex w-full min-w-[10rem] items-center justify-center gap-1.5 rounded-xl px-5 py-2.5 text-sm font-bold transition hover:opacity-90 sm:w-auto"
                style={{
                  backgroundImage:
                    "linear-gradient(90deg, var(--accent-cyan), color-mix(in srgb, var(--accent-cyan-strong) 72%, #3b82f6))",
                  color: "var(--on-accent-bg)",
                  boxShadow: "0 8px 24px -10px color-mix(in srgb, var(--accent-cyan) 60%, transparent)",
                }}
              >
                Sign Up Free
              </Link>
              <Link
                href="/login?callbackUrl=%2Fbrackets"
                className="inline-flex w-full min-w-[10rem] items-center justify-center gap-1.5 rounded-xl border px-5 py-2.5 text-sm font-semibold transition hover:opacity-90 sm:w-auto"
                style={{
                  borderColor: "var(--border)",
                  color: "var(--text)",
                  background: "color-mix(in srgb, var(--panel2) 50%, transparent)",
                }}
              >
                Sign In
              </Link>
            </>
          )}
        </div>

        {/* Feature tiles — always visible */}
        <div className="mt-6 grid grid-cols-1 gap-3 text-left sm:grid-cols-3">
          {FEATURE_TILES.map(({ icon: Icon, label, desc, accent }) => (
            <div
              key={label}
              className="rounded-xl border p-4"
              style={{
                borderColor: "var(--border)",
                background: "color-mix(in srgb, var(--panel2) 60%, transparent)",
              }}
            >
              <Icon className="mb-2 h-5 w-5" style={{ color: accent }} />
              <div className="mb-1 text-sm font-semibold" style={{ color: "var(--text)" }}>
                {label}
              </div>
              <div className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
                {desc}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
