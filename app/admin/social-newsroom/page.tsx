import Link from "next/link"
import { redirect } from "next/navigation"

import { getServerSession } from "next-auth"

import { getAdminAccessState } from "@/lib/adminAuth"
import { authOptions } from "@/lib/auth"
import { loadNewsroom, loadTonightsGames } from "@/lib/social-newsroom/loadNewsroom"
import { newsroomXAccount } from "@/lib/social-newsroom/postToX"
import { SUPPORTED_SPORTS } from "@/lib/sport-scope"
import { NewsroomBoard } from "./NewsroomBoard"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

/**
 * Social Newsroom — the last 36 hours of real sports news from trusted outlets across the seven
 * sports, each with copy-and-paste posts for X, Threads, Instagram, Facebook and TikTok, the source
 * credit and link, team logos and player headshots, plus official highlight videos for recent games.
 * Nothing posts on its own. The one write is the "Post to X" button, which posts a single post to the
 * X account connected on the signed-in app account, after the admin confirms. See lib/social-newsroom.
 */
export default async function SocialNewsroomPage(props: { searchParams?: Promise<{ sport?: string }> }) {
  const searchParams = await props.searchParams
  const gate = await getAdminAccessState()
  if (gate.status === "unauthenticated") redirect("/admin-login?next=/admin/social-newsroom")
  if (gate.status === "forbidden") {
    return (
      <main className="min-h-dvh bg-[#020817] p-8 text-white">
        <p className="text-rose-300">Forbidden — admin access required.</p>
      </main>
    )
  }

  const sport = searchParams?.sport?.toUpperCase() ?? null
  const session = (await getServerSession(authOptions as never).catch(() => null)) as { user?: { id?: string | null } } | null
  const [{ stories, highlights }, games, xAccount] = await Promise.all([
    loadNewsroom({ sport }),
    loadTonightsGames({ sport }),
    newsroomXAccount(session?.user?.id ?? null),
  ])

  return (
    <main className="min-h-dvh bg-[#020817] text-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-8 sm:px-6">
        <div>
          <Link href="/admin" className="text-xs text-cyan-300/80">
            ← Admin
          </Link>
          <h1 className="mt-1 text-2xl font-black">Social newsroom</h1>
          <p className="text-sm text-white/60">
            Real stories from trusted outlets, ready to post. Every post credits its source and links the article. Read it
            before you post it.
          </p>
        </div>
        <nav className="flex flex-wrap gap-2 text-sm">
          {[null, ...SUPPORTED_SPORTS].map((s) => {
            const active = (s ?? null) === sport
            return (
              <Link
                key={s ?? "all"}
                href={s ? `/admin/social-newsroom?sport=${s}` : "/admin/social-newsroom"}
                className={`rounded-full border px-3 py-1 font-bold ${
                  active ? "border-cyan-300 bg-cyan-300/15 text-cyan-100" : "border-white/15 text-white/70 hover:border-white/35"
                }`}
              >
                {s ?? "All sports"}
              </Link>
            )
          })}
        </nav>
        <NewsroomBoard stories={stories} highlights={highlights} games={games} xAccount={xAccount} />
      </div>
    </main>
  )
}
