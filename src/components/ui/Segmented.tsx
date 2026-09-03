'use client'

import { cn } from '@/lib/utils'

interface SegmentedProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string; hint?: string }[]
  /** Wrap onto multiple lines instead of scrolling: used in dense panels. */
  wrap?: boolean
  className?: string
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  wrap,
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      className={cn(
        'gap-1 rounded-xl border border-line bg-raised p-1',
        wrap ? 'flex flex-wrap' : 'flex',
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            title={opt.hint}
            className={cn(
              'flex-1 rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-150',
              wrap && 'flex-none',
              active
                ? 'bg-overlay text-ink shadow-[inset_0_0_0_1px_var(--color-line-bright)]'
                : 'text-ink-faint hover:text-ink-muted',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
