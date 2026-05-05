"use client"

import Link from "next/link"
import type { ReactNode } from "react"
import { Loader2 } from "lucide-react"

export function AuthStatusShell({
  children,
  navRightHref = "/",
  navRightLabel = "Home",
}: {
  children: ReactNode
  navRightHref?: string
  navRightLabel?: string
}) {
  return (
    <div
      className="relative min-h-screen overflow-hidden mode-readable"
      style={{ background: "var(--bg)", color: "var(--text)" }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse 55% 45% at 50% 15%, color-mix(in srgb, var(--accent-cyan) 14%, transparent) 0%, transparent 65%),
            radial-gradient(ellipse 40% 35% at 70% 80%, color-mix(in srgb, var(--accent-purple) 8%, transparent) 0%, transparent 65%),
            radial-gradient(ellipse 50% 40% at 20% 60%, color-mix(in srgb, var(--accent-purple) 6%, transparent) 0%, transparent 65%)
          `,
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-80"
        style={{
          backgroundImage: `linear-gradient(color-mix(in srgb, var(--border) 55%, transparent) 1px, transparent 1px), linear-gradient(90deg, color-mix(in srgb, var(--border) 55%, transparent) 1px, transparent 1px)`,
          backgroundSize: "52px 52px",
          maskImage: "radial-gradient(ellipse 60% 60% at 50% 30%, black, transparent 80%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 60% 60% at 50% 30%, black, transparent 80%)",
        }}
      />

      <nav
        className="relative z-20 flex h-14 items-center justify-between border-b px-4 backdrop-blur-xl sm:px-8"
        style={{
          borderColor: "var(--border)",
          background: "color-mix(in srgb, var(--bg) 92%, transparent)",
        }}
      >
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <img
            src="https://www.allfantasy.ai/af-crest.png"
            alt="AllFantasy"
            width={28}
            height={28}
            className="h-7 w-7 object-contain"
          />
          <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text font-['Bebas_Neue'] text-[20px] tracking-[0.06em] text-transparent">
            AllFantasy
          </span>
        </Link>
        <Link
          href={navRightHref}
          className="rounded-[7px] border px-4 py-1.5 text-[13px] font-medium transition hover:opacity-90"
          style={{
            borderColor: "color-mix(in srgb, var(--border) 100%, transparent)",
            color: "var(--muted)",
          }}
        >
          {navRightLabel}
        </Link>
      </nav>

      <main className="relative z-10 flex min-h-[calc(100vh-56px)] items-center justify-center px-4 py-10 sm:py-16">
        {children}
      </main>
    </div>
  )
}

export function AuthStatusHeader({
  title,
  subtitle,
}: {
  title: string
  subtitle: string
}) {
  return (
    <div className="pb-8 text-center">
      <div className="relative mb-5 inline-flex">
        <div className="absolute left-1/2 top-1/2 h-[110px] w-[110px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(6,182,212,0.22)_0%,rgba(59,130,246,0.12)_40%,transparent_70%)] blur-[5px]" />
        <img
          src="https://www.allfantasy.ai/branding/allfantasy-crest-chatgpt.png"
          alt="AllFantasy crest"
          width={60}
          height={60}
          className="relative h-[60px] w-[60px] object-contain drop-shadow-[0_0_16px_rgba(6,182,212,0.42)]"
        />
      </div>
      <p className="text-[20px] font-semibold" style={{ color: "var(--text)" }}>
        {title}
      </p>
      <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
        {subtitle}
      </p>
    </div>
  )
}

export function AuthStatusLoadingFallback({
  label = "Loading...",
}: {
  label?: string
}) {
  return (
    <AuthStatusShell>
      <div className="flex flex-col items-center justify-center gap-3 text-center">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-2xl border"
          style={{
            borderColor: "color-mix(in srgb, var(--accent-cyan) 25%, var(--border))",
            background: "color-mix(in srgb, var(--accent-cyan) 10%, transparent)",
          }}
        >
          <Loader2 className="h-7 w-7 animate-spin" style={{ color: "var(--accent-cyan-strong)" }} />
        </div>
        <div className="text-sm" style={{ color: "var(--muted)" }}>
          {label}
        </div>
      </div>
    </AuthStatusShell>
  )
}
