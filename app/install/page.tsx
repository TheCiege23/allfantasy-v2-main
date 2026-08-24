import type { Metadata } from "next"
import Link from "next/link"
import { buildSeoMeta, getSoftwareApplicationSchema, getWebPageSchema } from "@/lib/seo"
import { PageJsonLd } from "@/components/seo/JsonLd"
import { getPublicSiteOrigin } from "@/lib/site-public-origin"

export const metadata: Metadata = buildSeoMeta({
  title: "Install AllFantasy App – Mobile Fantasy Tools",
  description:
    "Install AllFantasy for fast mobile access to trade analyzer, waiver wire advisor, mock drafts, bracket challenges, and league management.",
  canonicalPath: "/install",
  keywords: [
    "install fantasy sports app",
    "PWA fantasy sports",
    "fantasy app install",
    "mobile fantasy tools",
    "allfantasy app",
  ],
})

export default function InstallPage() {
  const schemas = [
    getWebPageSchema({
      name: "Install AllFantasy App",
      description:
        "Install AllFantasy to your device for quick access to fantasy sports tools and league management.",
      url: "/install",
    }),
    getSoftwareApplicationSchema({
      name: "AllFantasy",
      description:
        "AI-powered fantasy sports platform with trade analysis, waiver recommendations, mock drafts, bracket challenges, and league management.",
      url: `${getPublicSiteOrigin()}/install`,
      applicationCategory: "SportsApplication",
    }),
  ]

  return (
    <main className="min-h-screen mode-readable px-4 py-10 sm:px-6">
      <PageJsonLd schemas={schemas} />
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Install AllFantasy</h1>
        <p className="text-sm sm:text-base" style={{ color: "var(--muted)" }}>
          Add AllFantasy to your home screen for faster launch, better re-engagement, and instant
          access to core tools across NFL, NHL, NBA, MLB, NCAA Basketball, NCAA Football, and Soccer.
        </p>

        <section className="rounded-2xl border p-5" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-lg font-semibold mb-2">Install on iPhone / iPad</h2>
          <ol className="list-decimal pl-5 space-y-1 text-sm" style={{ color: "var(--muted)" }}>
            <li>Open AllFantasy in Safari.</li>
            <li>Tap the Share icon.</li>
            <li>Select <span className="font-medium">Add to Home Screen</span>.</li>
            <li>Tap <span className="font-medium">Add</span>.</li>
          </ol>
        </section>

        <section className="rounded-2xl border p-5" style={{ borderColor: "var(--border)" }}>
          <h2 className="text-lg font-semibold mb-2">Install on Android</h2>
          <ol className="list-decimal pl-5 space-y-1 text-sm" style={{ color: "var(--muted)" }}>
            <li>Open AllFantasy in Chrome.</li>
            <li>Tap the menu and choose <span className="font-medium">Install app</span>.</li>
            <li>Confirm install to pin it to your launcher.</li>
          </ol>
        </section>

        <div className="flex flex-wrap gap-3">
          <Link
            href="/app"
            className="rounded-xl px-4 py-2.5 text-sm font-semibold"
            style={{ background: "var(--accent)", color: "#fff" }}
            data-testid="install-open-app"
          >
            Open Sports App
          </Link>
          <Link
            href="/tools-hub"
            className="rounded-xl border px-4 py-2.5 text-sm font-medium"
            style={{ borderColor: "var(--border)", color: "var(--text)" }}
            data-testid="install-open-tools-hub"
          >
            Explore Tools
          </Link>
        </div>
      </div>
    </main>
  )
}
