"use client"
import { useState } from "react"
import { Check, Copy, Link2, Lock, Share2, Users } from "lucide-react"
import type { WorldCupChallengeView } from "@/lib/world-cup/types"

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-xs">
      <span className="text-white/40">{label}</span>
      <span className="font-bold text-white/75">{value}</span>
    </div>
  )
}

export default function WorldCupInvitePanel({ view }: { view: WorldCupChallengeView }) {
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)

  const challenge = view.challenge
  const inviteUrl =
    challenge.inviteUrl ||
    (typeof window !== "undefined"
      ? `${window.location.origin}/join/bracket/${challenge.inviteCode}`
      : `https://allfantasy.com/join/bracket/${challenge.inviteCode}`)
  const inviteCode = challenge.inviteCode ?? null

  const shareMessage =
    `Join my AllFantasy World Cup Bracket Challenge "${challenge.name}"! ` +
    `Make up to ${challenge.maxEntriesPerParticipant} brackets, use AI matchup previews, and compete on the live leaderboard. ` +
    inviteUrl

  const isLocked =
    challenge.status === "locked" ||
    challenge.status === "final"

  async function copyLink() {
    await navigator.clipboard?.writeText(inviteUrl)
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 1600)
  }

  async function copyCode() {
    if (!inviteCode) return
    await navigator.clipboard?.writeText(inviteCode)
    setCopiedCode(true)
    setTimeout(() => setCopiedCode(false), 1600)
  }

  async function shareNative() {
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: `${challenge.name} — AllFantasy World Cup Bracket`,
          text: shareMessage,
          url: inviteUrl,
        })
        return
      } catch {
        // user cancelled or share not supported — fall through to copy
      }
    }
    await copyLink()
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 pb-28 sm:pb-8">
      {/* League metadata */}
      <div className="mb-5 rounded-xl border border-white/10 bg-white/[0.04] p-4">
        <h2 className="mb-3 text-base font-black text-white">League Details</h2>
        <div className="space-y-2">
          <MetaRow label="League" value={challenge.name} />
          <MetaRow
            label="Privacy"
            value={challenge.visibility === "public" ? "Public" : "Private — invite only"}
          />
          <MetaRow
            label="Max Users"
            value={`${view.leaderboard?.length ?? "—"} / ${challenge.maxParticipants}`}
          />
          <MetaRow
            label="Brackets per User"
            value={String(challenge.maxEntriesPerParticipant)}
          />
          <MetaRow
            label="Scoring"
            value="NCAA-style"
          />
          <MetaRow
            label="Lock Rule"
            value={
              challenge.pickLockStrategy === "tournament_start"
                ? "Locks at first World Cup match"
                : "Per-match lock at kickoff"
            }
          />
          {isLocked && (
            <div className="flex items-center gap-1.5 rounded-lg border border-white/[0.07] bg-amber-300/[0.07] px-3 py-2 text-xs font-bold text-amber-300">
              <Lock className="h-3 w-3" />
              This league is locked. Picks can no longer be edited.
            </div>
          )}
        </div>
      </div>

      {/* Invite link */}
      {inviteCode ? (
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-center gap-2 text-base font-black text-white">
            <Link2 className="h-4 w-4 text-cyan-300" />
            Invite Link
          </div>
          <p className="mt-1 text-xs text-white/45">
            Share this with anyone you want to invite. They must be signed in to AllFantasy.
          </p>

          {/* URL box */}
          <div className="mt-4 break-all rounded-lg border border-white/10 bg-black/40 px-3 py-3 text-xs text-white/60 leading-5">
            {inviteUrl}
          </div>

          {/* Invite code */}
          <div className="mt-3 flex items-center justify-between rounded-lg border border-white/[0.07] bg-black/20 px-3 py-2">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-widest text-white/35">Invite Code</div>
              <div className="mt-0.5 font-mono text-sm font-black text-white/80 tracking-widest">{inviteCode}</div>
            </div>
            <button
              type="button"
              onClick={copyCode}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-bold text-white/60 transition hover:bg-white/[0.08] hover:text-white"
            >
              {copiedCode ? <Check className="h-3.5 w-3.5 text-emerald-300" /> : <Copy className="h-3.5 w-3.5" />}
              {copiedCode ? "Copied" : "Copy Code"}
            </button>
          </div>

          {/* Action buttons */}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-4 py-2.5 text-sm font-black text-black"
            >
              {copiedLink ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copiedLink ? "Link Copied!" : "Copy Invite Link"}
            </button>
            <button
              type="button"
              onClick={shareNative}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-bold text-white/75 hover:bg-white/[0.08]"
            >
              <Share2 className="h-4 w-4" />
              Share
            </button>
          </div>

          {/* Share message preview */}
          <details className="mt-4">
            <summary className="cursor-pointer text-[11px] text-white/35 hover:text-white/55">
              Preview share message
            </summary>
            <div className="mt-2 rounded-lg border border-white/[0.07] bg-black/20 px-3 py-3 text-xs leading-5 text-white/50">
              {shareMessage}
            </div>
          </details>
        </div>
      ) : (
        /* No invite code — friendly fallback */
        <div className="rounded-xl border border-white/[0.07] bg-white/[0.03] px-5 py-8 text-center">
          <Users className="mx-auto mb-3 h-8 w-8 text-white/20" />
          <p className="text-sm font-bold text-white/50">Invite link not available</p>
          <p className="mt-1 text-xs text-white/30">
            The league owner or admin can regenerate an invite link from the challenge settings.
          </p>
        </div>
      )}
    </div>
  )
}

