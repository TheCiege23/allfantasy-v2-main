export default function ChatThreadList() {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
      <h4 className="text-sm font-semibold text-white">Threads</h4>
      <ul className="mt-2 space-y-2 text-xs text-white/70">
        <li className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5">League Chat</li>
        <li className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5">Trade Desk</li>
        <li className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5">Chimmy Chat</li>
      </ul>
    </div>
  )
}
