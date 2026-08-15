"use client"

import { useState } from "react"
import { PlatformAnalyticsPanel } from "@/app/admin/components/PlatformAnalyticsPanel"

export default function PlatformAnalyticsHarnessClient() {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <main className="min-h-screen bg-[#0a0a0f] p-6 text-white">
        <h1 className="mb-4 text-xl font-semibold">Platform Analytics Harness</h1>
        <button
          type="button"
          data-testid="platform-analytics-open"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200"
        >
          Open Platform Analytics
        </button>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#0a0a0f] p-6 text-white">
      <PlatformAnalyticsPanel />
    </main>
  )
}
