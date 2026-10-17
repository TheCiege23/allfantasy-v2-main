import Image from "next/image"
import Link from "next/link"
import WorldCupInviteJoinPanel from "@/components/brackets/world-cup/WorldCupInviteJoinPanel"
import { resolveServerRenderPreferences } from "@/lib/preferences/ServerRenderPreferenceResolver"
import { makeWcT } from "@/lib/world-cup/worldCupI18n"
import { ModeToggle } from "@/components/theme/ModeToggle"

const WC_LOGO_SRC = "/images/brackets/world-cup/af-world-cup-logo.png"

export const dynamic = "force-dynamic"

export default async function WorldCupJoinWithCodePage() {
  // Server-side language resolution mirrors the client provider (cookie
  // af_lang + UserProfile.preferredLanguage) → SSR HTML matches the
  // first client render, no React #425/#418 risk.
  const { language } = await resolveServerRenderPreferences()
  const t = makeWcT(language)

  return (
    // `mode-readable` opts into the globals.css light-mode rescue layer.
    <main className="mode-readable af-world-cup-page min-h-screen bg-[#05070b] text-white">
      <div className="mx-auto max-w-lg px-4 py-10">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
          <Link
            href="/brackets/world-cup"
            className="inline-block rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-bold text-white/60 hover:text-white"
          >
            {t("wc.join.backToHub")}
          </Link>
          <ModeToggle className="rounded-lg border px-3 py-2 text-xs font-bold shadow-sm" />
        </div>

        {/* WC branding lockup */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-300/35 bg-cyan-300/10 p-1">
            <Image
              src={WC_LOGO_SRC}
              alt="AllFantasy World Cup"
              width={40}
              height={40}
              className="h-full w-full object-contain"
              priority
            />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/35">{t("wc.join.brandEyebrow")}</p>
            <h1 className="text-base font-black leading-tight text-white">{t("wc.join.brandTitle")}</h1>
          </div>
        </div>

        <WorldCupInviteJoinPanel title={t("wc.join.panelTitle")} />
      </div>
    </main>
  )
}
