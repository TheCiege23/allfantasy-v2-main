import { Loader2 } from "lucide-react"

export default function WorldCupBracketsLoading() {
  return (
    <main className="mx-auto flex min-h-[40vh] w-full max-w-6xl flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-white/40">
      <Loader2 className="h-7 w-7 animate-spin text-cyan-400/60" />
      <p className="text-sm font-medium">Loading…</p>
    </main>
  )
}
