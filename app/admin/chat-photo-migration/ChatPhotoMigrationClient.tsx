"use client"

import { useCallback, useState } from "react"

type Mode = "dry-run" | "apply" | "delete-public"
type Report = Record<string, unknown> & { ok?: boolean; mode?: Mode; error?: string; hasMore?: boolean; nextCursor?: string | null }

const ENDPOINT = "/api/admin/chat/migrate-public-photos"

const CARD = "rounded-3xl border border-white/10 bg-black/45 p-6 shadow-[0_28px_90px_-54px_rgba(34,211,238,0.5)] backdrop-blur-xl"
const DANGER_CARD = "rounded-3xl border border-rose-300/25 bg-black/45 p-6 shadow-[0_28px_90px_-54px_rgba(244,63,94,0.6)] backdrop-blur-xl"
const BTN = "min-h-12 rounded-2xl bg-cyan-300 px-5 text-sm font-black text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
const BTN_SOFT = "min-h-12 rounded-2xl border border-white/15 bg-white/[0.06] px-5 text-sm font-black text-white transition hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-50"
const BTN_DANGER = "min-h-12 rounded-2xl bg-rose-400 px-5 text-sm font-black text-slate-950 transition hover:bg-rose-300 disabled:cursor-not-allowed disabled:opacity-50"

