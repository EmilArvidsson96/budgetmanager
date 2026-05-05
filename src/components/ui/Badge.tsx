import type { ReactNode } from 'react'

interface BadgeProps {
  children: ReactNode
  variant?: 'green' | 'red' | 'blue' | 'gray' | 'amber'
  size?: 'sm' | 'md'
}

const VARIANTS = {
  green: 'bg-emerald-50 text-emerald-700',
  red:   'bg-red-50 text-red-600',
  blue:  'bg-brand-50 text-brand-700',
  gray:  'bg-gray-100 text-gray-500',
  amber: 'bg-amber-50 text-amber-700',
}

export function Badge({ children, variant = 'gray', size = 'sm' }: BadgeProps) {
  const sz = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-0.5'
  return (
    <span className={`inline-flex items-center rounded-md font-medium tracking-wide ${sz} ${VARIANTS[variant]}`}>
      {children}
    </span>
  )
}
