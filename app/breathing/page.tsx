import type { Metadata } from "next"
import Link from "next/link"
import { getPublicSiteOrigin } from "@/lib/site-public-origin"

const BASE = getPublicSiteOrigin()

export const metadata: Metadata = {
  title: "Guided Breathing Exercises for Calm & Anxiety \u2014 Zen Lab",
  description:
    "Use Zen Lab by AllFantasy for guided breathing exercises, structured breathwork patterns, and quick calm sessions that help with stress and anxiety.",
  alternates: {
    canonical: `${BASE}/breathing`,
  },
  openGraph: {
    title: "Guided Breathing Exercises for Calm \u2014 Zen Lab",
    description:
      "Follow simple 4\u20114\u20116, box breathing, and 4\u20117\u20118 patterns with Zen Lab\u2019s breathing circle for calmer days and easier wind-downs.",
    url: `${BASE}/breathing`,
    type: "website",
  },
}

export default function BreathingPage() {
  return (
    <main className="mode-readable min-h-screen" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebPage",
            name: "Guided Breathing Exercises for Calm & Anxiety — Zen Lab",
            url: `${BASE}/breathing`,
            inLanguage: ["en", "es"],
            description:
              "Guided breathing exercises and calming breathwork patterns in Zen Lab, including 4-4-6, box breathing, and 4-7-8 sequences for stress and anxiety.",
            isPartOf: {
              "@type": "WebSite",
              name: "AllFantasy",
              url: `${BASE}/`,
            },
          }),
        }}
      />
      <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-12">
        <header className="space-y-3 text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Guided breathing exercises for calmer days
          </h1>
          <p className="mx-auto max-w-2xl text-sm text-white/70 sm:text-base">
            Zen Lab turns proven breathing patterns into simple on-screen guidance, so you can
            focus on your inhale, hold, and exhale instead of watching a timer.
          </p>
        </header>

        <section className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-base font-semibold text-white">Breathing for anxiety and stress</h2>
            <p className="mt-2 text-sm text-white/70">
              When your thoughts are racing, short guided breathing sessions can create enough
              space for your body to slow down. Zen Lab supports calm patterns you can repeat
              anytime you feel tension building.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-base font-semibold text-white">Structured breathwork patterns</h2>
            <p className="mt-2 text-sm text-white/70">
              Use balanced 4\u20114\u20116, box 4\u20114\u20114, or relax-focused 4\u20117\u20118
              sequences. The breathing circle and phase labels make it easy to stay with the
              pattern for a full session.
            </p>
          </div>
        </section>

        <section className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-5">
          <h3 className="text-sm font-semibold text-white">Quick breathing, anywhere</h3>
          <p className="mt-2 text-sm text-white/70">
            Because Zen Lab runs in your browser, you can open a quick breathing session on your
            phone, tablet, or laptop. Use it before a call, after a long day, or whenever you
            notice your shoulders creeping up.
          </p>
        </section>

        <section className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-5 py-4">
          <div className="max-w-xl text-sm text-white/75">
            <p className="font-semibold text-white">
              Start a guided breathing session with Zen Lab.
            </p>
            <p className="mt-1">
              Pick a pattern, choose a duration, and let the breathing circle walk you through
              each phase.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link
              href="/zen"
              className="inline-flex items-center justify-center rounded-full bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-black shadow-sm hover:bg-emerald-300"
            >
              Open Zen Lab
            </Link>
            <Link
              href="/meditation"
              className="inline-flex items-center justify-center rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10"
            >
              Learn about meditation
            </Link>
          </div>
        </section>
      </section>
    </main>
  )
}

