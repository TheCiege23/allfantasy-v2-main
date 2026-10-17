'use client'

import { HelpCircle } from 'lucide-react'

export interface SurvivorCommandHelpProps {
  compact?: boolean
}

/**
 * Official @Chimmy command help for Survivor leagues. Rendered in Elimination Council view and linked from AI panel.
 */
export function SurvivorCommandHelp({ compact }: SurvivorCommandHelpProps) {
  const commands = [
    { cmd: '@Chimmy vote [manager]', desc: 'Cast your vote for who to eliminate (e.g. @Chimmy vote Team Alpha)' },
    { cmd: '@Chimmy jury vote [finalist]', desc: 'Cast your final jury vote once the Survivor finale opens' },
    { cmd: '@Chimmy play idol [idol]', desc: 'Play a self-targeting or generic idol before votes are read' },
    { cmd: '@Chimmy play idol [idol] on [manager]', desc: 'Target a manager for powers like protection, vote nullifier, or waiver freeze' },
    { cmd: '@Chimmy play idol steal_player on [manager] pick [player]', desc: 'Steal a specific player from another active roster and move any attached idol with that player' },
    { cmd: '@Chimmy play idol swap_starter on [manager] swap [bench] for [starter]', desc: 'Force a lineup swap on a roster with editable starter slots' },
    { cmd: '@Chimmy submit challenge [choice]', desc: 'Submit your challenge/mini-game choice before lock' },
    { cmd: '@Chimmy confirm tribe decision [choice]', desc: 'Confirm tribe consensus for a tribe-level decision' },
  ]

  if (compact) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-amber-300">
          <HelpCircle className="h-3.5 w-3.5" /> @Chimmy commands
        </p>
        <ul className="space-y-1 text-xs text-white/70">
          {commands.map((c) => (
            <li key={c.cmd}>
              <code className="text-cyan-300">{c.cmd}</code> — {c.desc}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
        <HelpCircle className="h-5 w-5 text-amber-400" />
        Official @Chimmy command help
      </h3>
      <p className="mb-4 text-sm text-white/60">
        Use these commands in league or tribe chat. Chimmy will process votes, idol plays, and challenge submissions.
        When your host runs prop or tribe challenges, they may take the first locked submission only — confirm deadlines with
        your commissioner.
      </p>
      <ul className="space-y-3">
        {commands.map((c) => (
          <li key={c.cmd} className="flex flex-col gap-1 rounded-lg border border-white/5 bg-black/20 px-3 py-2">
            <code className="text-sm font-medium text-cyan-300">{c.cmd}</code>
            <span className="text-sm text-white/70">{c.desc}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
