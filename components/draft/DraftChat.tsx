'use client'

import { useState } from 'react'

export function DraftChat({
  messages,
  onSend,
}: {
  messages: Array<{ id: string; from: string; text: string; at: string }>
  onSend?: (text: string) => Promise<void> | void
}) {
  const [value, setValue] = useState('')

  return (
    <div className="flex h-full flex-col rounded-2xl border border-white/10 bg-[#081121]">
      <div className="border-b border-white/10 px-4 py-3">
        <p className="text-sm font-semibold text-white">Draft Chat</p>
      </div>

      <div className="flex-1 space-y-3 overflow-auto px-4 py-4">
        {messages.length === 0 ? (
          <p className="text-sm text-white/45">No draft chat yet.</p>
        ) : (
          messages.map((message) => (
            <div key={message.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-cyan-100">{message.from}</p>
                <p className="text-[11px] text-white/35">{new Date(message.at).toLocaleTimeString()}</p>
              </div>
              <p className="mt-1 text-sm text-white/75">{message.text}</p>
            </div>
          ))
        )}
      </div>

      {onSend ? (
        <div className="border-t border-white/10 p-3">
          <div className="flex gap-2">
            <input
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="Talk draft strategy..."
              className="flex-1 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
            />
            <button
              type="button"
              onClick={async () => {
                const text = value.trim()
                if (!text) return
                await onSend(text)
                setValue('')
              }}
              className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2 text-sm font-semibold text-cyan-100"
            >
              Send
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
