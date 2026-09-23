import Link from 'next/link'
import { Flame, ScrollText, ShieldCheck, Trophy, UserCircle2 } from 'lucide-react'

const NAV_ITEMS = [
  { id: 'fantasy', label: 'Fantasy', href: '/dashboard', icon: Trophy },
  { id: 'scores', label: 'Scores', href: '/app/legacy-score', icon: ShieldCheck },
  { id: 'picks', label: 'Picks', href: '/brackets', icon: ScrollText },
  { id: 'feed', label: 'Feed', href: '/feed', icon: Flame },
  { id: 'account', label: 'Account', href: '/profile', icon: UserCircle2 },
] as const

export default function BottomNav({
  active = 'fantasy',
}: {
  active?: (typeof NAV_ITEMS)[number]['id']
}) {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-white/10 bg-[#0B0F1E]/98 px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur">
      <div className="mx-auto grid max-w-md grid-cols-5 gap-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = item.id === active
          return (
            <Link
              key={item.id}
              href={item.href}
              className="flex min-h-[52px] flex-col items-center justify-center gap-1 rounded-xl text-center"
            >
              <Icon className={`h-4.5 w-4.5 ${isActive ? 'text-[#00D4AA]' : 'text-[#4A5A72]'}`} />
              <span className={`text-[11px] font-semibold ${isActive ? 'text-[#00D4AA]' : 'text-[#4A5A72]'}`}>
                {item.label}
              </span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
