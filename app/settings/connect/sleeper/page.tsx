import Link from "next/link"
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"
import { authOptions } from "@/lib/auth"
import ConnectSleeperForm from "./ConnectSleeperForm"

export default async function ConnectSleeperPage() {
  const session = (await getServerSession(authOptions as never)) as {
    user?: { id?: string }
  } | null

  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/settings/connect/sleeper")
  }

  return (
    <div className="min-h-screen bg-[#07071a] px-4 py-8 text-white">
      <div className="mx-auto max-w-md">
        <Link
          href="/settings"
          className="mb-6 inline-block text-sm text-cyan-400/90 hover:text-cyan-300"
        >
          ← Back to settings
        </Link>
        <h1 className="text-xl font-bold">Connect Sleeper</h1>
        <p className="mt-3 text-sm leading-relaxed text-white/55">
          Enter your Sleeper username and we&apos;ll link it to your AllFantasy account — that link
          is what lets imports and league sync find your teams.
        </p>
        {/*
          ⚠ This page used to say "link your account by importing a league" —
          while the import gate itself REQUIRED the link. The form below breaks
          that circle: it validates the handle against Sleeper and stamps the
          profile in one step.
        */}
        <ConnectSleeperForm />
      </div>
    </div>
  )
}
