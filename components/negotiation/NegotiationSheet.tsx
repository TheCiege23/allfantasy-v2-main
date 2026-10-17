'use client'

import React, { useEffect, useMemo, useState } from "react"
import { applyCounterPatch, type CounterTradePatch, type TradeCandidate } from "@/lib/trade-finder/apply-counter"
import { computeValueDeltaPct, previewFairnessLabel, FAIRNESS_DISPLAY } from "@/lib/trade-finder/score-candidate"
import type { TradeAsset } from "@/lib/trade-finder/asset-index"

type NegotiationMessage = {
  tone: "FRIENDLY" | "CONFIDENT" | "CASUAL" | "DATA_BACKED" | "SHORT"
  hook: string
  message: string
}

type NegotiationCounter = {
  label: string
  ifTheyObject: string
  rationale: string
  counterTrade: CounterTradePatch
}

type NegotiationSweetener = {
  label: string
  whenToUse: string
  addOn: {
    faab?: number
    pickSwap?: {
      youAddPickId?: string
      youRemovePickId?: string
    }
  }
}

export type NegotiationBlock = {
  dmMessages: NegotiationMessage[]
  counters: NegotiationCounter[]
  sweeteners: NegotiationSweetener[]
  redLines: string[]
}

export type NegotiationData = NegotiationBlock

export type NegotiationTone = NegotiationMessage["tone"]

type Props = {
  open: boolean
  onClose: () => void
  candidate: TradeCandidate
  negotiation: NegotiationBlock | null
  assetIndex: Record<string, TradeAsset>
  showPreview?: boolean
  onCandidateUpdate?: (next: TradeCandidate & { valueDeltaPct?: number; previewLabel?: string }) => void
}

type TabKey = "MESSAGE" | "COUNTERS" | "SWEETENERS"

const TONE_STORAGE_KEY = 'af_tone_preference'

function getTonePreference(): NegotiationTone | null {
  if (typeof window === 'undefined') return null
  return (localStorage.getItem(TONE_STORAGE_KEY) as NegotiationTone) || null
}

function setTonePreference(tone: NegotiationTone | null) {
  if (typeof window === 'undefined') return
  if (tone) {
    localStorage.setItem(TONE_STORAGE_KEY, tone)
  } else {
    localStorage.removeItem(TONE_STORAGE_KEY)
  }
}

