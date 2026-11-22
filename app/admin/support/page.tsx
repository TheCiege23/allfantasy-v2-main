import Link from "next/link"
import { redirect } from "next/navigation"

import { getAdminAccessState } from "@/lib/adminAuth"
import { getStaffThread, listStaffThreads, type SupportThreadView } from "@/lib/support/supportInbox"
import { SUPPORT_STATUS_LABELS, SUPPORT_TOPIC_LABELS, type SupportStatus } from "@/lib/support/supportInboxCore"
import { AdminSupportReply } from "@/components/support/AdminSupportReply"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const metadata = { robots: { index: false, follow: false } }

const FILTERS: Array<{ key: SupportStatus | "all"; label: string }> = [
  { key: "needs_reply", label: "Needs reply" },
  { key: "answered", label: "Answered" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
]

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }) + " ET"
}

/**
 * The support inbox (owner's call 2026-11-15). Every conversation a member started from /help, newest
 * activity first, with what they wrote and the page they were on. Replies go out as AllFantasy Support,
 * to the member's notifications and email. Rules: lib/support/supportInboxCore.ts.
 */
export default async function SupportInboxPage(props: { searchParams?: Promise<{ status?: string; thread?: string }> }) {
  const sp = (await props.searchParams) ?? {}
  const gate = await getAdminAccessState()
  if (gate.status === "unauthenticated") redirect("/admin-login?next=/admin/support")
  if (gate.status === "forbidden") {
    return (
      <main className="min-h-dvh bg-[#020817] p-8 text-white">
        <p className="text-rose-300">Forbidden — admin access required.</p>
      </main>
    )
  }

  const status = FILTERS.some((f) => f.key === sp.status) ? (sp.status as SupportStatus | "all") : "needs_reply"
  let threads: SupportThreadView[] = []
  let open: SupportThreadView | null = null
  let fatal: string | null = null
  try {
    ;[threads, open] = await Promise.all([
      listStaffThreads({ status }),
      typeof sp.thread === "string" && sp.thread ? getStaffThread(sp.thread) : Promise.resolve(null),
    ])
  } catch (err) {
    fatal = err instanceof Error ? err.message : "Could not read the inbox"
  }

  return (
    <main className="min-h-dvh bg-[#020817] text-white">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6" data-testid="admin-support">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <Link href="/admin" className="text-xs text-cyan-300/80">← Admin</Link>
            <h1 className="mt-1 text-2xl font-black">Support inbox</h1>
            <p className="text-sm text-white/60">Messages members send from /help. Your reply reaches them in the app and by email.</p>
          </div>
          <nav className="flex gap-2 text-sm" aria-label="Filter">
            {FILTERS.map((f) => (
              <Link key={f.key} href={`/admin/support?status=${f.key}`}
                className={`rounded-lg border px-3 py-1 ${f.key === status ? "border-cyan-300 text-cyan-200" : "border-white/15 text-white/70"}`}>
                {f.label}
              </Link>
            ))}
          </nav>
        </div>

        {fatal ? <p className="text-rose-300">{fatal}</p> : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <section className="rounded-2xl border border-white/10 bg-white/5" data-testid="admin-support-list">
            {threads.length === 0 ? (
              <p className="p-4 text-sm text-white/60">Nothing here.</p>
            ) : (
              <ul className="divide-y divide-white/10">
                {threads.map((t) => (
                  <li key={t.id}>
                    <Link href={`/admin/support?status=${status}&thread=${encodeURIComponent(t.id)}`}
                      className={`block px-4 py-3 ${open?.id === t.id ? "bg-cyan-400/10" : "hover:bg-white/5"}`}>
                      <div className="flex items-center justify-between gap-2 text-xs text-white/60">
                        <span>{t.member?.name ?? "A member"}</span>
                        <span>{when(t.lastMessageAt)}</span>
                      </div>
                      <div className="mt-1 truncate text-sm font-semibold">{t.title}</div>
                      <div className={`mt-1 text-xs ${t.status === "needs_reply" ? "text-amber-300" : "text-white/50"}`}>
                        {SUPPORT_STATUS_LABELS.en[t.status]}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/5 p-4" data-testid="admin-support-thread">
            {!open ? (
              <p className="text-sm text-white/60">Pick a conversation.</p>
            ) : (
              <>
                <h2 className="text-lg font-bold">{open.title}</h2>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-white/70">
                  <dt>From</dt>
                  <dd>{open.member?.name ?? "A member"}{open.member?.email ? ` · ${open.member.email}` : ""}</dd>
                  {open.topic ? (<><dt>About</dt><dd>{SUPPORT_TOPIC_LABELS.en[open.topic]}</dd></>) : null}
                  {open.pagePath ? (<><dt>Came from</dt><dd className="break-all">{open.pagePath}</dd></>) : null}
                  <dt>Status</dt>
                  <dd>{SUPPORT_STATUS_LABELS.en[open.status]}</dd>
                </dl>
                <ol className="mt-4 space-y-3">
                  {(open.messages ?? []).map((m) =>
                    m.event && m.event !== "opened" ? (
                      <li key={m.id} className="text-center text-xs text-white/50">{m.body} · {when(m.createdAt)}</li>
                    ) : (
                      <li key={m.id} className={m.from === "staff" ? "ml-8" : "mr-8"}>
                        <div className="text-xs text-white/60">
                          <span className={m.from === "staff" ? "text-cyan-300" : "text-white"}>{m.authorName}</span> · {when(m.createdAt)}
                        </div>
                        <div className="mt-1 whitespace-pre-wrap rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm">{m.body}</div>
                      </li>
                    ),
                  )}
                </ol>
                <AdminSupportReply threadId={open.id} status={open.status} />
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  )
}
