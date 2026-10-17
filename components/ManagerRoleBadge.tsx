type Role = 'commissioner' | 'co_commissioner' | 'orphan' | 'member'

const ROLE_CONFIG = {
  commissioner:    { label: 'C',  cls: 'bg-blue-500/25 text-blue-300 border-blue-500/50' },
  co_commissioner: { label: 'CC', cls: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  orphan:          { label: 'O',  cls: 'bg-cyan-500/20  text-cyan-400  border-cyan-500/30'  },
  member:          null,
} satisfies Record<Role, { label: string; cls: string } | null>

export function ManagerRoleBadge({ role }: { role: string }) {
  const cfg = ROLE_CONFIG[role as Role]
  if (!cfg) return null
  return <span className={`text-[11px] font-black px-1.5 py-0.5 rounded-full border ${cfg.cls}`}>{cfg.label}</span>
}
