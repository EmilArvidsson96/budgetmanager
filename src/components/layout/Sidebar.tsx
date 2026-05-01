import { NavLink } from 'react-router-dom'
import {
  CalendarDays,
  CalendarRange,
  Waves,
  Settings,
  Upload,
  TrendingUp,
} from 'lucide-react'

const NAV_ITEMS = [
  { to: '/manad',       icon: CalendarDays,  label: 'Månadsbudget' },
  { to: '/ar',          icon: CalendarRange, label: 'Årsbudget' },
  { to: '/likviditet',  icon: Waves,         label: 'Likviditet' },
  { to: '/importera',   icon: Upload,        label: 'Importera' },
  { to: '/installningar', icon: Settings,    label: 'Inställningar' },
]

export function Sidebar() {
  return (
    <aside className="w-56 min-h-screen bg-gray-950 flex flex-col py-6 px-3 shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-3 mb-8">
        <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center">
          <TrendingUp className="w-5 h-5 text-white" />
        </div>
        <span className="text-white font-semibold text-sm leading-tight">
          Budget&shy;hanteraren
        </span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1">
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors
              ${isActive
                ? 'bg-brand-600 text-white'
                : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`
            }
          >
            <Icon className="w-4 h-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="px-3 text-xs text-gray-600">
        Budgethanteraren v1
      </div>
    </aside>
  )
}
