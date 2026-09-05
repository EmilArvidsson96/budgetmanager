import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Sidebar } from './Sidebar'
import { ReportIssueButton } from '../feedback/ReportIssueButton'

interface LayoutProps {
  children: ReactNode
}

export function Layout({ children }: LayoutProps) {
  const mainRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(false)

  // Track whether the scrollable content is near its end, so the floating
  // report button can lift clear of trailing content (and the mobile nav bar)
  // instead of covering it. Re-checks on scroll, content resize, and viewport resize.
  useEffect(() => {
    const main = mainRef.current
    const content = contentRef.current
    if (!main || !content) return

    const BOTTOM_THRESHOLD = 32
    const checkBottom = () => {
      const distance = main.scrollHeight - main.scrollTop - main.clientHeight
      setAtBottom(distance < BOTTOM_THRESHOLD)
    }

    checkBottom()
    main.addEventListener('scroll', checkBottom, { passive: true })
    const resizeObserver = new ResizeObserver(checkBottom)
    resizeObserver.observe(content)
    window.addEventListener('resize', checkBottom)
    return () => {
      main.removeEventListener('scroll', checkBottom)
      resizeObserver.disconnect()
      window.removeEventListener('resize', checkBottom)
    }
  }, [])

  return (
    <div className="flex min-h-screen bg-warm-100 font-sans">
      <Sidebar />
      <main ref={mainRef} className="flex-1 overflow-auto">
        <div ref={contentRef} className="max-w-5xl mx-auto px-4 md:px-8 py-6 md:py-10 pb-24 md:pb-10">
          {children}
        </div>
      </main>
      <ReportIssueButton atBottom={atBottom} />
    </div>
  )
}

interface PageHeaderProps {
  title: string
  subtitle?: string
  actions?: ReactNode
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-6 md:mb-8">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{title}</h1>
        {subtitle && <p className="text-sm text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 sm:justify-end sm:shrink-0">{actions}</div>}
    </div>
  )
}
