import Link from "next/link"
import { Gamepad2, ChevronRight } from "lucide-react"

export default function WebAppCard() {
  return (
    <Link href="/core" className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-5 hover:bg-purple-500/10 transition">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-purple-200">AllFantasy WebApp</h2>
        <Gamepad2 className="h-4 w-4 text-purple-300" />
      </div>
      <p className="mt-2 text-xs text-purple-100/80">League management, roster, waivers, trades, and draft.</p>
      <p className="mt-2 text-xs text-purple-100/70">AI highlight: three waiver adds with immediate lineup impact.</p>
      <div className="mt-4 inline-flex items-center gap-1 text-xs text-purple-200">Open WebApp <ChevronRight className="h-3.5 w-3.5" /></div>
    </Link>
  )
}
