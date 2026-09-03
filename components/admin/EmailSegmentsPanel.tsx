"use client"

import { useMemo, useState } from "react"
import type { AdminEmailAudience, AdminEmailStatus } from "@/lib/admin-dashboard/AdminEmailCenterService"
import { parseManualRecipientInput } from "@/lib/admin-dashboard/parseManualRecipients"

/**
 * 29a — the email segments panel.
 *
 * ⚠ COUNTS ARE LIVE, NOT THE STATIC AUDIENCE DESCRIPTIONS. `status.segments` is
 * computed server-side with the exact same `audienceWhere()` predicate the send
 * path uses (see AdminEmailCenterService.getEmailSegmentCounts) — a number shown
 * here can never disagree with what a broadcast to that audience would reach.
 *
 * ⚠ THIS IS THE COMPOSE TOOL, NOT A LINK TO ONE. Before this, "Email status JSON"
 * was the only control on the page — an operator could see the audience list but
 * had no way to preview, test, or send without hand-crafting a request. Every
 * mutating call still goes through the existing `/api/admin/email/broadcast`
 * route, so the admin gate, the confirm-before-send gate, the 3/hour rate limit,
 * and opt-out exclusion are unchanged — this panel only gives them a UI.
 */

type PreviewSample = { username: string | null; emailMasked: string }

type BroadcastResult = {
  ok: boolean
  mode: "preview" | "test" | "send"
  message: string
  preview: {
    audience: AdminEmailAudience
    recipientCount: number
    cappedAt: number
    sample: PreviewSample[]
    excludedOptOuts: number
    invalidEntries?: number
  }
  sent: number
  failed: number
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US")
}

