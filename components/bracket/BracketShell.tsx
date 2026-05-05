'use client'

import type { ReactNode } from 'react'

export default function BracketShell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-8 pt-6 sm:px-6 sm:pb-10">
      {children}
    </div>
  )
}
