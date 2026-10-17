import type { Metadata } from "next"
import Link from "next/link"

import { isSafeInternalPath } from "@/lib/auth/auth-intent-resolver"
import { VpnRetryPanel } from "./VpnRetryPanel"
import { PAID_RELAY_COPY, vpnKindCopy } from "./vpnKindCopy"

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

export default async function VpnBlockedPage(
  props: {
    searchParams?: Promise<| Promise<{ from?: string; why?: string; scope?: string }>
    | { from?: string; why?: string; scope?: string }>
  }
) {
  const searchParams = await props.searchParams
  const sp = searchParams instanceof Promise ? await searchParams : searchParams ?? {}
  const retry = safeReturnPath(sp.from)
  // `why` is set by the middleware from the verdict that sent the person here.
  // Anything unrecognised falls back to the general page, never to an error.
  // `scope=paid`: a Private Relay user who may use the free product but not paid
  // features. Only meaningful with why=privacy_relay; ignored otherwise.
  const paidOnly = sp.scope === "paid" && sp.why === "privacy_relay"
  const detected = paidOnly ? PAID_RELAY_COPY : vpnKindCopy(sp.why)

  return (
    <main className="min-h-screen bg-gradient-to-b from-neutral-950 via-slate-950 to-neutral-950 px-4 py-12 text-white sm:px-6">
      <div className="mx-auto max-w-xl text-center">
        <img src="/af-crest.svg" alt="" className="mx-auto mb-6 h-16 w-16 object-contain opacity-90" />
        <h1 className="mb-2 text-2xl font-black sm:text-3xl">
          {detected?.title ?? "Turn off your VPN to use AllFantasy.ai"}
        </h1>
        {paidOnly ? (
          <p className="mb-6 text-sm leading-7 text-white/70">
            Everything free on AllFantasy.ai still works with Private Relay on —{" "}
            <Link href="/" className="text-cyan-400 hover:text-cyan-300">
              go back to the app
            </Link>
            .
          </p>
        ) : null}
        <p className="mb-6 text-sm leading-7 text-white/70">
          Fantasy sports laws differ from state to state, so we have to confirm which state you&apos;re in before you
          sign in, sign up or use the app. A VPN, proxy, Tor or iCloud Private Relay hides your location, so we
          can&apos;t let you in while one is on.
        </p>

        {detected ? (
          <div className="mb-6 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-5 text-left text-sm leading-7 text-amber-100">
            <p className="mb-1 font-semibold text-amber-50">We can see {detected.detected} on this connection</p>
            <p className="mb-3">{detected.lead}</p>
            <ul className="list-disc space-y-2 pl-5">
              {detected.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* Straight after the specific steps when we know what is on; after the general list when we do not. */}
        {detected ? <VpnRetryPanel href={retry} paidScope={paidOnly} /> : null}

        <div className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left text-sm leading-7 text-white/75">
          <p className="mb-3 font-semibold text-white">{detected ? "Other things that can cause this" : "How to fix it"}</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <span className="font-semibold text-white">VPN app:</span> disconnect it, then tap Try again. Some apps
              reconnect on their own — on iPhone, check Settings → VPN says Not Connected.
            </li>
            <li>
              <span className="font-semibold text-white">iCloud Private Relay (Safari on iPhone or iPad):</span> tap the
              page menu at the left of the address bar (<span className="font-semibold">aA</span> on older iPhones) and
              choose{" "}
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

        {detected ? null : <VpnRetryPanel href={retry} paidScope={paidOnly} />}

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
