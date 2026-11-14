import Link from "next/link"
import { redirect } from "next/navigation"
import { getAdminAccessState } from "@/lib/adminAuth"
import { prisma } from "@/lib/prisma"
import { LS_BOT_ADDRESS } from "@/lib/leaguesafe/inbound-security"

export const dynamic = "force-dynamic"
export const revalidate = 0
export const metadata = { title: "LeagueSafe raw email capture", robots: { index: false, follow: false } }

const STATUSES = ["captured", "parsed", "unparseable", "rejected"] as const
type Status = typeof STATUSES[number]
const PAGE_SIZE = 25

export default async function LeagueSafeRawPage({ searchParams }: {
  searchParams: { status?: string; after?: string; id?: string }
}) {
  // Gate BEFORE either database read. Render MIME as escaped text, never HTML.
  const access = await getAdminAccessState()
  if (access.status !== "admin") redirect("/admin")
  const status = STATUSES.includes(searchParams.status as Status) ? searchParams.status as Status : undefined
  const after = typeof searchParams.after === "string" && searchParams.after.length <= 128 ? searchParams.after : undefined
  const id = typeof searchParams.id === "string" && searchParams.id.length <= 128 ? searchParams.id : undefined
  const query = (values: { status?: string; after?: string; id?: string }) => {
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(values)) if (value) params.set(key, value)
    return "/admin/leaguesafe/raw" + (params.size ? "?" + params.toString() : "")
  }

  let rows
  let selected
  try {
    rows = await prisma.leagueSafeRawEmail.findMany({
      where: status ? { processingStatus: status } : {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      select: { id: true, messageId: true, receivedAt: true, from: true, to: true, subject: true, processingStatus: true },
    })
    selected = id ? await prisma.leagueSafeRawEmail.findUnique({ where: { id } }) : null
  } catch {
    console.error("[leaguesafe] admin_read_failed")
    return (
      <main className="mx-auto max-w-4xl p-6 text-white">
        <h1 className="text-2xl font-bold">LeagueSafe capture unavailable</h1>
        <p className="mt-4">Check the database connection and apply the Phase 0 migration, then reload.</p>
        <Link className="mt-4 inline-block underline" href="/admin">Back to admin</Link>
      </main>
    )
  }
  const hasMore = rows.length > PAGE_SIZE
  const visible = rows.slice(0, PAGE_SIZE)

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-6">
        <Link href="/admin" className="text-cyan-300 underline">Back to admin</Link>
        <h1 className="text-3xl font-bold">LeagueSafe email capture</h1>
        <p>Inbox: {LS_BOT_ADDRESS}. Select an email to inspect its original headers and MIME content.</p>
        <nav aria-label="Filter email status" className="flex flex-wrap gap-4">
          <Link aria-current={!status ? "page" : undefined} className="underline" href={query({})}>All emails</Link>
          {STATUSES.map((value) => (
            <Link key={value} aria-current={status === value ? "page" : undefined}
              className="capitalize underline" href={query({ status: value })}>{value}</Link>
          ))}
          <Link className="text-cyan-300 underline" href={query({ status, after, id })}>Refresh</Link>
        </nav>
        {visible.length === 0 ? <p>No emails captured for this view.</p> : (
          <div className="overflow-x-auto rounded-xl border border-slate-700">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Captured LeagueSafe emails</caption>
              <thead><tr className="bg-slate-900">
                {["Received (UTC)", "From", "To", "Subject", "Status"].map((label) => <th scope="col" key={label} className="p-3">{label}</th>)}
              </tr></thead>
              <tbody>{visible.map((row) => (
                <tr key={row.id} className="border-t border-slate-700">
                  <td className="whitespace-nowrap p-3"><time dateTime={row.receivedAt.toISOString()}>{row.receivedAt.toISOString()}</time></td>
                  <td className="max-w-xs break-words p-3">{row.from || "(missing)"}</td>
                  <td className="max-w-xs break-words p-3">{row.to || "(missing)"}</td>
                  <td className="max-w-sm break-words p-3">
                    <Link className="text-cyan-300 underline" href={query({ status, after, id: row.id })}>{row.subject || "(no subject)"}</Link>
                  </td>
                  <td className="p-3">{row.processingStatus}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <nav aria-label="Email pagination" className="flex gap-4">
          {after && <Link className="underline" href={query({ status })}>Newest emails</Link>}
          {hasMore && <Link className="underline" href={query({ status, after: visible[visible.length - 1].id })}>Older emails</Link>}
        </nav>
        {id && !selected && <p role="status">Email not found.</p>}
        {selected && (
          <section aria-label="Selected raw email" className="space-y-4 rounded-xl border border-slate-700 p-4">
            <h2 className="break-words text-xl font-semibold">{selected.subject || "(no subject)"}</h2>
            <dl className="grid gap-2 break-words text-sm">
              <div><dt className="inline font-bold">Gmail message ID: </dt><dd className="inline">{selected.messageId}</dd></div>
              <div><dt className="inline font-bold">RFC Message-ID: </dt><dd className="inline">{selected.rfcMessageId || "(missing)"}</dd></div>
              <div><dt className="inline font-bold">Status: </dt><dd className="inline">{selected.processingStatus}</dd></div>
              <div><dt className="inline font-bold">Rejection reason: </dt><dd className="inline">{selected.rejectionReason || "None"}</dd></div>
              <div><dt className="inline font-bold">Received (UTC): </dt><dd className="inline">{selected.receivedAt.toISOString()}</dd></div>
            </dl>
            <h3 className="font-semibold">Delivery authentication</h3>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded bg-black p-3 text-xs">{JSON.stringify(selected.authResults, null, 2)}</pre>
            <h3 className="font-semibold">Original RFC822 / MIME message</h3>
            <pre className="max-h-[40rem] overflow-auto whitespace-pre-wrap break-all rounded bg-black p-3 text-xs">{selected.rawBody}</pre>
          </section>
        )}
      </div>
    </main>
  )
}
