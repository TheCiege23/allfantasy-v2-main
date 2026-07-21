/**
 * Neutral access-denied screen for the Operator Command Center.
 *
 * Deliberately reveals nothing: no admin emails, no route list, no config, no
 * hint about who is/ isn't an operator. Just a crest and a generic message.
 */
import Link from "next/link"

export function OperatorAccessDenied() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#0a0e1a] px-4 text-white">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[#0c1120] p-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/af-crest.png"
          alt="AllFantasy"
          width={48}
          height={48}
          className="mx-auto h-12 w-12 rounded-lg border border-white/10 object-cover"
        />
        <h1 className="mt-5 text-lg font-black tracking-tight text-white">Access denied</h1>
        <p className="mt-2 text-sm leading-6 text-slate-400">
          This area is restricted to authorized operators. If you believe you should have access, contact your
          administrator.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex h-10 items-center justify-center rounded-lg border border-white/12 bg-white/[0.04] px-4 text-sm font-bold text-white hover:bg-white/[0.08]"
        >
          Back to app
        </Link>
      </div>
    </main>
  )
}
