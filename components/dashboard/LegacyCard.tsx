import Link from "next/link"
import { BarChart3, ChevronRight } from "lucide-react"

export default function LegacyCard() {
  return (
    <Link href="/af-legacy" className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-5 hover:bg-emerald-500/10 transition">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-emerald-200">AF War Room</h2>
        <BarChart3 className="h-4 w-4 text-emerald-300" />
      </div>
      <p className="mt-2 text-xs text-emerald-100/80">Advanced AI strategy: team scan, draft war room, trade center.</p>
      <p className="mt-2 text-xs text-emerald-100/70">AI highlight: trade market shifted in your favor for 2 targets.</p>
      <div className="mt-4 inline-flex items-center gap-1 text-xs text-emerald-200">Open Legacy <ChevronRight className="h-3.5 w-3.5" /></div>
    </Link>
  )
}
