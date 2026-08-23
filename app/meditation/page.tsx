import type { Metadata } from "next"
import Link from "next/link"
import { getPublicSiteOrigin } from "@/lib/site-public-origin"

export const metadata: Metadata = {
  title: "Guided Meditation & Calm Sessions \u2014 Zen Lab by AllFantasy",
  description:
    "Use Zen Lab by AllFantasy for gentle guided meditation, breathing exercises, and daily reflection sessions you can start in a few taps.",
  alternates: {
    canonical: `${getPublicSiteOrigin()}/meditation`,
  },
  openGraph: {
    title: "Guided Meditation & Calm Sessions \u2014 Zen Lab",
    description:
      "Settle into guided meditation and breathing sessions with Zen Lab. Build a simple daily calm ritual you can actually keep.",
    url: `${getPublicSiteOrigin()}/meditation`,
    type: "website",
  },
}

export default function MeditationPage() {
  return (
    <main className="mode-readable min-h-screen" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "WebPage",
            name: "Guided Meditation & Calm Sessions — Zen Lab by AllFantasy",
            url: `${getPublicSiteOrigin()}/meditation`,
            inLanguage: ["en", "es"],
            description:
              "Guided meditation, calm sessions, and daily reflection using Zen Lab by AllFantasy, with short online meditations and gentle breathing exercises.",
            isPartOf: {
              "@type": "WebSite",
              name: "AllFantasy",
              url: `${getPublicSiteOrigin()}/`,
            },
          }),
        }}
      />
      <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-12">
        <header className="space-y-3 text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Guided meditation you can return to every day
          </h1>
          <p className="mx-auto max-w-2xl text-sm text-white/70 sm:text-base">
            Zen Lab is a calm space inside AllFantasy where you can run short guided meditation
            sessions, gentle breathing exercises, and daily reflection check-ins when you need a reset.
          </p>
        </header>

        <section className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-base font-semibold text-white">Guided meditation online</h2>
            <p className="mt-2 text-sm text-white/70">
              Choose a mood, a duration, and a calm visual scene. Zen Lab generates a soft script
              you can listen to while you sit or lie down, helping you ease into a short guided
              meditation without overthinking the steps.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-base font-semibold text-white">Breathing for stress and anxiety</h2>
            <p className="mt-2 text-sm text-white/70">
              Use quick breathing patterns like 4\u20114\u20116, 4\u20114\u20114 box breathing, or
              4\u20117\u20118 for deeper calm. The breathing circle in Zen Lab guides your inhale,
              hold, and exhale so you can focus on the rhythm instead of the timer.
            </p>
          </div>
        </section>

        <section className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h3 className="text-sm font-semibold text-white">Daily reflection & calm sessions</h3>
            <p className="mt-2 text-sm text-white/70">
              Track how you feel over time with simple mood check-ins and a daily calm streak.
              Use Zen Lab for a few minutes of reflection at the start or end of your day so your
              mind has a place to land.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h3 className="text-sm font-semibold text-white">Sleep and evening wind-down</h3>
            <p className="mt-2 text-sm text-white/70">
              Switch to darker scenes and slower breathing before bed. Zen Lab helps you create a
              gentle wind-down routine that supports sleep meditation and nighttime reflection
              without bright distractions.
            </p>
          </div>
        </section>

        <section className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-5 py-4">
          <div className="max-w-xl text-sm text-white/75">
            <p className="font-semibold text-white">
              Start your first guided meditation with Zen Lab.
            </p>
            <p className="mt-1">
              No complex setup\u2014just choose how you feel, pick a breathing pattern, and tap
              play when you&apos;re ready.
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
              href="/signup"
              className="inline-flex items-center justify-center rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10"
            >
              Create free account
            </Link>
          </div>
        </section>

        <section className="mt-8 text-xs text-white/60 sm:text-sm">
          <p>
            Looking for targeted calm tools? Try{" "}
            <Link href="/breathing" className="underline underline-offset-2 hover:text-white">
              guided breathing
            </Link>{" "}
            or{" "}
            <Link href="/horoscope" className="underline underline-offset-2 hover:text-white">
              daily reflection prompts
            </Link>{" "}
            next.
          </p>
        </section>
      </section>
    </main>
  )
}

