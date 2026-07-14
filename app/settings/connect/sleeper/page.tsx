import Link from "next/link"
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"

export default async function ConnectSleeperPage() {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string }
  } | null

  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/settings/connect/sleeper")
  }

  return (
    <div className="min-h-screen bg-app px-4 py-8 text-primary">
      <div className="mx-auto max-w-md">
        <Link
          href="/settings"
          className="mb-6 inline-block text-sm text-cyan-400/90 hover:text-cyan-300"
        >
          Back to settings
        </Link>
        <h1 className="text-xl font-bold">Connect Sleeper</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">
          Link your Sleeper account by importing a league from the dashboard. Your Sleeper username
          is saved when leagues sync.
        </p>
        <Link
          href="/dashboard"
          className="mt-6 inline-flex rounded-xl bg-cyan-500/20 px-4 py-2.5 text-sm font-semibold text-cyan-300 hover:bg-cyan-500/30"
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  )
}
