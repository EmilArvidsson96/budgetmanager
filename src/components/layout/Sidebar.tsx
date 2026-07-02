import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { APP_VERSION } from '../../version'
import {
  LineChart,
  CheckCircle2,
  Settings,
  TrendingUp,
  HelpCircle,
  Receipt,
  ListTree,
  List,
  FileText,
  MoreHorizontal,
  X,
} from 'lucide-react'

const NAV_ITEMS = [
  { to: '/plan',           icon: LineChart,     label: 'Plan',           short: 'Plan' },
  { to: '/floede',         icon: ListTree,      label: 'Flöde',          short: 'Flöde' },
  { to: '/transaktioner',  icon: List,          label: 'Transaktioner',  short: 'Trans.' },
  { to: '/avstamning',     icon: CheckCircle2,  label: 'Avstämning',     short: 'Avst.' },
  { to: '/rapport',        icon: FileText,      label: 'Rapport',        short: 'Rapport' },
  { to: '/kvitton',        icon: Receipt,       label: 'Matkvitton',     short: 'Kvitto' },
  { to: '/installningar',  icon: Settings,      label: 'Inställningar',  short: 'Inst.' },
  { to: '/hjalp',          icon: HelpCircle,    label: 'Hjälp',          short: 'Hjälp' },
]

// The mobile bottom bar only has room for a handful of items before it gets
// cramped, so we keep the four most-used sections in the bar and tuck the rest
// behind a "Mer" sheet. Desktop still shows the full list in the sidebar.
const PRIMARY_PATHS = ['/plan', '/floede', '/avstamning', '/rapport']
const primaryItems = NAV_ITEMS.filter((i) => PRIMARY_PATHS.includes(i.to))
const overflowItems = NAV_ITEMS.filter((i) => !PRIMARY_PATHS.includes(i.to))

export function Sidebar() {
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)

  // Close the sheet whenever the route changes (item picked, browser back, …).
  // Tracking the previous path and adjusting during render is React's recommended
  // alternative to a route-watching effect.
  const [prevPath, setPrevPath] = useState(location.pathname)
  if (location.pathname !== prevPath) {
    setPrevPath(location.pathname)
    setMoreOpen(false)
  }

  const overflowActive = overflowItems.some((i) => location.pathname.startsWith(i.to))

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
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
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
          v{APP_VERSION}
        </div>
      </aside>

      {/* ── Mobile "Mer" sheet backdrop ── */}
      {moreOpen && (
        <div
          className="md:hidden fixed inset-0 z-30 bg-black/25"
          onClick={() => setMoreOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Mobile bottom nav ── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-warm-200 border-t border-warm-300">
        {/* Overflow sheet, anchored just above the bar */}
        {moreOpen && (
          <div className="absolute bottom-full inset-x-0 mb-2 px-3">
            <div className="bg-warm-100 border border-warm-300 rounded-2xl shadow-xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-warm-300">
                <span className="text-xs font-semibold uppercase tracking-wide text-warm-600">Mer</span>
                <button
                  onClick={() => setMoreOpen(false)}
                  className="p-1 -mr-1 rounded-lg text-warm-500 hover:text-warm-900 hover:bg-warm-200 transition-colors"
                  aria-label="Stäng"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {overflowItems.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-3 text-sm font-medium transition-colors
                    ${isActive ? 'bg-warm-200 text-warm-900' : 'text-warm-700 hover:bg-warm-200'}`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon className={`w-5 h-5 shrink-0 ${isActive ? 'text-brand-500' : 'text-warm-500'}`} />
                      {label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        )}

        <div className="flex">
          {primaryItems.map(({ to, icon: Icon, short }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors
                ${isActive ? 'text-brand-500' : 'text-warm-500'}`
              }
            >
              <Icon className="w-5 h-5" />
              {short}
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            aria-label="Fler sektioner"
            className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors
            ${moreOpen || overflowActive ? 'text-brand-500' : 'text-warm-500'}`}
          >
            <MoreHorizontal className="w-5 h-5" />
            Mer
          </button>
        </div>
      </nav>
    </>
  )
}
