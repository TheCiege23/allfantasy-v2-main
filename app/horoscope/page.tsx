import type { Metadata } from "next"
import Link from "next/link"
import { getPublicSiteOrigin } from "@/lib/site-public-origin"

export const metadata: Metadata = {
  title: "Daily Reflection & Horoscope-Inspired Meditation \u2014 Zen Lab",
  description:
    "Use Zen Lab alongside your horoscope or astrology routine for quiet daily reflection, mindful breathing, and gentle spiritual check-ins.",
  alternates: {
    canonical: `${getPublicSiteOrigin()}/horoscope`,
  },
  openGraph: {
    title: "Daily Reflection & Horoscope-Inspired Calm \u2014 Zen Lab",
    description:
      "Pair your daily horoscope with a few minutes of guided breathing and reflection in Zen Lab to ground your day.",
    url: `${getPublicSiteOrigin()}/horoscope`,
    type: "website",
  },
}

export default function HoroscopePage() {
  return (
    <main className="mode-readable min-h-screen" style={{ background: "var(--bg)", color: "var(--text)" }}>
      <section className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-12">
        <header className="space-y-3 text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Daily reflection to pair with your horoscope
          </h1>
          <p className="mx-auto max-w-2xl text-sm text-white/70 sm:text-base">
            Zen Lab doesn&apos;t interpret astrology for you, but it does give you a quiet place
            to pause, breathe, and reflect after you read your horoscope or spiritual guidance
            for the day.
          </p>
        </header>

        <section className="mt-8 grid gap-6 sm:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-base font-semibold text-white">Turn insight into gentle action</h2>
            <p className="mt-2 text-sm text-white/70">
              After you read your daily horoscope, spend a few minutes with guided breathing or a
              short meditation script. Use that time to notice what resonated and how you&apos;d
              like to move through the day.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <h2 className="text-base font-semibold text-white">Spiritual reflection, on your terms</h2>
            <p className="mt-2 text-sm text-white/70">
              Whether your practice is astrology, journaling, or a different spiritual tradition,
              Zen Lab stays neutral. It simply offers breathing patterns, scenes, and mood
              check-ins to help you slow down long enough to listen.
            </p>
          </div>
        </section>

        <section className="mt-10 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 px-5 py-4">
          <div className="max-w-xl text-sm text-white/75">
            <p className="font-semibold text-white">
              Add a few minutes of calm after your daily horoscope.
            </p>
            <p className="mt-1">
              Open Zen Lab, choose a breathing pattern, and let a short reflection session help
              your insights land in your body, not just your timeline.
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

