'use client'

import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface FieldShellProps {
  label: string
  htmlFor?: string
  description?: string
  required?: boolean
  /** Right-aligned slot for counters, randomize buttons, current values. */
  aside?: ReactNode
  children: ReactNode
  className?: string
}

/** Consistent label / description / control stack used by every input. */
export function FieldShell({
  label,
  htmlFor,
  description,
  required,
  aside,
  children,
  className,
}: FieldShellProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label
          htmlFor={htmlFor}
          className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-muted"
        >
          {label}
          {required && <span className="ml-1 text-accent">*</span>}
        </label>
        {aside && <div className="text-[11px] tabular-nums text-ink-faint">{aside}</div>}
      </div>
      {children}
      {description && (
        <p className="text-[12px] leading-relaxed text-ink-faint">{description}</p>
      )}
    </div>
  )
}

export const inputClass = cn(
  'w-full rounded-xl border border-line bg-raised px-3 py-2.5 text-sm text-ink',
  'placeholder:text-ink-faint transition-colors',
  'hover:border-line-bright focus:border-accent focus:outline-none',
)