export default function NegotiationSheet({
  open,
  onClose,
  candidate,
  negotiation,
  assetIndex,
  showPreview = true,
  onCandidateUpdate,
}: Props) {
  const [tab, setTab] = useState<TabKey>("MESSAGE")
  const [selectedTone, setSelectedTone] = useState<NegotiationTone>("FRIENDLY")
  const [copied, setCopied] = useState<string | null>(null)
  const [soundLikeMe, setSoundLikeMe] = useState(false)

  useEffect(() => {
    const stored = getTonePreference()
    if (stored) {
      setSelectedTone(stored)
      setSoundLikeMe(true)
    }
  }, [])

  useEffect(() => {
    if (!open) {
      setCopied(null)
      return
    }
    setCopied(null)
  }, [open])

  const handleToneChange = (tone: NegotiationTone) => {
    setSelectedTone(tone)
    if (soundLikeMe) {
      setTonePreference(tone)
    }
  }

  const handleSoundLikeMeToggle = () => {
    const next = !soundLikeMe
    setSoundLikeMe(next)
    if (next && selectedTone) {
      setTonePreference(selectedTone)
    } else if (!next) {
      setTonePreference(null)
    }
  }

  const preview = useMemo(() => {
    const deltaPct = computeValueDeltaPct(candidate)
    const label = previewFairnessLabel(deltaPct)
    const display = FAIRNESS_DISPLAY[label]
    return { deltaPct, label, display }
  }, [candidate])

  const tones = useMemo(() => {
    const set = new Set(negotiation?.dmMessages?.map((m) => m.tone) ?? [])
    const ordered: NegotiationTone[] = ["FRIENDLY", "SHORT", "CASUAL", "CONFIDENT", "DATA_BACKED"]
    return ordered.filter((t) => set.has(t))
  }, [negotiation])

  const messagesForTone = useMemo(() => {
    const msgs = negotiation?.dmMessages ?? []
    const filtered = msgs.filter((m) => m.tone === selectedTone)
    return filtered.length ? filtered : msgs
  }, [negotiation, selectedTone])

  const copyToClipboard = async (text: string) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
      } else {
        const ta = document.createElement("textarea")
        ta.value = text
        ta.style.position = "fixed"
        ta.style.left = "-9999px"
        document.body.appendChild(ta)
        ta.select()
        document.execCommand("copy")
        document.body.removeChild(ta)
      }
      setCopied("Copied!")
      window.setTimeout(() => setCopied(null), 1200)
    } catch {
      setCopied("Copy failed")
      window.setTimeout(() => setCopied(null), 1200)
    }
  }

  const applyPatch = (patch: CounterTradePatch) => {
    const next = applyCounterPatch({
      candidate,
      patch,
      assetIndex: assetIndex as any,
    })

    const deltaPct = computeValueDeltaPct(next)
    const label = previewFairnessLabel(deltaPct)

    const enriched = { ...next, valueDeltaPct: deltaPct, previewLabel: label }
    onCandidateUpdate?.(enriched)
  }

  const applySweetener = (s: NegotiationSweetener) => {
    const patch: CounterTradePatch = {}

    if (s.addOn?.pickSwap?.youRemovePickId) patch.youRemove = [s.addOn.pickSwap.youRemovePickId]
    if (s.addOn?.pickSwap?.youAddPickId) patch.youAdd = [s.addOn.pickSwap.youAddPickId]

    if (typeof s.addOn?.faab === "number") {
      patch.faabAdd = s.addOn.faab
    }

    const hasAssetMutation =
      (patch.youAdd?.length ?? 0) ||
      (patch.youRemove?.length ?? 0) ||
      (patch.theyAdd?.length ?? 0) ||
      (patch.theyRemove?.length ?? 0) ||
      typeof patch.faabAdd === "number"

    if (hasAssetMutation) applyPatch(patch)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60]">
      <button
        aria-label="Close negotiation sheet"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />

      <div className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-xl">
        <div className="rounded-t-3xl border border-white/10 bg-zinc-950 shadow-2xl max-h-[85vh] flex flex-col">
          <div className="flex justify-center pt-3">
            <div className="h-1 w-12 rounded-full bg-white/15" />
          </div>

          <div className="px-4 pt-3 pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-base font-semibold text-white">Negotiation Assistant</div>
                <div className="text-xs text-white/50">
                  Ready-to-send messages, counters, and sweeteners
                </div>
              </div>

              <button
                onClick={onClose}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"
              >
                Close
              </button>
            </div>

            {showPreview && (
              <div className="mt-3 flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2">
                <div className="text-xs text-white/70">
                  Preview:{" "}
                  <span className={`font-semibold ${preview.display.color}`}>{preview.display.text}</span>{" "}
                  <span className="text-white/50">({preview.deltaPct >= 0 ? "+" : ""}{preview.deltaPct}%)</span>
                </div>
                {copied && (
                  <div className="text-xs text-white/60">{copied}</div>
                )}
              </div>
            )}
          </div>

          <div className="px-4 pb-2">
            <div className="grid grid-cols-3 gap-2">
              <TabButton active={tab === "MESSAGE"} onClick={() => setTab("MESSAGE")} label="Messages" count={negotiation?.dmMessages?.length || 0} />
              <TabButton active={tab === "COUNTERS"} onClick={() => setTab("COUNTERS")} label="Counters" count={negotiation?.counters?.length || 0} />
              <TabButton active={tab === "SWEETENERS"} onClick={() => setTab("SWEETENERS")} label="Sweeteners" count={negotiation?.sweeteners?.length || 0} />
            </div>
          </div>

          <div className="px-4 pb-5 overflow-y-auto flex-1 min-h-0">
            {tab === "MESSAGE" && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {(tones.length ? tones : (["FRIENDLY", "SHORT", "CASUAL", "CONFIDENT", "DATA_BACKED"] as const)).map(
                    (t) => (
                      <Chip
                        key={t}
                        active={selectedTone === t}
                        onClick={() => handleToneChange(t)}
                        label={toneLabel(t)}
                      />
                    )
                  )}
                </div>

                <label className="flex items-center gap-2 cursor-pointer touch-manipulation">
                  <div
                    onClick={handleSoundLikeMeToggle}
                    className={`w-9 h-5 rounded-full relative transition-colors ${
                      soundLikeMe ? 'bg-cyan-500' : 'bg-white/20'
                    }`}
                  >
                    <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                      soundLikeMe ? 'translate-x-4' : 'translate-x-0'
                    }`} />
                  </div>
                  <span className="text-xs text-white/60">Make it sound like me</span>
                </label>

                <div className="space-y-2">
                  {(messagesForTone?.length ? messagesForTone : negotiation?.dmMessages ?? []).slice(0, 5).map((m, i) => (
                    <div key={`${m.tone}-${i}`} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs text-white/60">{toneLabel(m.tone)}</div>
                          <div className="text-sm font-semibold text-white/90">{m.hook}</div>
                        </div>
                        <button
                          onClick={() => copyToClipboard(m.message)}
                          className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"
                        >
                          Copy
                        </button>
                      </div>

                      <div className="mt-2 text-sm text-white/80 whitespace-pre-wrap leading-relaxed">
                        {m.message}
                      </div>
                    </div>
                  ))}
                </div>

                {negotiation?.redLines?.length ? (
                  <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-3">
                    <div className="text-xs font-semibold text-rose-400">Protect your team</div>
                    <ul className="mt-2 space-y-1 text-xs text-rose-200/80">
                      {negotiation.redLines.slice(0, 6).map((r, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="mt-0.5 text-rose-500">✕</span>
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}

            {tab === "COUNTERS" && (
              <div className="space-y-2">
                {(negotiation?.counters ?? []).length ? (
                  (negotiation!.counters ?? []).slice(0, 6).map((c, i) => (
                    <div key={i} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-white/90">{c.label}</div>
                          <div className="mt-1 text-xs text-white/60">
                            If they object: <span className="text-white/75">{c.ifTheyObject}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => applyPatch(c.counterTrade)}
                          className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"
                        >
                          Apply
                        </button>
                      </div>

                      <div className="mt-2 text-xs text-white/70">
                        {c.rationale}
                      </div>

                      <PatchPreview patch={c.counterTrade} assetIndex={assetIndex} />
                    </div>
                  ))
                ) : (
                  <EmptyState
                    title="No counters available"
                    body="This usually means the trade is already tight or there were limited safe assets to adjust."
                  />
                )}
              </div>
            )}

            {tab === "SWEETENERS" && (
              <div className="space-y-2">
                {(negotiation?.sweeteners ?? []).length ? (
                  (negotiation!.sweeteners ?? []).slice(0, 6).map((s, i) => (
                    <div key={i} className="rounded-2xl border border-white/10 bg-white/5 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-white/90">{s.label}</div>
                          <div className="mt-1 text-xs text-white/60">{s.whenToUse}</div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => {
                              const line = formatSweetenerLine(s, assetIndex)
                              copyToClipboard(line)
                            }}
                            className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"
                          >
                            Copy
                          </button>
                          <button
                            onClick={() => applySweetener(s)}
                            className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"
                          >
                            Apply
                          </button>
                        </div>
                      </div>

                      <div className="mt-2 text-xs text-white/70">
                        {formatSweetenerDetail(s, assetIndex)}
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    title="No sweeteners needed"
                    body="The trade is likely close enough, or FAAB/pick sweeteners were not available."
                  />
                )}
              </div>
            )}
          </div>

          <div className="border-t border-white/10 px-4 py-3 flex items-center justify-between">
            <div className="text-xs text-white/50">
              Tip: Apply 1 tweak, then re-check with Chimmy if needed.
            </div>
            <button
              onClick={onClose}
              className="rounded-xl bg-white text-zinc-900 px-4 py-2 text-xs font-semibold hover:opacity-95"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function TabButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count?: number }) {
  return (
    <button
      onClick={onClick}
      className={[
        "rounded-2xl px-3 py-2 text-xs font-semibold border transition flex items-center justify-center gap-1.5",
        active
          ? "bg-white text-zinc-900 border-white/10"
          : "bg-white/5 text-white/70 border-white/10 hover:bg-white/10",
      ].join(" ")}
    >
      <span>{label}</span>
      {typeof count === 'number' && count > 0 && (
        <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${
          active ? 'bg-zinc-200 text-zinc-700' : 'bg-white/10 text-white/40'
        }`}>
          {count}
        </span>
      )}
    </button>
  )
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={[
        "px-3 py-1.5 rounded-full text-xs border transition touch-manipulation",
        active
          ? "bg-cyan-500/15 text-cyan-300 border-cyan-500/30"
          : "bg-white/5 text-white/70 border-white/10 hover:bg-white/10",
      ].join(" ")}
    >
      {label}
    </button>
  )
}

