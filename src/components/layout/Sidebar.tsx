import { NavLink } from 'react-router-dom'
import {
  CalendarDays,
  CalendarRange,
  Waves,
  Settings,
  Upload,
  TrendingUp,
  HelpCircle,
} from 'lucide-react'

const NAV_ITEMS = [
  { to: '/manad',          icon: CalendarDays,  label: 'Månadsbudget',  short: 'Månad' },
  { to: '/ar',             icon: CalendarRange, label: 'Årsbudget',     short: 'År' },
  { to: '/likviditet',     icon: Waves,         label: 'Likviditet',    short: 'Likv.' },
  { to: '/importera',      icon: Upload,        label: 'Importera',     short: 'Import' },
  { to: '/installningar',  icon: Settings,      label: 'Inställningar', short: 'Inst.' },
  { to: '/hjalp',          icon: HelpCircle,    label: 'Hjälp',         short: 'Hjälp' },
]

export function Sidebar() {
  return (
    <>
      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex w-56 min-h-screen bg-zinc-950 flex-col py-6 px-3 shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-3 mb-8">
          <div className="w-7 h-7 rounded-lg bg-brand-500 flex items-center justify-center shrink-0">
            <TrendingUp className="w-4 h-4 text-white" />
          </div>
          <span className="text-white font-semibold text-sm tracking-tight leading-tight">
            Budget&shy;hanteraren
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors duration-150
                ${isActive
                  ? 'bg-zinc-800 text-white'
                  : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-brand-400' : ''}`} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 text-[11px] text-zinc-600 tracking-wide">
          v1.0
        </div>
      </aside>

      {/* ── Mobile bottom nav ── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-100">
        <div className="flex">
          {NAV_ITEMS.map(({ to, icon: Icon, short }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors
                ${isActive ? 'text-brand-600' : 'text-gray-400'}`
              }
            >
              <Icon className="w-5 h-5" />
              {short}
            </NavLink>
          ))}
        </div>
      </nav>
    </>
  )
}
