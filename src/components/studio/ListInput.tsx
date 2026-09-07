'use client'

import { Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/Button'
import { defaultsFor, type ListField } from '@/lib/kie/fields'
import { cn } from '@/lib/utils'
import { FieldRenderer } from './FieldRenderer'

interface ListInputProps {
  field: ListField
  value: unknown
  onChange: (value: Record<string, unknown>[]) => void
}

/**
 * A repeatable group of fields.
 *
 * Four models want an array of objects rather than a value: a cast of
 * speakers, a dialogue line by line, a shot list. Each entry is rendered with
 * the same controls as the rest of the form, so a voice picker inside a row
 * behaves exactly like one outside it.
 *
 * Rows are numbered rather than draggable. Order matters to these models, and
 * a number that is visible is easier to reason about than a handle that has
 * to be discovered.
 */
export function ListInput({ field, value, onChange }: ListInputProps) {
  const rows = (Array.isArray(value) ? value : []) as Record<string, unknown>[]

  const max = field.maxItems ?? 20
  const min = Math.max(1, field.minItems ?? 1)
  const label = field.itemLabel ?? 'Entry'

  const update = (index: number, name: string, next: unknown) =>
    onChange(
      rows.map((row, i) => (i === index ? { ...row, [name]: next } : row)),
    )

  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div
          key={index}
          className="space-y-4 rounded-xl border border-line bg-raised/40 p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-faint">
              {label} {index + 1}
            </span>

            <button
              type="button"
              onClick={() => onChange(rows.filter((_, i) => i !== index))}
              // Below the minimum there is nothing to remove: the model needs
              // at least this many.
              disabled={rows.length <= min}
              aria-label={`Remove ${label.toLowerCase()} ${index + 1}`}
              className={cn(
                'grid size-7 place-items-center rounded-lg text-ink-faint transition-colors',
                rows.length <= min
                  ? 'cursor-not-allowed opacity-40'
                  : 'hover:bg-overlay hover:text-danger',
              )}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>

          {field.item.map((child) => (
            <FieldRenderer
              key={child.name}
              field={child}
              value={row?.[child.name]}
              onChange={(next) => update(index, child.name, next)}
            />
          ))}
        </div>
      ))}

      <Button
        size="sm"
        variant="secondary"
        className="w-full"
        disabled={rows.length >= max}
        onClick={() => onChange([...rows, defaultsFor(field.item)])}
      >
        <Plus className="size-3.5" />
        Add {label.toLowerCase()}
        {rows.length >= max ? ` (${max} is the limit)` : ''}
      </Button>
    </div>
  )
}
