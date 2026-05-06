"use client"

import { useState } from "react"
import AdminFeatureToggles from "@/app/admin/components/AdminFeatureToggles"

export default function FeatureTogglesHarnessClient() {
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <main className="min-h-screen bg-[#0a0a0f] p-6 text-white">
        <h1 className="mb-4 text-xl font-semibold">Feature Toggle Harness</h1>
        <button
          type="button"
          data-testid="feature-toggles-open"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-cyan-400/40 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200"
        >
          Open Feature Toggles
        </button>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-[#0a0a0f] p-6 text-white">
      <AdminFeatureToggles />
    </main>
  )
}
