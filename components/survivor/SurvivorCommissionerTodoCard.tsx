'use client'

import Link from 'next/link'
import { CheckCircle2, CircleAlert, Info } from 'lucide-react'
import type { SurvivorCommissionerTodo } from '@/lib/survivor/survivorCommissionerTodo'

/** The commissioner's weekly to-do list. Usually one line: nothing needed. */
export function SurvivorCommissionerTodoCard({ todo }: { todo: SurvivorCommissionerTodo }) {
  const clear = todo.actionCount === 0
  return (
    <section
      aria-labelledby="survivor-commissioner-todo-title"
      data-testid="survivor-commissioner-todo"
      className={`rounded-2xl border p-4 sm:p-5 ${clear ? 'border-emerald-400/30 bg-emerald-500/[0.07]' : 'border-amber-400/40 bg-amber-500/10'}`}
    >
      <div className="flex items-start gap-3">
        {clear
          ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden />
          : <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden />}
        <div className="min-w-0">
          <h2 id="survivor-commissioner-todo-title" className="text-xs font-bold uppercase tracking-wide text-white/60">
            {todo.week != null ? `Your to-do · week ${todo.week}` : 'Your to-do'}
          </h2>
          <p className={`mt-1 text-sm font-semibold ${clear ? 'text-emerald-100' : 'text-amber-100'}`}>{todo.headline}</p>
        </div>
      </div>
      {todo.items.length > 0 && (
        <ul className="mt-4 space-y-2">
          {todo.items.map(item => (
            <li
              key={item.id}
              data-testid={`survivor-commissioner-todo-${item.id}`}
              className={`flex flex-col gap-3 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between ${item.tone === 'action' ? 'border-amber-400/30 bg-black/20' : 'border-white/10 bg-white/[0.03]'}`}
            >
              <div className="flex min-w-0 items-start gap-2">
                {item.tone === 'action'
                  ? <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" aria-hidden />
                  : <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-300" aria-hidden />}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{item.title}</p>
                  <p className="mt-0.5 text-xs text-white/65">{item.body}</p>
                </div>
              </div>
              <Link
                href={item.href}
                className={`shrink-0 self-start rounded-lg border px-3 py-2 text-xs font-semibold sm:self-center ${item.tone === 'action' ? 'border-amber-300/50 text-amber-100 hover:bg-amber-400/10' : 'border-white/20 text-white/80 hover:bg-white/5'}`}
              >
                {item.cta}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
