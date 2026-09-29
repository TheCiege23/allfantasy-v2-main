'use client'

import React from 'react'

function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

interface Manager {
  displayName: string
  wins: number
  losses: number
  ties?: number
  pointsFor: string | number
  avatar?: string | null
  rosterId?: number
}

interface PlayoffBracketPreviewProps {
  managers: Manager[]
  leagueName: string
  season: string | number
  playoffTeamCount: 4 | 6 | 7 | 8 | 9
}

function seedColor(seed: number) {
  const colors = [
    'from-cyan-400 to-blue-500',
    'from-emerald-400 to-green-500',
    'from-amber-400 to-orange-500',
    'from-purple-400 to-pink-500',
    'from-red-400 to-rose-500',
    'from-teal-400 to-cyan-600',
    'from-indigo-400 to-purple-500',
    'from-yellow-400 to-amber-500',
    'from-pink-400 to-fuchsia-500',
  ]
  return colors[(seed - 1) % colors.length]
}

function TeamSlot({
  seed,
  name,
  score,
  winner,
  bye,
  className,
}: {
  seed: number
  name: string
  score?: string
  winner?: boolean
  bye?: boolean
  className?: string
}) {
  if (seed === 0 && !name) {
    return <div className={cx('p-2 h-8', className)} />
  }

  return (
    <div className={cx(
      'p-2 flex items-center justify-between',
      winner ? 'bg-emerald-500/10' : '',
      className,
    )}>
      <div className="flex items-center gap-2">
        <div className={cx('w-5 h-5 rounded-full bg-gradient-to-br flex items-center justify-center text-[11px] font-bold text-white', seedColor(seed))}>
          {seed}
        </div>
        <span className={cx('text-xs truncate max-w-[100px]', winner ? 'font-semibold text-white' : 'font-medium text-white/80')}>
          {name}
        </span>
        {winner && <span className="text-sm">&#x1F451;</span>}
      </div>
      {bye ? (
        <span className="text-xs font-semibold text-cyan-400">BYE</span>
      ) : score ? (
        <span className={cx('text-xs', winner ? 'text-sm font-bold text-emerald-400' : 'text-white/60')}>
          {score}
        </span>
      ) : null}
    </div>
  )
}

function MatchupBox({
  top,
  bottom,
  label,
  className,
}: {
  top: { seed: number; name: string; score?: string; winner?: boolean; bye?: boolean }
  bottom: { seed: number; name: string; score?: string; winner?: boolean; bye?: boolean }
  label?: string
  className?: string
}) {
  return (
    <div className={cx('rounded-lg bg-gradient-to-r from-white/5 to-white/10 border border-white/20 overflow-hidden', className || 'w-44')}>
      {label && (
        <div className="text-center py-1.5 bg-amber-500/20 border-b border-amber-400/30">
          <span className="text-xs font-semibold text-amber-300">{label}</span>
        </div>
      )}
      <TeamSlot {...top} className="border-b border-white/10" />
      <TeamSlot {...bottom} />
    </div>
  )
}

function RoundHeader({ title, week }: { title: string; week: string; isChampionship?: boolean }) {
  const isChamp = title.toUpperCase() === 'CHAMPIONSHIP'
  return (
    <div className="text-center">
      <span className={cx('text-xs uppercase tracking-wider font-semibold', isChamp ? 'text-amber-400' : 'text-cyan-300/80')}>
        {title}
      </span>
      <span className="block text-[11px] text-white/40">({week})</span>
    </div>
  )
}

function generateFakeScore(seed: number, round: number): string {
  const base = 140 - seed * 4 + round * 3
  const variance = ((seed * 7 + round * 13) % 30) - 15
  return (base + variance).toFixed(2)
}

function pickWinner(seedA: number, seedB: number, round: number): 'a' | 'b' {
  const hash = (seedA * 17 + seedB * 31 + round * 53) % 100
  const threshold = 45 + (seedB - seedA) * 3
  return hash < threshold ? 'a' : 'b'
}

export default function PlayoffBracketPreview({ managers, leagueName, season, playoffTeamCount }: PlayoffBracketPreviewProps) {
  if (!managers || managers.length === 0) {
    return (
      <div className="rounded-2xl overflow-hidden relative p-8 text-center" style={{ background: 'linear-gradient(135deg, #0a1628 0%, #1a3a5c 50%, #0d2442 100%)' }}>
        <div className="text-2xl mb-2">🏆</div>
        <p className="text-white/60 text-sm">Import a league above to see your playoff bracket preview</p>
      </div>
    )
  }

  const sorted = [...managers]
    .sort((a, b) => b.wins - a.wins || parseFloat(String(b.pointsFor)) - parseFloat(String(a.pointsFor)))
    .slice(0, Math.max(playoffTeamCount, 4))

  function team(idx: number) {
    return sorted[idx]?.displayName || `Team ${idx + 1}`
  }

  if (playoffTeamCount === 4) return <Bracket4 team={team} leagueName={leagueName} season={season} generateScore={generateFakeScore} pickWinner={pickWinner} />
  if (playoffTeamCount === 6) return <Bracket6 team={team} leagueName={leagueName} season={season} generateScore={generateFakeScore} pickWinner={pickWinner} />
  if (playoffTeamCount === 7) return <Bracket7 team={team} leagueName={leagueName} season={season} generateScore={generateFakeScore} pickWinner={pickWinner} />
  if (playoffTeamCount === 8) return <Bracket8 team={team} leagueName={leagueName} season={season} generateScore={generateFakeScore} pickWinner={pickWinner} />
  if (playoffTeamCount === 9) return <Bracket9 team={team} leagueName={leagueName} season={season} generateScore={generateFakeScore} pickWinner={pickWinner} />
  return null
}

type BracketProps = {
  team: (idx: number) => string
  leagueName: string
  season: string | number
  generateScore: (seed: number, round: number) => string
  pickWinner: (a: number, b: number, round: number) => 'a' | 'b'
}

function BracketShell({ leagueName, season, playoffTeamCount, children }: { leagueName: string; season: string | number; playoffTeamCount: number; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl overflow-hidden relative" style={{ background: 'linear-gradient(135deg, #0a1628 0%, #1a3a5c 50%, #0d2442 100%)' }}>
      <div className="absolute top-4 right-4 z-10">
        <img src="/af-crest.jpg" alt="AllFantasy Crest" className="w-14 h-14 rounded-lg shadow-lg shadow-blue-500/30 object-cover" />
      </div>
      <div className="text-center pt-6 pb-4">
        <h3 className="text-2xl sm:text-3xl font-bold text-white tracking-wide">PLAYOFFS</h3>
        <p className="text-cyan-300/70 text-sm mt-1">{leagueName} &middot; {season} Season &middot; {playoffTeamCount} Team Bracket</p>
        <p className="text-[11px] text-white/30 mt-1 italic">Simulated preview &middot; Seeded by current standings</p>
      </div>
      <div className="px-4 sm:px-8 pb-8 overflow-x-auto">
        {children}
      </div>
      <div className="px-4 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center text-[11px] font-black text-white">AF</div>
          <span className="text-[11px] text-white/40 font-medium">Powered by AllFantasy</span>
        </div>
        <span className="text-[11px] text-white/25 italic">Live bracket updates coming soon</span>
      </div>
    </div>
  )
}

function Bracket4({ team, leagueName, season, generateScore, pickWinner }: BracketProps) {
  const s1 = generateScore(1, 1)
  const s4 = generateScore(4, 1)
  const s2 = generateScore(2, 1)
  const s3 = generateScore(3, 1)
  const w1 = pickWinner(1, 4, 1)
  const w2 = pickWinner(2, 3, 1)
  const semi1Winner = w1 === 'a' ? 1 : 4
  const semi1Loser = w1 === 'a' ? 4 : 1
  const semi2Winner = w2 === 'a' ? 2 : 3
  const semi2Loser = w2 === 'a' ? 3 : 2
  const champW = pickWinner(semi1Winner, semi2Winner, 2)
  const champion = champW === 'a' ? semi1Winner : semi2Winner
  const runnerUp = champW === 'a' ? semi2Winner : semi1Winner
  const thirdW = pickWinner(semi1Loser, semi2Loser, 2)
  const thirdPlace = thirdW === 'a' ? semi1Loser : semi2Loser

  return (
    <BracketShell leagueName={leagueName} season={season} playoffTeamCount={4}>
      <div className="min-w-[500px]">
        <div className="flex justify-around mb-4">
          <RoundHeader title="Semifinals" week="Week 16" />
          <RoundHeader title="Championship" week="Week 17" />
          <RoundHeader title="3rd Place" week="Week 17" />
        </div>
        <div className="flex items-center justify-around gap-4">
          <div className="space-y-4">
            <MatchupBox
              top={{ seed: 1, name: team(0), score: s1, winner: w1 === 'a' }}
              bottom={{ seed: 4, name: team(3), score: s4, winner: w1 === 'b' }}
            />
            <MatchupBox
              top={{ seed: 2, name: team(1), score: s2, winner: w2 === 'a' }}
              bottom={{ seed: 3, name: team(2), score: s3, winner: w2 === 'b' }}
            />
          </div>
          <div>
            <MatchupBox
              label="CHAMPIONSHIP"
              top={{ seed: semi1Winner, name: team(semi1Winner - 1), score: generateScore(semi1Winner, 2), winner: champW === 'a' }}
              bottom={{ seed: semi2Winner, name: team(semi2Winner - 1), score: generateScore(semi2Winner, 2), winner: champW === 'b' }}
            />
          </div>
          <div>
            <MatchupBox
              label="3RD PLACE"
              top={{ seed: semi1Loser, name: team(semi1Loser - 1), score: generateScore(semi1Loser, 2) }}
              bottom={{ seed: semi2Loser, name: team(semi2Loser - 1), score: generateScore(semi2Loser, 2), winner: thirdW === 'b' }}
              className="w-44 border-orange-400/30"
            />
          </div>
        </div>
      </div>
    </BracketShell>
  )
}

function Bracket6({ team, leagueName, season, generateScore, pickWinner }: BracketProps) {
  const r1w1 = pickWinner(4, 5, 1)
  const r1w2 = pickWinner(3, 6, 1)
  const semi1A = 1
  const semi1B = r1w1 === 'a' ? 4 : 5
  const semi2A = 2
  const semi2B = r1w2 === 'a' ? 3 : 6
  const sw1 = pickWinner(semi1A, semi1B, 2)
  const sw2 = pickWinner(semi2A, semi2B, 2)
  const champA = sw1 === 'a' ? semi1A : semi1B
  const champB = sw2 === 'a' ? semi2A : semi2B
  const loserA = sw1 === 'a' ? semi1B : semi1A
  const loserB = sw2 === 'a' ? semi2B : semi2A
  const cw = pickWinner(champA, champB, 3)
  const tw = pickWinner(loserA, loserB, 3)

  return (
    <BracketShell leagueName={leagueName} season={season} playoffTeamCount={6}>
      <div className="min-w-[700px]">
        <div className="flex justify-between mb-4 px-4">
          <div className="text-center w-1/4"><RoundHeader title="Round 1" week="Week 15" /></div>
          <div className="text-center w-1/4"><RoundHeader title="Semifinals" week="Week 16" /></div>
          <div className="text-center w-1/4"><RoundHeader title="Championship" week="Week 17" /></div>
          <div className="text-center w-1/4"><RoundHeader title="3rd Place" week="Week 17" /></div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-4">
            <MatchupBox
              top={{ seed: 1, name: team(0), bye: true }}
              bottom={{ seed: 0, name: '', score: '' }}
              className="w-40 opacity-60"
            />
            <MatchupBox
              top={{ seed: 4, name: team(3), score: generateScore(4, 1), winner: r1w1 === 'a' }}
              bottom={{ seed: 5, name: team(4), score: generateScore(5, 1), winner: r1w1 === 'b' }}
              className="w-40"
            />
            <MatchupBox
              top={{ seed: 2, name: team(1), bye: true }}
              bottom={{ seed: 0, name: '', score: '' }}
              className="w-40 opacity-60"
            />
            <MatchupBox
              top={{ seed: 3, name: team(2), score: generateScore(3, 1), winner: r1w2 === 'a' }}
              bottom={{ seed: 6, name: team(5), score: generateScore(6, 1), winner: r1w2 === 'b' }}
              className="w-40"
            />
          </div>
          <div className="space-y-4">
            <MatchupBox
              top={{ seed: semi1A, name: team(semi1A - 1), score: generateScore(semi1A, 2), winner: sw1 === 'a' }}
              bottom={{ seed: semi1B, name: team(semi1B - 1), score: generateScore(semi1B, 2), winner: sw1 === 'b' }}
              className="w-40"
            />
            <MatchupBox
              top={{ seed: semi2A, name: team(semi2A - 1), score: generateScore(semi2A, 2), winner: sw2 === 'a' }}
              bottom={{ seed: semi2B, name: team(semi2B - 1), score: generateScore(semi2B, 2), winner: sw2 === 'b' }}
              className="w-40"
            />
          </div>
          <div>
            <MatchupBox
              label="CHAMPIONSHIP"
              top={{ seed: champA, name: team(champA - 1), score: generateScore(champA, 3), winner: cw === 'a' }}
              bottom={{ seed: champB, name: team(champB - 1), score: generateScore(champB, 3), winner: cw === 'b' }}
              className="w-44"
            />
          </div>
          <div>
            <MatchupBox
              label="3RD PLACE"
              top={{ seed: loserA, name: team(loserA - 1), score: generateScore(loserA, 3) }}
              bottom={{ seed: loserB, name: team(loserB - 1), score: generateScore(loserB, 3), winner: tw === 'b' }}
              className="w-40 border-orange-400/30"
            />
          </div>
        </div>
      </div>
    </BracketShell>
  )
}

function Bracket7({ team, leagueName, season, generateScore, pickWinner }: BracketProps) {
  const r1w1 = pickWinner(4, 5, 1)
  const r1w2 = pickWinner(3, 6, 1)
  const r1w3 = pickWinner(2, 7, 1)
  const semi1A = 1
  const semi1B = r1w1 === 'a' ? 4 : 5
  const semi2A = r1w3 === 'a' ? 2 : 7
  const semi2B = r1w2 === 'a' ? 3 : 6
  const sw1 = pickWinner(semi1A, semi1B, 2)
  const sw2 = pickWinner(semi2A, semi2B, 2)
  const champA = sw1 === 'a' ? semi1A : semi1B
  const champB = sw2 === 'a' ? semi2A : semi2B
  const cw = pickWinner(champA, champB, 3)

  return (
    <BracketShell leagueName={leagueName} season={season} playoffTeamCount={7}>
      <div className="min-w-[700px]">
        <div className="flex justify-between mb-4 px-4">
          <div className="text-center w-1/4"><RoundHeader title="Round 1" week="Week 15" /></div>
          <div className="text-center w-1/4"><RoundHeader title="Semifinals" week="Week 16" /></div>
          <div className="text-center w-1/4"><RoundHeader title="Championship" week="Week 17" /></div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-3">
            <MatchupBox top={{ seed: 1, name: team(0), bye: true }} bottom={{ seed: 0, name: '', score: '' }} className="w-40 opacity-60" />
            <MatchupBox top={{ seed: 4, name: team(3), score: generateScore(4, 1), winner: r1w1 === 'a' }} bottom={{ seed: 5, name: team(4), score: generateScore(5, 1), winner: r1w1 === 'b' }} className="w-40" />
            <MatchupBox top={{ seed: 3, name: team(2), score: generateScore(3, 1), winner: r1w2 === 'a' }} bottom={{ seed: 6, name: team(5), score: generateScore(6, 1), winner: r1w2 === 'b' }} className="w-40" />
            <MatchupBox top={{ seed: 2, name: team(1), score: generateScore(2, 1), winner: r1w3 === 'a' }} bottom={{ seed: 7, name: team(6), score: generateScore(7, 1), winner: r1w3 === 'b' }} className="w-40" />
          </div>
          <div className="space-y-4">
            <MatchupBox top={{ seed: semi1A, name: team(semi1A - 1), score: generateScore(semi1A, 2), winner: sw1 === 'a' }} bottom={{ seed: semi1B, name: team(semi1B - 1), score: generateScore(semi1B, 2), winner: sw1 === 'b' }} className="w-40" />
            <MatchupBox top={{ seed: semi2A, name: team(semi2A - 1), score: generateScore(semi2A, 2), winner: sw2 === 'a' }} bottom={{ seed: semi2B, name: team(semi2B - 1), score: generateScore(semi2B, 2), winner: sw2 === 'b' }} className="w-40" />
          </div>
          <div>
            <MatchupBox label="CHAMPIONSHIP" top={{ seed: champA, name: team(champA - 1), score: generateScore(champA, 3), winner: cw === 'a' }} bottom={{ seed: champB, name: team(champB - 1), score: generateScore(champB, 3), winner: cw === 'b' }} className="w-44" />
          </div>
        </div>
      </div>
    </BracketShell>
  )
}

function Bracket8({ team, leagueName, season, generateScore, pickWinner }: BracketProps) {
  const q1w = pickWinner(1, 8, 1)
  const q2w = pickWinner(4, 5, 1)
  const q3w = pickWinner(2, 7, 1)
  const q4w = pickWinner(3, 6, 1)
  const s1A = q1w === 'a' ? 1 : 8
  const s1B = q2w === 'a' ? 4 : 5
  const s2A = q3w === 'a' ? 2 : 7
  const s2B = q4w === 'a' ? 3 : 6
  const sw1 = pickWinner(s1A, s1B, 2)
  const sw2 = pickWinner(s2A, s2B, 2)
  const champA = sw1 === 'a' ? s1A : s1B
  const champB = sw2 === 'a' ? s2A : s2B
  const cw = pickWinner(champA, champB, 3)

  return (
    <BracketShell leagueName={leagueName} season={season} playoffTeamCount={8}>
      <div className="min-w-[750px]">
        <div className="flex justify-between mb-4 px-4">
          <div className="text-center w-1/4"><RoundHeader title="Quarterfinals" week="Week 15" /></div>
          <div className="text-center w-1/4"><RoundHeader title="Semifinals" week="Week 16" /></div>
          <div className="text-center w-1/4"><RoundHeader title="Championship" week="Week 17" /></div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-3">
            <MatchupBox top={{ seed: 1, name: team(0), score: generateScore(1, 1), winner: q1w === 'a' }} bottom={{ seed: 8, name: team(7), score: generateScore(8, 1), winner: q1w === 'b' }} className="w-40" />
            <MatchupBox top={{ seed: 4, name: team(3), score: generateScore(4, 1), winner: q2w === 'a' }} bottom={{ seed: 5, name: team(4), score: generateScore(5, 1), winner: q2w === 'b' }} className="w-40" />
            <MatchupBox top={{ seed: 2, name: team(1), score: generateScore(2, 1), winner: q3w === 'a' }} bottom={{ seed: 7, name: team(6), score: generateScore(7, 1), winner: q3w === 'b' }} className="w-40" />
            <MatchupBox top={{ seed: 3, name: team(2), score: generateScore(3, 1), winner: q4w === 'a' }} bottom={{ seed: 6, name: team(5), score: generateScore(6, 1), winner: q4w === 'b' }} className="w-40" />
          </div>
          <div className="space-y-4">
            <MatchupBox top={{ seed: s1A, name: team(s1A - 1), score: generateScore(s1A, 2), winner: sw1 === 'a' }} bottom={{ seed: s1B, name: team(s1B - 1), score: generateScore(s1B, 2), winner: sw1 === 'b' }} className="w-40" />
            <MatchupBox top={{ seed: s2A, name: team(s2A - 1), score: generateScore(s2A, 2), winner: sw2 === 'a' }} bottom={{ seed: s2B, name: team(s2B - 1), score: generateScore(s2B, 2), winner: sw2 === 'b' }} className="w-40" />
          </div>
          <div>
            <MatchupBox label="CHAMPIONSHIP" top={{ seed: champA, name: team(champA - 1), score: generateScore(champA, 3), winner: cw === 'a' }} bottom={{ seed: champB, name: team(champB - 1), score: generateScore(champB, 3), winner: cw === 'b' }} className="w-44" />
          </div>
        </div>
      </div>
    </BracketShell>
  )
}

function Bracket9({ team, leagueName, season, generateScore, pickWinner }: BracketProps) {
  const r1w1 = pickWinner(8, 9, 1)
  const r1w2 = pickWinner(5, 4, 1)
  const r1w3 = pickWinner(6, 3, 1)
  const r1w4 = pickWinner(7, 2, 1)
  const s1A = 1
  const s1B = r1w1 === 'a' ? 8 : 9
  const s2A = r1w2 === 'a' ? 5 : 4
  const s2B = r1w3 === 'a' ? 6 : 3
  const sw1 = pickWinner(s1A, s1B, 2)
  const sw2 = pickWinner(s2A, s2B, 2)
  const champA = sw1 === 'a' ? s1A : s1B
  const champB = sw2 === 'a' ? s2A : s2B
  const cw = pickWinner(champA, champB, 3)

  return (
    <BracketShell leagueName={leagueName} season={season} playoffTeamCount={9}>
      <div className="min-w-[750px]">
        <div className="flex justify-between mb-4 px-4">
          <div className="text-center w-1/4"><RoundHeader title="Play-In" week="Week 14" /></div>
          <div className="text-center w-1/4"><RoundHeader title="Quarterfinals" week="Week 15" /></div>
          <div className="text-center w-1/4"><RoundHeader title="Semifinals" week="Week 16" /></div>
          <div className="text-center w-1/4"><RoundHeader title="Championship" week="Week 17" /></div>
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-3">
            <MatchupBox top={{ seed: 1, name: team(0), bye: true }} bottom={{ seed: 0, name: '', score: '' }} className="w-36 opacity-60" />
            <MatchupBox top={{ seed: 8, name: team(7), score: generateScore(8, 1), winner: r1w1 === 'a' }} bottom={{ seed: 9, name: team(8), score: generateScore(9, 1), winner: r1w1 === 'b' }} className="w-36" />
            <MatchupBox top={{ seed: 4, name: team(3), score: generateScore(4, 1), winner: r1w2 === 'a' }} bottom={{ seed: 5, name: team(4), score: generateScore(5, 1), winner: r1w2 === 'b' }} className="w-36" />
            <MatchupBox top={{ seed: 3, name: team(2), score: generateScore(3, 1), winner: r1w3 === 'a' }} bottom={{ seed: 6, name: team(5), score: generateScore(6, 1), winner: r1w3 === 'b' }} className="w-36" />
            <MatchupBox top={{ seed: 2, name: team(1), score: generateScore(2, 1), winner: r1w4 === 'a' }} bottom={{ seed: 7, name: team(6), score: generateScore(7, 1), winner: r1w4 === 'b' }} className="w-36" />
          </div>
          <div className="space-y-3">
            <MatchupBox top={{ seed: s1A, name: team(s1A - 1), score: generateScore(s1A, 2), winner: sw1 === 'a' }} bottom={{ seed: s1B, name: team(s1B - 1), score: generateScore(s1B, 2), winner: sw1 === 'b' }} className="w-36" />
            <MatchupBox top={{ seed: s2A, name: team(s2A - 1), score: generateScore(s2A, 2), winner: sw2 === 'a' }} bottom={{ seed: s2B, name: team(s2B - 1), score: generateScore(s2B, 2), winner: sw2 === 'b' }} className="w-36" />
          </div>
          <div className="space-y-3">
            <MatchupBox top={{ seed: champA, name: team(champA - 1), score: generateScore(champA, 2) }} bottom={{ seed: champB, name: team(champB - 1), score: generateScore(champB, 2) }} className="w-36" />
          </div>
          <div>
            <MatchupBox label="CHAMPIONSHIP" top={{ seed: champA, name: team(champA - 1), score: generateScore(champA, 3), winner: cw === 'a' }} bottom={{ seed: champB, name: team(champB - 1), score: generateScore(champB, 3), winner: cw === 'b' }} className="w-40" />
          </div>
        </div>
      </div>
    </BracketShell>
  )
}
