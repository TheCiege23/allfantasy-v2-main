import Link from "next/link"

export const dynamic = "force-dynamic"

export default async function GeoBlockedPage({
  searchParams,
}: {
  searchParams?:
    | Promise<{ state?: string; vpn?: string; reason?: string }>
    | { state?: string; vpn?: string; reason?: string }
}) {
  const sp = searchParams instanceof Promise ? await searchParams : searchParams ?? {}
  const state = typeof sp.state === "string" ? sp.state.toUpperCase() : "WA"
  const showVpn = sp.vpn === "1"
  // Set by middleware.ts for an account-level lock (lib/geo/accountGeoLock): the
  // visitor may be anywhere, so the page must say the lock follows the ACCOUNT.
  const accountLocked = sp.reason === "account"

  return (
    <main className="min-h-screen bg-gradient-to-b from-neutral-950 via-slate-950 to-neutral-950 px-4 py-12 text-white sm:px-6">
      <div className="mx-auto max-w-xl text-center">
        <img src="/af-crest.png" alt="" className="mx-auto mb-6 h-16 w-16 object-contain opacity-90" />
        <h1 className="mb-2 text-2xl font-black sm:text-3xl">🚫 AllFantasy.ai Is Not Available in Washington State</h1>
        <p className="mb-6 text-sm leading-7 text-white/70">
          We&apos;re sorry, but Washington state law (RCW 9.46.240) prohibits fantasy sports services, including free play,
          regardless of whether a fee is charged.
        </p>
        <p className="mb-8 text-sm leading-7 text-white/70">
          We comply with all applicable state laws and therefore cannot provide access to AllFantasy.ai from Washington.
        </p>

        <div className="mb-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5 text-left text-sm leading-7 text-white/75">
          <p className="mb-3 font-semibold text-white">This applies to residents of:</p>
          <p className="mb-2">
            <span className="rounded border border-red-500/40 bg-red-500/15 px-2 py-0.5 text-xs font-bold text-red-300">
              🔴 Washington (WA)
            </span>{" "}
            — Full restriction (no account creation or access)
          </p>
          <p className="mt-4 text-xs text-white/55">
            These states allow free accounts but restrict paid leagues: Hawaii · Idaho · Montana · Nevada (users there may view our
            paid-restriction page for reference).
          </p>
        </div>

        {accountLocked ? (
          <div className="mb-8 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-left text-sm text-red-100">
            <p className="font-semibold">This account is locked</p>
            <p className="mt-2 text-red-100/90">
              Your account has been used from Washington, or paid with a card billed to a Washington address, so it stays
              locked wherever you sign in from. Any such payment was refunded in full. If you don&apos;t live in Washington
              (for example, you were only visiting), email{" "}
              <a href="mailto:support@allfantasy.ai" className="underline">
                support@allfantasy.ai
              </a>{" "}
              from your account&apos;s email address and we&apos;ll review it.
            </p>
          </div>
        ) : null}

        {showVpn ? (
          <div className="mb-8 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-left text-sm text-amber-100">
            <p className="font-semibold">⚠️ VPN or Proxy Detected</p>
            <p className="mt-2 text-amber-100/90">
              We detected that you may be using a VPN or proxy service. Please disable it and try again. Using a VPN to access
              services restricted in your state may violate our Terms of Service and applicable state law.
            </p>
          </div>
        ) : null}

        <p className="mb-6 text-xs leading-6 text-white/50">
          <strong className="text-white/70">Legal disclaimer:</strong> This restriction is based on our legal review of applicable
          state laws. We are not providing legal advice. If you believe you have reached this page in error, please contact{" "}
          <a href="mailto:support@allfantasy.ai" className="text-cyan-400 hover:text-cyan-300">
            support@allfantasy.ai
          </a>
          .
        </p>

        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href="mailto:support@allfantasy.ai"
            className="inline-flex rounded-xl bg-cyan-500/90 px-5 py-2.5 text-sm font-semibold text-slate-950"
          >
            Contact Support
          </a>
          <Link href="/terms" className="text-sm text-cyan-400 hover:text-cyan-300">
            View Terms of Service
          </Link>
          <Link href="/privacy" className="text-sm text-cyan-400 hover:text-cyan-300">
            Privacy Policy
          </Link>
        </div>

        <p className="mt-8 text-xs text-white/45">
          If you are a resident of another state who has been incorrectly blocked, your IP address may be misidentified. Please
          contact support and include your location (state: {state}).
        </p>
      </div>
    </main>
  )
}
