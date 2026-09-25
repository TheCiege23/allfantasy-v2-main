import { redirect } from "next/navigation"
import { getAdminAccessState } from "@/lib/adminAuth"
import ChatPhotoMigrationClient from "./ChatPhotoMigrationClient"

export const dynamic = "force-dynamic"

// Admin surfaces must never be indexed (defense-in-depth beyond robots.txt Disallow: /admin).
export const metadata = { robots: { index: false, follow: false } }

/**
 * Admin — move chat photos out of PUBLIC Blob storage.
 *
 * ITS OWN PAGE, following `league-recovery`: every panel on the /admin dashboard is read-only
 * and global, and this one deletes storage objects irreversibly. A deliberate tool gets its own
 * route and its own warning header rather than an accordion one stray click from a metrics tile.
 *
 * ⚠ THE GATE HERE IS NOT THE SECURITY BOUNDARY — `requireAdmin` in
 * `app/api/admin/chat/migrate-public-photos/route.ts` is. This redirect only stops a non-admin
 * browser rendering the screen.
 */
export default async function ChatPhotoMigrationPage() {
  const state = await getAdminAccessState()
  if (state.status !== "admin") {
    redirect("/admin")
  }

  return (
    <main className="min-h-dvh bg-[#020817] px-4 py-8 text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(34,211,238,0.20),transparent_34%),radial-gradient(circle_at_85%_8%,rgba(244,63,94,0.14),transparent_30%),linear-gradient(180deg,#020817_0%,#06111f_48%,#020817_100%)]" />
      <div className="relative mx-auto max-w-4xl">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-rose-200">Operator tooling · moves and deletes stored photos</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-white sm:text-4xl">Chat photo migration</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/62">
          Chat photos uploaded before the private-storage fix were saved to a PUBLIC store, where anyone
          with the link could open them. This moves them into private chat storage, where only members of
          that chat can see them, and then removes the public copies.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-amber-100/75">
          Run the dry run first and read it. Apply and delete are written to the admin audit log with counts
          only; the report never shows links, user ids or credentials.
        </p>

        <ChatPhotoMigrationClient />
      </div>
    </main>
  )
}
