'use client'

import { devyStr } from './devyConfigDisplay'

export function DevyFormatPanel({ config }: { config: Record<string, unknown> | null }) {
  return (
    <div className="space-y-5 px-4 py-5 text-[13px] text-white/85 md:px-6">
      <p className="text-[11px] text-sky-200/70">
        Read-only: these values come from this league&apos;s older Devy record. A Devy league made on AllFantasy is
        edited under Devy Settings.
      </p>
      <section className="rounded-xl border border-white/[0.08] bg-[#0a1228] p-4">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-white/90">Dynasty mode</h3>
        <p className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[12px] text-emerald-100/90">
          Always on (locked) — Devy leagues are dynasty-only.
        </p>
      </section>
      <section className="rounded-xl border border-white/[0.08] bg-[#0a1228] p-4">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-white/90">Startup draft</h3>
        <p className="mt-2 text-white/70">
          Current: <span className="font-semibold text-white">{devyStr(config, 'startupDraftFormat')}</span>
        </p>
        <p className="mt-1 text-[11px] text-white/45">Combined / Split vets first / Split devy first</p>
      </section>
      <section className="rounded-xl border border-white/[0.08] bg-[#0a1228] p-4">
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-white/90">Future draft</h3>
        <p className="mt-2 text-white/70">
          Current: <span className="font-semibold text-white">{devyStr(config, 'futureDraftFormat')}</span>
        </p>
        <p className="mt-2 text-[11px] text-amber-200/70">These settings lock after the startup draft begins.</p>
      </section>
    </div>
  )
}
