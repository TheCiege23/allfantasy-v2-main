"use client"

import { useState } from "react"

const SIZE_PX = 32

/** `/images/chimmy-avatar.png` if present; else purple circle with "CH". */
export function ChimmyAssistantAvatar({ className = "" }: { className?: string }) {
  const [failed, setFailed] = useState(false)

  if (!failed) {
    return (
      <div
        className={`relative h-8 w-8 shrink-0 overflow-hidden rounded-full border border-white/[0.12] ${className}`}
        style={{ width: SIZE_PX, height: SIZE_PX }}
      >
        <img
          src="/images/chimmy-avatar.png"
          alt=""
          className="h-full w-full object-cover"
          style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.06)" }}
          onError={() => setFailed(true)}
        />
      </div>
    )
  }

  return (
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.12] bg-purple-600/85 text-[11px] font-bold text-white ${className}`}
      style={{ width: SIZE_PX, height: SIZE_PX }}
      aria-hidden
    >
      CH
    </div>
  )
}
