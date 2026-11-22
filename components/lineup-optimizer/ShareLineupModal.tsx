'use client'

import { Copy, Share2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { DecisionEngineJson } from './types'

function buildShareText(engine: DecisionEngineJson | null, projected: number, winPct: number): string {
  const mode = engine?.lineupMode ?? 'Lineup'
  const starters = engine?.optimizedLineup.map((r) => `${r.slot}: ${r.playerName}`).join('\n') ?? ''
  return [
    `AllFantasy Lineup — ${mode}`,
    `Proj: ${projected.toFixed(1)} · Win: ${Math.round(winPct * 100)}%`,
    '',
    starters,
    '',
    'Optimized with AllFantasy Chimmy · allfantasy.ai',
  ].join('\n')
}

export function ShareLineupModal({
  open,
  onOpenChange,
  engine,
  projectedScore,
  winProbability,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  engine: DecisionEngineJson | null
  projectedScore: number
  winProbability: number
}) {
  const [copied, setCopied] = useState(false)
  const text = buildShareText(engine, projectedScore, winProbability)

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }, [text])

  const share = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: 'My AllFantasy lineup', text })
      } catch {
        /* noop */
      }
    } else {
      await copy()
    }
  }, [copy, text])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/15 bg-[#0a1228] text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share lineup</DialogTitle>
        </DialogHeader>
        <pre className="max-h-48 overflow-auto rounded-xl border border-white/10 bg-black/40 p-3 text-xs text-white/80">
          {text}
        </pre>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            className="gap-2 border border-white/15 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25"
            onClick={() => void copy()}
          >
            <Copy className="h-4 w-4" />
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="gap-2 border border-white/15 bg-white/10 text-white hover:bg-white/15"
            onClick={() => void share()}
          >
            <Share2 className="h-4 w-4" />
            Share
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