const MODE_LABEL: Record<Mode, string> = {
  "dry-run": "Dry run",
  apply: "Apply",
  "delete-public": "Delete public copies",
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

/** `{ a: 1, b: 0 }` → rows, dropping zeros so the eye lands on what actually happened. */
function CountTable({ title, counts, keepZero = false }: { title: string; counts: unknown; keepZero?: boolean }) {
  if (!isRecord(counts)) return null
  const rows = Object.entries(counts).filter(([, v]) => typeof v === "number" && (keepZero || v !== 0))
  if (rows.length === 0) return null
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <p className="text-[11px] font-black uppercase tracking-[0.16em] text-white/50">{title}</p>
      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="truncate font-mono text-white/65">{k}</dt>
            <dd className="text-right font-black text-white">{String(v)}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

function ItemList({ title, items }: { title: string; items: unknown }) {
  if (!Array.isArray(items) || items.length === 0) return null
  return (
    <details className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs text-white/60">
      <summary className="cursor-pointer font-black text-white/80">
        {title} ({items.length})
      </summary>
      <ul className="mt-3 space-y-1 font-mono text-[11px] leading-5 text-cyan-100/80">
        {items.map((item, i) => {
          const r = isRecord(item) ? item : {}
          const where = r.table ? `${r.table}#${r.rowId} ${r.field}${r.jsonPath ? `.${r.jsonPath}` : ""}` : `${r.prefix ?? ""}${r.blobId ?? ""}`
          const what = [r.status ?? r.action, r.verdict, r.reason, r.privateCopy, r.errorKind].filter(Boolean).join(" · ")
          return (
            <li key={i} className="break-words">
              {where} → {what}
              {r.targetPath ? <span className="text-white/45"> ({String(r.targetPath)})</span> : null}
            </li>
          )
        })}
      </ul>
    </details>
  )
}

function Summary({ report }: { report: Report }) {
  if (!report.ok) {
    return (
      <p className="rounded-2xl border border-rose-300/25 bg-rose-300/[0.08] px-4 py-3 text-sm font-black text-rose-100">
        {MODE_LABEL[report.mode ?? "dry-run"]} refused: {report.error ?? "unknown error"}
      </p>
    )
  }
  const refs = isRecord(report.references) ? report.references : null
  const blobs = isRecord(report.blobs) ? report.blobs : null
  return (
    <div className="space-y-3">
      {isRecord(report.storage) ? (
        <p className="text-xs text-white/60">
          Public store: <span className="font-black text-white">{String(report.storage.publicStore)}</span>
          {" · "}Private store: <span className="font-black text-white">{String(report.storage.privateStore)}</span>
        </p>
      ) : null}
      {refs ? (
        <>
          <CountTable title="DB references to public URLs" counts={{ total: refs.total, rows: refs.rows, wouldMove: refs.wouldMove }} keepZero />
          <CountTable title="References by table.field" counts={refs.byTableField} />
          <CountTable title="References by status" counts={refs.byStatus} />
          <CountTable title="Skipped / would fail — reasons" counts={refs.byReason} />
          {refs.complete === false ? <p className="text-xs font-bold text-amber-100">Reference census stopped early — numbers are partial.</p> : null}
          <ItemList title="Reference items" items={refs.items} />
        </>
      ) : null}
      {blobs ? (
        <>
          <CountTable title="Public blobs in this batch" counts={{ listed: blobs.listed, wouldDelete: blobs.wouldDelete }} keepZero />
          {isRecord(blobs.byPrefix)
            ? Object.entries(blobs.byPrefix).map(([prefix, c]) => <CountTable key={prefix} title={`Prefix ${prefix}`} counts={c} keepZero />)
            : null}
          <CountTable title="Blob verdicts" counts={blobs.byVerdict} />
          <ItemList title="Blob items" items={blobs.items} />
        </>
      ) : null}
      <CountTable title="Counts" counts={report.counts} keepZero />
      <CountTable title="Skipped — reasons" counts={report.skippedByReason} />
      <CountTable title="Failed — reasons" counts={report.failedByReason} />
      <CountTable title="Kept — reasons" counts={report.keptByReason} />
      <ItemList title="Moved" items={report.moved} />
      <ItemList title="Skipped" items={report.skipped} />
      <ItemList title="Failed" items={report.failed} />
      {report.mode === "delete-public" ? <ItemList title="Blobs" items={report.items} /> : null}
      <details className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-xs text-white/55">
        <summary className="cursor-pointer font-black text-white/80">Raw response</summary>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-cyan-100/80">{JSON.stringify(report, null, 2)}</pre>
      </details>
    </div>
  )
}

export default function ChatPhotoMigrationClient() {
  const [busy, setBusy] = useState<Mode | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  /** Set while the delete confirmation is showing; carries the cursor to continue from, if any. */
  const [confirmDelete, setConfirmDelete] = useState<{ cursor: string | null } | null>(null)

  const run = useCallback(async (mode: Mode, cursor: string | null = null) => {
    setBusy(mode)
    setRequestError(null)
    setConfirmDelete(null)
    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(cursor ? { mode, cursor } : { mode }),
        cache: "no-store",
      })
      const body = (await res.json().catch(() => null)) as Report | null
      if (!body) {
        setReport(null)
        setRequestError(`${MODE_LABEL[mode]} failed (HTTP ${res.status}).`)
        return
      }
      setReport({ ...body, mode: body.mode ?? mode })
    } catch {
      setReport(null)
      setRequestError(`${MODE_LABEL[mode]} failed — request error.`)
    } finally {
      setBusy(null)
    }
  }, [])

  const canContinue = Boolean(report?.ok && report.hasMore && report.nextCursor && report.mode)

  return (
    <div className="mt-8 space-y-5">
      <section className={CARD}>
        <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan-100/80">Move public chat photos to private storage</h2>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs leading-5 text-white/60">
          <li><span className="font-black text-white">Dry run</span> — counts every message still pointing at a public photo, and every public copy, and changes nothing.</li>
          <li><span className="font-black text-white">Apply</span> — copies each referenced photo into private chat storage and points the message at the private copy. Deletes nothing; safe to re-run.</li>
          <li><span className="font-black text-white">Delete public copies</span> — removes a public copy only once nothing points at it and its private copy is confirmed, or when nothing ever pointed at it.</li>
        </ol>
        <div className="mt-5 flex flex-wrap gap-3">
          <button type="button" className={BTN} disabled={busy !== null} onClick={() => void run("dry-run")}>
            {busy === "dry-run" ? "Running…" : "Dry run"}
          </button>
          <button type="button" className={BTN_SOFT} disabled={busy !== null} onClick={() => void run("apply")}>
            {busy === "apply" ? "Applying…" : "Apply"}
          </button>
          <button type="button" className={BTN_DANGER} disabled={busy !== null} onClick={() => setConfirmDelete({ cursor: null })}>
            {busy === "delete-public" ? "Deleting…" : "Delete public copies"}
          </button>
        </div>
      </section>

      {confirmDelete ? (
        <section className={DANGER_CARD} role="alertdialog" aria-label="Confirm deleting public copies">
          <h2 className="text-sm font-black uppercase tracking-[0.18em] text-rose-100">Delete the public copies?</h2>
          <p className="mt-3 text-sm leading-6 text-white/80">
            Links to these photos that were shared <span className="font-black text-white">outside AllFantasy will stop working</span>.
            Members still see them in chat through the private copies. This cannot be undone.
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className={BTN_DANGER} disabled={busy !== null} onClick={() => void run("delete-public", confirmDelete.cursor)}>
              Yes, delete public copies
            </button>
            <button type="button" className={BTN_SOFT} onClick={() => setConfirmDelete(null)}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}

      {requestError ? (
        <p className="rounded-2xl border border-rose-300/25 bg-rose-300/[0.08] px-4 py-3 text-sm font-bold text-rose-100">{requestError}</p>
      ) : null}

      {report ? (
        <section className={CARD}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan-100/80">
              Result — {MODE_LABEL[report.mode ?? "dry-run"]}
            </h2>
            {canContinue ? (
              <button
                type="button"
                className={report.mode === "delete-public" ? BTN_DANGER : BTN_SOFT}
                disabled={busy !== null}
                onClick={() =>
                  report.mode === "delete-public"
                    ? setConfirmDelete({ cursor: report.nextCursor ?? null })
                    : void run(report.mode as Mode, report.nextCursor ?? null)
                }
              >
                Continue with the next batch
              </button>
            ) : null}
          </div>
          <div className="mt-4">
            <Summary report={report} />
          </div>
        </section>
      ) : null}
    </div>
  )
}
