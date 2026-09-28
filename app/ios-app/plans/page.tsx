import Link from "next/link"

export const metadata = { title: "Plans · AllFantasy" }

/*
 * Where every purchase page lands inside the iOS app (lib/platform/iosApp).
 *
 * ⚠ THE COPY MUST NOT POINT ANYWHERE TO BUY. Outside the US storefront, App
 * Store guideline 3.1.1 forbids steering an app user to an external purchase —
 * a "subscribe on our website" line here is itself grounds for rejection. Say
 * what is true in the app and stop.
 */
export default function IosAppPlansPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-neutral-950 via-slate-950 to-neutral-950 px-4 py-12 text-white sm:px-6">
      <div className="mx-auto max-w-xl text-center">
        <img src="/af-crest.png" alt="" className="mx-auto mb-6 h-16 w-16 object-contain opacity-90" />
        <h1 className="mb-3 text-2xl font-black sm:text-3xl">Purchases aren&apos;t available in the app</h1>
        <p className="mb-8 text-sm leading-7 text-white/70">
          Everything your account already includes works here, and every free feature is open to you.
        </p>
        <Link href="/core" className="inline-flex rounded-xl bg-cyan-500/90 px-6 py-3 text-sm font-semibold text-slate-950">
          Back to your leagues
        </Link>
        <div className="mt-8 flex flex-wrap justify-center gap-4 text-sm">
          <a href="mailto:support@allfantasy.ai" className="text-cyan-400 hover:text-cyan-300">
            Contact Support
          </a>
          <Link href="/terms" className="text-cyan-400 hover:text-cyan-300">
            Terms of Service
          </Link>
        </div>
      </div>
    </main>
  )
}
