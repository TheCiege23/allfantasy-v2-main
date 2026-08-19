"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { ShieldCheck, Zap, Globe } from "lucide-react"
import "./nocturne-auth.css"

const TRUST_ROWS: { icon: typeof ShieldCheck; label: string }[] = [
  { icon: ShieldCheck, label: "Fantasy sports only — no gambling" },
  { icon: Zap, label: "Free to start, no credit card" },
  { icon: Globe, label: "7 sports, 13+ league formats" },
]

/**
 * The shared split-panel shell for /signup and /login (Nocturne direction "1a").
 * Left: a quiet brand moment (shield, one-line tagline, three trust rows).
 * Right: a slim wordmark nav with a page-specific link, over a centered slot.
 *
 * Scoped entirely under `.nocturne-auth` so its tokens never touch the app theme.
 * Collapses to a single column below `lg`, with a compact brand strip above the
 * card in place of the left panel.
 */
export function NocturneAuthShell({
  navRight,
  children,
}: {
  navRight: ReactNode
  children: ReactNode
}) {
  return (
    <div className="nocturne-auth grid min-h-screen grid-cols-1 lg:grid-cols-[440px_1fr]">
      {/* Left brand panel — desktop only */}
      <aside
        aria-hidden="true"
        className="relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-center"
        style={{
          background: "var(--color-surface)",
          borderRight: "1px solid var(--color-neutral-800)",
          padding: "64px 44px",
        }}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(560px 480px at 25% 20%, color-mix(in srgb, var(--color-section-glow) 55%, transparent), transparent 62%)",
          }}
        />
        <div className="relative" style={{ zIndex: 1 }}>
          <img
            src="/brand/af-shield-transparent.png"
            alt=""
            style={{ height: 52, width: "auto", marginBottom: 28 }}
          />
          <h2
            style={{
              fontSize: 29,
              lineHeight: 1.25,
              letterSpacing: "-0.02em",
              margin: "0 0 14px",
            }}
          >
            Every league you play.
            <br />
            One account.
          </h2>
          <p
            style={{
              fontSize: 15,
              lineHeight: 1.6,
              color: "var(--color-neutral-400)",
              margin: "0 0 34px",
            }}
          >
            Sleeper, ESPN, Yahoo and more — all under one AllFantasy sign-in.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
            {TRUST_ROWS.map(({ icon: Icon, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <Icon size={18} style={{ color: "var(--color-accent-400)", flex: "none" }} />
                <span style={{ fontSize: 14, color: "var(--color-neutral-300)" }}>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Right column */}
      <div className="flex flex-col">
        <div
          style={{
            borderBottom: "1px solid color-mix(in srgb, var(--color-text) 7%, transparent)",
          }}
        >
          <div
            className="flex items-center justify-between"
            style={{ height: 64, padding: "0 32px" }}
          >
            <Link href="/" aria-label="AllFantasy home">
              <img
                src="/brand/allfantasy-wordmark-transparent.png"
                alt="AllFantasy"
                style={{ height: 28, width: "auto" }}
              />
            </Link>
            <div style={{ fontSize: 13.5, color: "var(--color-neutral-500)" }}>{navRight}</div>
          </div>
        </div>

        <div
          className="flex flex-1 flex-col items-center justify-center"
          style={{ padding: "36px 24px" }}
        >
          {/* Compact brand strip — mobile only, in place of the left panel */}
          <div className="mb-6 flex flex-col items-center text-center lg:hidden">
            <img
              src="/brand/af-shield-transparent.png"
              alt=""
              style={{ height: 40, width: "auto", marginBottom: 12 }}
            />
            <h2 style={{ fontSize: 22, lineHeight: 1.2, letterSpacing: "-0.02em" }}>
              Every league you play. One account.
            </h2>
          </div>
          {children}
        </div>
      </div>
    </div>
  )
}
