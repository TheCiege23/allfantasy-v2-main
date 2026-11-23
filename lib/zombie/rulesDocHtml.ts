/**
 * The stored rules document as HTML and plain text. Pure: no prisma, so a DB-free page (app/e2e/zombie) and
 * tests can build it. lib/zombie/rulesDocGenerator.ts re-exports both.
 */
import type { ZombieRulesDocument } from '@prisma/client'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function whispererRulesWithTradePolicy(section: string): string {
  const rule = 'Survivors and Whisperers may trade; Zombies cannot.'
  const current = section.replaceAll('Whisperers cannot trade players at any time.', '').trim()
  return current.includes(rule) ? current : `${current}\n${rule}`
}

export function getRulesDocAsHtml(doc: ZombieRulesDocument): string {
  const sec = (icon: string, title: string, body: string) =>
    `<section class="zombie-rules-section mb-6"><h2 class="zombie-rules-heading text-[14px] font-bold text-[var(--zombie-text-full)] mb-2"><span aria-hidden="true">${esc(icon)}</span> ${esc(title)}</h2><pre class="whitespace-pre-wrap text-[12px] leading-relaxed opacity-90">${esc(body)}</pre></section>`

  return `<article class="zombie-rules-doc max-w-3xl">
  ${doc.isPaid ? '<p class="zombie-rules-paid-badge mb-4 inline-block rounded-lg bg-amber-500/15 px-3 py-1 text-[12px] font-bold text-amber-200/90">PAID LEAGUE</p>' : '<p class="zombie-rules-threshold-badge mb-4 inline-block rounded-lg bg-sky-500/15 px-3 py-1 text-[12px] font-bold text-sky-200/80">FREE LEAGUE</p>'}
  ${sec('🧟', 'Overview', doc.sectionOverview)}
  ${sec('🩸', 'Infection', doc.sectionInfection)}
  ${sec('🎭', 'The Whisperer', whispererRulesWithTradePolicy(doc.sectionWhisperer))}
  ${sec('🧍', 'Survivors', doc.sectionSurvivor)}
  ${sec('🧟', 'The Horde', doc.sectionZombie)}
  ${sec('📊', 'Scoring', doc.sectionScoring)}
  ${sec('🧾', 'Roster', doc.sectionRoster)}
  ${sec('⚡', 'Ambushes', doc.sectionAmbush)}
  ${sec('🔥', 'Bashing', doc.sectionBashing)}
  ${sec('💀', 'Mauling', doc.sectionMauling)}
  ${sec('🧪', 'Serums', doc.sectionSerums)}
  ${sec('⚔️', 'Weapons', doc.sectionWeapons)}
  ${sec('💰', 'Winnings / Rewards', doc.sectionWinnings)}
  ${sec('🌍', 'Universe', doc.sectionUniverseMovement)}
  ${sec('📅', 'Weekly Schedule', doc.sectionWeeklyTiming)}
  ${sec('🤖', '@Chimmy', doc.sectionChimmy)}
  ${sec('🪙', 'Paid vs Free', doc.sectionPaidVsFree)}
</article>`
}

export function getRulesDocAsText(doc: ZombieRulesDocument): string {
  const parts = [
    doc.sectionOverview,
    doc.sectionInfection,
    whispererRulesWithTradePolicy(doc.sectionWhisperer),
    doc.sectionSurvivor,
    doc.sectionZombie,
    doc.sectionScoring,
    doc.sectionRoster,
    doc.sectionAmbush,
    doc.sectionBashing,
    doc.sectionMauling,
    doc.sectionSerums,
    doc.sectionWeapons,
    doc.sectionWinnings,
    doc.sectionUniverseMovement,
    doc.sectionWeeklyTiming,
    doc.sectionChimmy,
    doc.sectionPaidVsFree,
  ]
  return parts.join('\n\n━━━━━━━━━━━━━━━━━━━━\n\n')
}
