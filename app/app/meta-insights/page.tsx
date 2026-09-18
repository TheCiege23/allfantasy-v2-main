"use client"

import Link from "next/link"
import { MetaInsightsDashboard } from "@/components/meta-insights"

export default function MetaInsightsPage() {
  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
      <nav className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Link href="/core" className="text-slate-400 hover:text-slate-200">
          ← App home
        </Link>
        <Link href="/leagues" className="text-slate-400 hover:text-slate-200">
          Leagues
        </Link>
        <Link href="/mock-draft-simulator" className="text-slate-400 hover:text-slate-200">
          Mock draft
        </Link>
      </nav>
      <MetaInsightsDashboard />
    </main>
  )
}
