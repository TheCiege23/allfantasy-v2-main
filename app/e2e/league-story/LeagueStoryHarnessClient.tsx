"use client"

import { useState } from "react"
import { LeagueStoryModal } from "@/components/league-story/LeagueStoryModal"
import { LeagueStoryCard } from "@/components/league-story/LeagueStoryCard"
import { LeagueStoryShareBar } from "@/components/league-story/LeagueStoryShareBar"

export default function LeagueStoryHarnessClient() {
  const [open, setOpen] = useState(true)
  const samplePayload = {
    storyType: "league_spotlight" as const,
    title: "Sample Story Share",
    narrative: "Sample narrative for copy/share interaction audits.",
    leagueId: "league_story_1",
    leagueName: "Story Audit League",
    week: 9,
    season: "2026",
    sport: "NFL",
  }

  return (
    <div className="min-h-screen bg-[#040915] p-6 text-white">
      <div className="mx-auto max-w-5xl space-y-4">
        <h1 className="text-2xl font-semibold">League Story Creator Harness</h1>
        <p className="text-sm text-white/70">
          E2E harness for one-brain story generation, variants, and sharing interactions.
        </p>
        <button
          type="button"
          data-testid="league-story-harness-open-modal-button"
          onClick={() => {
            requestAnimationFrame(() => setOpen(true))
          }}
          className="rounded-xl border border-cyan-400/30 bg-cyan-500/10 px-4 py-2.5 text-sm font-medium text-cyan-100 hover:bg-cyan-500/20"
        >
          Open League Story Creator
        </button>
        {open && (
          <LeagueStoryModal
            leagueId="league_story_1"
            leagueName="Story Audit League"
            week={9}
            season="2026"
            sport="NFL"
            onClose={() => setOpen(false)}
          />
        )}
        <div
          data-testid="league-story-harness-share-controls"
          className="rounded-xl border border-white/10 bg-[#081026] p-4"
        >
          <p className="mb-3 text-xs uppercase tracking-wide text-slate-400">
            Static Share Controls Audit Surface
          </p>
          <div className="flex flex-col gap-3">
            <LeagueStoryCard payload={samplePayload} dataTestId="league-story-harness-static-card" />
            <LeagueStoryShareBar
              payload={samplePayload}
              shareUrl="http://localhost:3092/share/share_story_1"
              captureId="league-story-card-capture"
            />
            <div className="flex flex-wrap gap-2">
              <a
                href="/share/share_story_1"
                data-testid="league-story-harness-open-detail-link"
                className="rounded-lg border border-cyan-400/25 bg-cyan-500/10 px-3 py-2 text-xs font-medium text-cyan-100 hover:bg-cyan-500/20"
              >
                Open story detail page
              </a>
              <button
                type="button"
                data-testid="league-story-harness-back-button"
                className="rounded-lg border border-white/20 bg-white/5 px-3 py-2 text-xs font-medium text-slate-100 hover:bg-white/10"
              >
                Back
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
