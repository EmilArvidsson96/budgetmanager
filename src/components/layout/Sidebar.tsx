import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  CalendarDays,
  CalendarRange,
  Waves,
  Settings,
  Upload,
  TrendingUp,
  HelpCircle,
  Receipt,
  ListTree,
  MoreHorizontal,
} from 'lucide-react'

const PRIMARY_ITEMS = [
  { to: '/manad',         icon: CalendarDays,  label: 'Månadsbudget',  short: 'Månad' },
  { to: '/ar',            icon: CalendarRange, label: 'Årsbudget',     short: 'År' },
  { to: '/transaktioner', icon: ListTree,      label: 'Transaktioner', short: 'Trans.' },
  { to: '/importera',     icon: Upload,        label: 'Importera',     short: 'Import' },
]

const SECONDARY_ITEMS = [
  { to: '/likviditet',    icon: Waves,       label: 'Likviditet' },
  { to: '/kvitton',       icon: Receipt,     label: 'Matkvitton' },
  { to: '/installningar', icon: Settings,    label: 'Inställningar' },
  { to: '/hjalp',         icon: HelpCircle,  label: 'Hjälp' },
]

const ALL_ITEMS = [...PRIMARY_ITEMS, ...SECONDARY_ITEMS]

export function Sidebar() {
  const [moreOpen, setMoreOpen] = useState(false)
  const location = useLocation()
  const isSecondaryActive = SECONDARY_ITEMS.some(item =>
    location.pathname.startsWith(item.to)
  )

  return (
    <>
      {/* ── Desktop sidebar ── */}
      <aside className="hidden md:flex w-56 min-h-screen bg-warm-200 flex-col py-6 px-3 shrink-0 border-r border-warm-300">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-3 mb-8">
          <div className="w-7 h-7 rounded-lg bg-brand-500 flex items-center justify-center shrink-0 shadow-sm">
            <TrendingUp className="w-4 h-4 text-white" />
          </div>
          <span className="text-warm-900 font-semibold text-sm tracking-tight leading-tight">
            Budget&shy;hanteraren
          </span>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5">
          {ALL_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150
                ${isActive
                  ? 'bg-warm-100 text-warm-900 shadow-sm'
                  : 'text-warm-600 hover:bg-warm-300 hover:text-warm-900'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className={`w-4 h-4 shrink-0 transition-colors ${isActive ? 'text-brand-500' : ''}`} />
                  {label}
                </>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 text-[11px] text-warm-500 tracking-wide">
          v1.0
        </div>
      </aside>

      {/* ── Mobile bottom nav ── */}
      <>
        {/* Backdrop */}
        {moreOpen && (
          <div
            className="md:hidden fixed inset-0 z-30"
            onClick={() => setMoreOpen(false)}
          />
        )}

        {/* More panel */}
        <div
          className={`md:hidden fixed inset-x-0 z-40 bg-warm-200 border-t border-warm-300 transition-all duration-200 ease-in-out
            ${moreOpen ? 'bottom-14 opacity-100 pointer-events-auto' : 'bottom-14 opacity-0 pointer-events-none translate-y-2'}`}
        >
          <div className="grid grid-cols-4 gap-1 p-2">
            {SECONDARY_ITEMS.map(({ to, icon: Icon, label }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1.5 py-3 rounded-xl text-[11px] font-medium transition-colors
                  ${isActive ? 'text-brand-500 bg-warm-300' : 'text-warm-600 hover:text-warm-900 hover:bg-warm-300'}`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={`w-5 h-5 ${isActive ? 'text-brand-500' : ''}`} />
                    {label}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>

        {/* Bottom nav bar */}
        <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-warm-200 border-t border-warm-300 h-14">
          <div className="flex h-full">
            {PRIMARY_ITEMS.map(({ to, icon: Icon, short }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  `flex-1 flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors
                  ${isActive ? 'text-brand-500' : 'text-warm-500 hover:text-warm-800'}`
                }
              >
                <Icon className="w-5 h-5" />
                {short}
              </NavLink>
            ))}
            <button
              onClick={() => setMoreOpen(prev => !prev)}
              className={`flex-1 flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors
                ${moreOpen || isSecondaryActive ? 'text-brand-500' : 'text-warm-500 hover:text-warm-800'}`}
            >
              <MoreHorizontal className="w-5 h-5" />
              Mer
            </button>
          </div>
        </nav>
      </>
    </>
  )
}
