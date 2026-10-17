'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { X } from 'lucide-react'
import { useLanguage } from '@/components/i18n/LanguageProviderClient'
import type { DraftPlayerRow } from '../types'

function SortRow({
  id,
  player,
  onRemove,
}: {
  id: string
  player: DraftPlayerRow
  onRemove: () => void
}) {
  const { t } = useLanguage()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded border border-white/[0.06] bg-white/[0.03] px-2 py-1.5 text-[11px]"
    >
      <button
        type="button"
        className="cursor-grab touch-none text-white/35"
        {...attributes}
        {...listeners}
        aria-label={t('draftRoom.queue.aria.drag')}
      >
        ⋮⋮
      </button>
      <span className="min-w-0 flex-1 truncate text-white/90">{player.name}</span>
      <span className="text-white/40">{player.position}</span>
      <button type="button" onClick={onRemove} className="text-white/35 hover:text-red-400" aria-label={t('draftRoom.queue.aria.remove')}>
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

type Props = {
  sessionId: string
  queue: DraftPlayerRow[]
  onQueueChange: (next: DraftPlayerRow[]) => void
}

export function QueuePanel({ sessionId, queue, onQueueChange }: Props) {
  const { t } = useLanguage()
  const [saving, setSaving] = useState(false)
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const persist = useCallback(
    async (ids: string[]) => {
      setSaving(true)
      try {
        await fetch('/api/draft/queue/update', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, playerIds: ids }),
        })
      } finally {
        setSaving(false)
      }
    },
    [sessionId],
  )

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void persist(queue.map((q) => q.id))
    }, 500)
    return () => window.clearTimeout(timeoutId)
  }, [queue, persist])

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = queue.findIndex((q) => q.id === active.id)
    const newIndex = queue.findIndex((q) => q.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    onQueueChange(arrayMove(queue, oldIndex, newIndex))
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-white/[0.08] bg-[#0d1117]">
      <div className="border-b border-white/[0.06] px-2 py-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-white/40">{t('draftRoom.queue.title')}</p>
        {saving ? <p className="text-[11px] text-white/30">{t('draftRoom.queue.saving')}</p> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {queue.length === 0 ? (
          <p className="py-6 text-center text-[11px] text-white/35">{t('draftRoom.queue.emptyHint')}</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={queue.map((q) => q.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-1">
                {queue.map((q) => (
                  <SortRow
                    key={q.id}
                    id={q.id}
                    player={q}
                    onRemove={() => onQueueChange(queue.filter((x) => x.id !== q.id))}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  )
}
