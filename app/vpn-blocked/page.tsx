import type { Metadata } from "next"
import Link from "next/link"

import { isSafeInternalPath } from "@/lib/auth/auth-intent-resolver"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Turn off your VPN — AllFantasy.ai",
  // Crawlers are waved through the VPN gate, so they never land here — but a
  // stray link must not put a block page in search results either.
  robots: { index: false, follow: false },
}

/**
 * Where middleware.ts sends a VPN, proxy, Tor or iCloud Private Relay visitor
 * who asks for anything but a public page. See the VPN gate there.
 *
 * ⚠ `from` is echoed into a link, so it must stay on this site — the repo's one
 * open-redirect rule, `isSafeInternalPath`, decides that, not a copy of it here.
 */
function safeReturnPath(raw: unknown): string {
  if (!isSafeInternalPath(raw)) return "/"
  const path = raw.trim()
  return path.startsWith("/vpn-blocked") ? "/" : path
}

export default async function VpnBlockedPage({
  searchParams,
}: {
  searchParams?: Promise<{ from?: string }> | { from?: string }
}) {
  const sp = searchParams instanceof Promise ? await searchParams : searchParams ?? {}
  const retry = safeReturnPath(sp.from)

  return (
    <main className="min-h-screen bg-gradient-to-b from-neutral-950 via-slate-950 to-neutral-950 px-4 py-12 text-white sm:px-6">
      <div className="mx-auto max-w-xl text-center">
        <img src="/af-crest.png" alt="" className="mx-auto mb-6 h-16 w-16 object-contain opacity-90" />
        <h1 className="mb-2 text-2xl font-black sm:text-3xl">Turn off your VPN to use AllFantasy.ai</h1>
        <p className="mb-6 text-sm leading-7 text-white/70">
          Fantasy sports laws differ from state to state, so we have to confirm which state you&apos;re in before you
          sign in, sign up or use the app. A VPN, proxy, Tor or iCloud Private Relay hides your location, so we
          can&apos;t let you in while one is on.
        </p>

        <div className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left text-sm leading-7 text-white/75">
          <p className="mb-3 font-semibold text-white">How to fix it</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <span className="font-semibold text-white">VPN app:</span> disconnect it, then tap Try again.
            </li>
            <li>
              <span className="font-semibold text-white">iCloud Private Relay (Safari on iPhone or iPad):</span> tap the{" "}
              <span className="font-semibold">aA</span> button in the address bar and choose{" "}
              <span className="font-semibold">Show IP Address</span>. Or turn it off in Settings → your name → iCloud →
              Private Relay.
            </li>
            <li>
              <span className="font-semibold text-white">iCloud Private Relay (Safari on Mac):</span> choose View →
              Reload and Show IP Address.
            </li>
            <li>
              <span className="font-semibold text-white">Cloudflare WARP / 1.1.1.1 app:</span> switch it off.
            </li>
            <li>
              <span className="font-semibold text-white">Tor Browser:</span> open the site in a regular browser.
            </li>
            <li>
              <span className="font-semibold text-white">Work or school network:</span> it may route you through a proxy.
              Try mobile data instead.
            </li>
          </ul>
        </div>

        <div className="mb-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href={retry}
            className="inline-flex rounded-xl bg-cyan-500/90 px-5 py-2.5 text-sm font-semibold text-slate-950"
          >
            I turned it off — try again
          </a>
          <a href="mailto:support@allfantasy.ai" className="text-sm text-cyan-400 hover:text-cyan-300">
            Contact Support
          </a>
        </div>

        <p className="mb-6 text-xs leading-6 text-white/55">
          Need to cancel or manage a subscription? You can do that without turning your VPN off:{" "}
          <a href="/api/subscription/billing-portal" className="text-cyan-400 hover:text-cyan-300">
            open the billing portal
          </a>{" "}
          (works if you&apos;re already signed in).
        </p>

        <p className="text-xs leading-6 text-white/45">
          Not using a VPN? Some home and mobile networks are misidentified. Email{" "}
          <a href="mailto:support@allfantasy.ai" className="text-cyan-400 hover:text-cyan-300">
            support@allfantasy.ai
          </a>{" "}
          and we&apos;ll look into it. ·{" "}
          <Link href="/terms" className="text-cyan-400 hover:text-cyan-300">
            Terms
          </Link>{" "}
          ·{" "}
          <Link href="/privacy" className="text-cyan-400 hover:text-cyan-300">
            Privacy
          </Link>
        </p>
      </div>
    </main>
  )
}
