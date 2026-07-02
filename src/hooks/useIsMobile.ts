import { useEffect, useState } from 'react'

// Matches Tailwind's `md` breakpoint (768px). Anything narrower is treated as a
// phone so we can adapt touch-first affordances — currently chart tooltips.
// The .98 mirrors Tailwind's own max-width boundary so this JS query and the
// `md:` CSS overrides flip at exactly the same point (no fractional-width gap).
const MOBILE_QUERY = '(max-width: 767.98px)'

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches
  )

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setIsMobile(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  return isMobile
}

// On phones we pin the Recharts tooltip to the top of the plot (y = 0) so it
// sits above the bars/lines instead of following the finger over the very data
// point being inspected. x is left undefined so it still tracks the active point
// horizontally (Recharts clamps it inside the chart). On desktop we pass
// `undefined` for the whole prop, keeping the default cursor-following behaviour.
export const MOBILE_TOOLTIP_POSITION = { y: 0 } as const
