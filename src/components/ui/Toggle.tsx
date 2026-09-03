'use client'

import { cn } from '@/lib/utils'

interface ToggleProps {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
  description?: string
  id?: string
}

export function Toggle({ checked, onChange, label, description, id }: ToggleProps) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start justify-between gap-4 py-0.5"
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink">{label}</span>
        {description && (
          <span className="mt-0.5 block text-[12px] leading-relaxed text-ink-faint">
            {description}
          </span>
        )}
      </span>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-accent' : 'bg-line-bright',
        )}
      >
        <span
          className={cn(
            'absolute top-[3px] size-4 rounded-full bg-white transition-transform duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
            checked ? 'translate-x-[19px]' : 'translate-x-[3px]',
          )}
        />
      </button>
    </label>
  )
}