function toneLabel(t: NegotiationTone) {
  switch (t) {
    case "FRIENDLY":
      return "Friendly"
    case "CONFIDENT":
      return "Confident"
    case "CASUAL":
      return "Casual"
    case "DATA_BACKED":
      return "Data-backed"
    case "SHORT":
      return "Short"
    default:
      return t
  }
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <div className="text-sm font-semibold text-white/85">{title}</div>
      <div className="mt-1 text-xs text-white/60">{body}</div>
    </div>
  )
}

function PatchPreview({
  patch,
  assetIndex,
}: {
  patch: CounterTradePatch
  assetIndex: Record<string, TradeAsset>
}) {
  const youAdd = (patch.youAdd ?? []).map((id) => assetIndex[id]?.label ?? id)
  const youRemove = (patch.youRemove ?? []).map((id) => assetIndex[id]?.label ?? id)
  const theyAdd = (patch.theyAdd ?? []).map((id) => assetIndex[id]?.label ?? id)
  const theyRemove = (patch.theyRemove ?? []).map((id) => assetIndex[id]?.label ?? id)

  const lines: string[] = []
  if (youAdd.length) lines.push(`You add: ${youAdd.join(", ")}`)
  if (youRemove.length) lines.push(`You remove: ${youRemove.join(", ")}`)
  if (theyAdd.length) lines.push(`They add: ${theyAdd.join(", ")}`)
  if (theyRemove.length) lines.push(`They remove: ${theyRemove.join(", ")}`)
  if (typeof patch.faabAdd === "number") lines.push(`Sweetener: +${patch.faabAdd} FAAB`)

  if (!lines.length) return null

  return (
    <div className="mt-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2">
      <div className="text-[11px] text-white/55 space-y-1">
        {lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </div>
  )
}

function formatSweetenerLine(s: NegotiationSweetener, assetIndex: Record<string, TradeAsset>) {
  if (typeof s.addOn?.faab === "number") {
    return `I can add ${s.addOn.faab} FAAB to make it work.`
  }
  const addId = s.addOn?.pickSwap?.youAddPickId
  const remId = s.addOn?.pickSwap?.youRemovePickId
  const addLabel = addId ? (assetIndex[addId]?.label ?? addId) : null
  const remLabel = remId ? (assetIndex[remId]?.label ?? remId) : null

  if (addLabel && remLabel) return `I can swap ${remLabel} for ${addLabel} to sweeten it.`
  if (addLabel) return `I can add ${addLabel} as a sweetener.`
  return `I can add a small sweetener if needed.`
}

function formatSweetenerDetail(s: NegotiationSweetener, assetIndex: Record<string, TradeAsset>) {
  const parts: string[] = []
  if (typeof s.addOn?.faab === "number") parts.push(`+${s.addOn.faab} FAAB`)
  const addId = s.addOn?.pickSwap?.youAddPickId
  const remId = s.addOn?.pickSwap?.youRemovePickId
  if (addId) parts.push(`Add: ${assetIndex[addId]?.label ?? addId}`)
  if (remId) parts.push(`Remove: ${assetIndex[remId]?.label ?? remId}`)
  return parts.length ? parts.join(" • ") : "No asset changes."
}