export function EmailSegmentsPanel({ status }: { status: AdminEmailStatus }) {
  const [audience, setAudience] = useState<AdminEmailAudience>(
    status.segments[0]?.id ?? status.audiences[0]?.id ?? "all"
  )
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [manualInput, setManualInput] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState<"preview" | "test" | "send" | null>(null)
  const [result, setResult] = useState<BroadcastResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const selectedSegment = useMemo(
    () => status.segments.find((s) => s.id === audience) ?? null,
    [status.segments, audience]
  )

  /*
   * ⚠ CLIENT-SIDE COUNT IS FOR FEEDBACK ONLY, NEVER THE SEND DECISION. It uses
   * the same parser the server uses (see the shared module's own header for why
   * that sharing matters), but it cannot see opt-outs or undeliverable domains —
   * only the server, which has the database, can. "Preview recipients" against
   * the real backend is what tells an operator the number that will actually
   * be reached; this is just "how many things did you type" as you type them.
   */
  const manualEntries = useMemo(() => parseManualRecipientInput(manualInput), [manualInput])
  const isManual = audience === "manual"

  const subjectValid = subject.trim().length >= 4
  const bodyValid = body.trim().length >= 10
  const manualListValid = !isManual || manualEntries.length > 0

  const run = async (mode: "preview" | "test" | "send") => {
    if (busy) return
    if (mode !== "preview" && (!subjectValid || !bodyValid)) return
    if (mode === "send" && !confirmed) return
    // Preview and test are allowed through with zero manual entries — preview
    // shows an honest "0 recipients", and test ignores the audience entirely.
    // Only a real send needs someone to actually reach.
    if (mode === "send" && isManual && manualEntries.length === 0) return
    setBusy(mode)
    setError(null)
    try {
      const res = await fetch("/api/admin/email/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          audience,
          subject: subject.trim() || "(preview)",
          body: body.trim() || "(preview — no body yet)",
          confirm: mode === "send" ? confirmed : undefined,
          manualEmails: isManual ? manualEntries : undefined,
        }),
      })
      const parsed = (await res.json().catch(() => null)) as BroadcastResult | { ok: false; error: string } | null
      if (!res.ok || !parsed || !parsed.ok) {
        setError((parsed as { error?: string; message?: string } | null)?.error ?? (parsed as { message?: string } | null)?.message ?? `Request failed (${res.status}).`)
        setResult(null)
        return
      }
      setResult(parsed as BroadcastResult)
      if (mode === "send") setConfirmed(false)
    } catch {
      setError("Network error — the request did not complete.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Live segment counts ──────────────────────────────────────────── */}
      {/*
        29a §5 draws segments as stacked rows — label + description on the
        left, count on the right — rather than a 4-up tile grid. They stay
        <button>s: the handoff's "segment rows open the compose view with that
        segment pre-selected" is behaviour this panel already had, and turning
        them into static rows to match a picture would remove it.
      */}
      <div className="af-cc-stack" style={{ gap: 9 }}>
        {status.segments.map((segment) => (
          <button
            key={segment.id}
            type="button"
            onClick={() => setAudience(segment.id)}
            aria-pressed={audience === segment.id}
            className="af-cc-seg"
            style={
              audience === segment.id
                ? { border: "1px solid var(--accent-line)", background: "var(--accent-soft)", textAlign: "left" }
                : { border: "1px solid transparent", textAlign: "left" }
            }
          >
            <span className="af-cc-stack" style={{ flex: 1 }}>
              <span className="af-cc-job-name">{segment.label}</span>
              <span className="af-cc-job-cadence">{segment.description}</span>
            </span>
            <span
              className={
                audience === segment.id ? "af-cc-seg-count af-cc-seg-count--accent" : "af-cc-seg-count"
              }
            >
              {formatCount(segment.count)}
            </span>
          </button>
        ))}
      </div>

      {/* ── Compose ──────────────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
        <div className="text-[11px] uppercase tracking-[0.14em] text-cyan-100/75">Compose a broadcast</div>
        <p className="mt-1 text-xs text-white/50">
          Preview costs nothing. Test sends one copy to your own admin email. Send reaches every recipient
          in the audience, minus opt-outs, and is rate-limited to 3 broadcasts/hour.
        </p>

        <label className="mt-3 block">
          <span className="mb-1 block text-[11px] text-white/50">Audience</span>
          <select
            value={audience}
            onChange={(e) => {
              setAudience(e.target.value as AdminEmailAudience)
              setResult(null)
            }}
            className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          >
            {status.audiences.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
          {selectedSegment ? (
            <p className="mt-1 text-[11px] text-cyan-100/60">
              {formatCount(selectedSegment.count)} live recipients in this segment.
            </p>
          ) : null}
        </label>

        {isManual ? (
          <label className="mt-3 block">
            <span className="mb-1 block text-[11px] text-white/50">
              Recipients — emails separated by comma, space, or one per line
            </span>
            <textarea
              value={manualInput}
              onChange={(e) => {
                setManualInput(e.target.value)
                setResult(null)
              }}
              rows={3}
              placeholder={"jane@example.com, sam@example.com\nor one per line"}
              className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
            />
            <p className="mt-1 text-[11px] text-cyan-100/60">
              {formatCount(manualEntries.length)} entered — click Preview to see how many are real, deliverable,
              and not opted out.
            </p>
          </label>
        ) : null}

        <label className="mt-3 block">
          <span className="mb-1 block text-[11px] text-white/50">Subject</span>
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={140}
            placeholder="Your bracket isn't finished yet"
            className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          />
        </label>

        <label className="mt-3 block">
          <span className="mb-1 block text-[11px] text-white/50">Body</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={8000}
            rows={5}
            placeholder="Plain text. Kept under 8,000 characters."
            className="w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
          />
        </label>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void run("preview")}
            disabled={busy !== null}
            className="rounded-xl border border-white/10 px-3 py-2 text-xs font-black text-white/80 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "preview" ? "Previewing…" : "Preview recipients"}
          </button>
          <button
            type="button"
            onClick={() => void run("test")}
            disabled={busy !== null || !subjectValid || !bodyValid}
            className="rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-3 py-2 text-xs font-black text-cyan-100 hover:bg-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "test" ? "Sending test…" : "Send test to me"}
          </button>
          <label className="flex items-center gap-2 text-[11px] text-white/60">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="h-4 w-4 rounded border-white/20 bg-black/40"
            />
            Confirm send to the full audience
          </label>
          <button
            type="button"
            onClick={() => void run("send")}
            disabled={busy !== null || !subjectValid || !bodyValid || !confirmed || !manualListValid}
            className="rounded-xl bg-rose-500/30 px-3 py-2 text-xs font-black text-white hover:bg-rose-500/45 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy === "send" ? "Sending…" : "Send broadcast"}
          </button>
        </div>

        {error ? (
          <div role="alert" className="mt-3 rounded-xl border border-rose-300/25 bg-rose-300/[0.07] p-3 text-[13px] text-rose-100">
            {error}
          </div>
        ) : null}

        {result ? (
          <div
            role="status"
            className={`mt-3 rounded-xl border p-3 text-[13px] ${
              result.ok
                ? "border-emerald-300/25 bg-emerald-300/[0.07] text-emerald-100"
                : "border-amber-300/25 bg-amber-300/[0.07] text-amber-100"
            }`}
          >
            <div className="font-black">{result.message}</div>
            {result.mode === "preview" ? (
              <div className="mt-2 text-[12px] leading-5 opacity-90">
                {formatCount(result.preview.recipientCount)} recipients (capped at {formatCount(result.preview.cappedAt)}),
                {" "}
                {formatCount(result.preview.excludedOptOuts)} opt-outs excluded.
                {result.preview.invalidEntries ? (
                  <span> {formatCount(result.preview.invalidEntries)} entries did not look like an email and were dropped.</span>
                ) : null}
                {result.preview.sample.length ? (
                  <span> Sample: {result.preview.sample.map((s) => s.username ?? s.emailMasked).join(", ")}.</span>
                ) : null}
              </div>
            ) : (
              <div className="mt-2 text-[12px] leading-5 opacity-90">
                Sent {formatCount(result.sent)}, failed {formatCount(result.failed)}.
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
