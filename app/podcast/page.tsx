import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import PodcastListClient from "./PodcastListClient"

export const dynamic = "force-dynamic"

export default async function PodcastPage() {
  const session = (await getServerSession(authOptions as any)) as {
    user?: { id?: string }
  } | null

  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/podcast")
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-950 to-gray-900">
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-center gap-3">
          <Link
            href="/core"
            className="text-sm text-white/60 hover:text-white/80 transition"
            data-testid="podcast-dashboard-back-button"
            data-audit="back-button"
          >
            ← Dashboard
          </Link>
          <Link
            href="/fantasy-media"
            className="text-sm text-white/60 hover:text-white/80 transition"
            data-testid="podcast-video-link-button"
          >
            Video
          </Link>
        </div>
        <h1 className="text-2xl font-bold text-white">Fantasy podcast</h1>
        <p className="mt-1 text-sm text-white/60">
          AI-generated weekly recaps: league recap, waiver targets, performance summaries.
        </p>
        <PodcastListClient />
      </div>
    </div>
  )
}
