import type { ReactNode } from 'react'

interface BadgeProps {
  children: ReactNode
  variant?: 'green' | 'red' | 'blue' | 'gray' | 'amber'
  size?: 'sm' | 'md'
}

const VARIANTS = {
  green: 'bg-green-100 text-green-800',
  red:   'bg-red-100 text-red-800',
  blue:  'bg-brand-100 text-brand-800',
  gray:  'bg-gray-100 text-gray-700',
  amber: 'bg-amber-100 text-amber-800',
}

export function Badge({ children, variant = 'gray', size = 'sm' }: BadgeProps) {
  const sz = size === 'sm' ? 'text-xs px-2 py-0.5' : 'text-sm px-2.5 py-1'
  return (
    <span className={`inline-flex items-center rounded-full font-medium ${sz} ${VARIANTS[variant]}`}>
      {children}
    </span>
  )
}
