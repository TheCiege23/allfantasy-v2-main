"use client"

import { useState } from "react"
import { ListOrdered, GripVertical, X } from "lucide-react"
import type { DraftQueueItem } from "./useDraftQueue"

type DraftQueueProps = {
  queue: DraftQueueItem[]
  onRemove: (id: string) => void
  onReorder: (fromIndex: number, toIndex: number) => void
}

export function DraftQueue({ queue, onRemove, onReorder }: DraftQueueProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  return (
    <section className="space-y-2 rounded-2xl border border-white/12 bg-black/25 p-3 text-xs text-white/80">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/20 bg-black/60">
            <ListOrdered className="h-3.5 w-3.5 text-cyan-300" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold text-white">Draft Queue</p>
            <p className="text-[11px] text-white/65">
              Players you want to target next. Queue persists across draft and mock draft views.
            </p>
          </div>
        </div>
      </header>

      {queue.length === 0 ? (
        <p className="text-[11px] text-white/55">
          No players in your queue yet. Add players from rankings, search, or mock draft board.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {queue.map((item, index) => (
            <li
              key={item.id}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = "move"
                setDragIndex(index)
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                if (dragIndex === null || dragIndex === index) return
                onReorder(dragIndex, index)
                setDragIndex(null)
              }}
              className={`flex items-center justify-between gap-2 rounded-xl border border-white/15 bg-black/50 px-2.5 py-1.5 text-[11px] ${
                dragIndex === index ? "opacity-60" : "hover:bg-white/5"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="inline-flex h-6 w-4 items-center justify-center text-[11px] text-white/50">
                  <GripVertical className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">{item.name}</p>
                  <p className="text-[11px] text-white/60">
                    {item.position} • {item.team} • Rank {item.rank}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/20 text-[11px] text-white/65 hover:bg-white/10"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

