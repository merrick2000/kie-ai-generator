'use client'

import { Dices, Maximize2, Minimize2 } from 'lucide-react'
import { useId, useState } from 'react'

import { FieldShell, inputClass } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { Toggle } from '@/components/ui/Toggle'
import type {
  AssetField,
  Field,
  NumberField,
  PromptField,
  SelectField,
  ToggleField,
} from '@/lib/kie/fields'
import { cn } from '@/lib/utils'
import { AssetInput } from './AssetInput'
import { RatioPicker } from './RatioPicker'

interface FieldRendererProps {
  field: Field
  value: unknown
  onChange: (value: unknown) => void
}

/** Segmented controls stay readable up to about four options. */
const SEGMENTED_MAX_OPTIONS = 4

export function FieldRenderer({ field, value, onChange }: FieldRendererProps) {
  const id = useId()
  const [expanded, setExpanded] = useState(false)

  switch (field.kind) {
    case 'prompt':
    case 'textarea': {
      const f = field as PromptField
      const text = (value as string) ?? ''
      const isPrompt = f.kind === 'prompt'

      return (
        <FieldShell
          label={f.label}
          htmlFor={id}
          description={f.description}
          required={f.required}
          aside={
            <span className="flex items-center gap-2">
              {f.maxLength && (
                <span className={cn(text.length > f.maxLength && 'text-danger')}>
                  {text.length.toLocaleString()}/{f.maxLength.toLocaleString()}
                </span>
              )}
              {isPrompt && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  title={expanded ? 'Shrink' : 'Expand'}
                  aria-label={expanded ? 'Shrink the prompt field' : 'Expand the prompt field'}
                  className="grid size-5 place-items-center rounded text-ink-faint transition-colors hover:bg-overlay hover:text-ink"
                >
                  {expanded ? (
                    <Minimize2 className="size-3" />
                  ) : (
                    <Maximize2 className="size-3" />
                  )}
                </button>
              )}
            </span>
          }
        >
          {/*
            Resizable by drag as well as by the toggle: a long prompt is hard
            to edit through a four-line window, and how much room it deserves
            is the writer's call, not ours.
          */}
          <textarea
            id={id}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            placeholder={f.placeholder}
            rows={isPrompt ? (expanded ? 16 : 4) : 2}
            className={cn(
              inputClass,
              'resize-y leading-relaxed',
              isPrompt && 'min-h-[92px]',
            )}
          />
        </FieldShell>
      )
    }

    case 'text': {
      const f = field as PromptField
      return (
        <FieldShell
          label={f.label}
          htmlFor={id}
          description={f.description}
          required={f.required}
        >
          <input
            id={id}
            type="text"
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={f.placeholder}
            maxLength={f.maxLength}
            className={inputClass}
          />
        </FieldShell>
      )
    }

    case 'ratio': {
      const f = field as SelectField
      return (
        <FieldShell label={f.label} description={f.description} required={f.required}>
          <RatioPicker
            value={(value as string) ?? ''}
            options={f.options}
            onChange={onChange}
          />
        </FieldShell>
      )
    }

    case 'select': {
      const f = field as SelectField
      const hint = f.options.find((o) => o.value === value)?.hint

      if (f.options.length <= SEGMENTED_MAX_OPTIONS) {
        return (
          <FieldShell
            label={f.label}
            description={hint ?? f.description}
            required={f.required}
          >
            <Segmented
              value={(value as string) ?? ''}
              options={f.options}
              onChange={onChange}
            />
          </FieldShell>
        )
      }

      return (
        <FieldShell
          label={f.label}
          htmlFor={id}
          description={hint ?? f.description}
          required={f.required}
        >
          <select
            id={id}
            value={(value as string) ?? ''}
            onChange={(e) => onChange(e.target.value)}
            className={cn(inputClass, 'cursor-pointer appearance-none pr-8')}
            style={{
              backgroundImage:
                "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='none' stroke='%236b6b78' stroke-width='1.5' d='M3 4.5 6 7.5 9 4.5'/%3E%3C/svg%3E\")",
              backgroundRepeat: 'no-repeat',
              backgroundPosition: 'right 12px center',
            }}
          >
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FieldShell>
      )
    }

    case 'toggle': {
      const f = field as ToggleField
      return (
        <Toggle
          id={id}
          checked={Boolean(value)}
          onChange={onChange}
          label={f.label}
          description={f.description}
        />
      )
    }

    case 'slider': {
      const f = field as NumberField
      const num = typeof value === 'number' ? value : (f.default ?? f.min ?? 0)
      return (
        <FieldShell
          label={f.label}
          htmlFor={id}
          description={f.description}
          aside={<span>{num.toFixed(2)}</span>}
        >
          <input
            id={id}
            type="range"
            min={f.min ?? 0}
            max={f.max ?? 1}
            step={f.step ?? 0.01}
            value={num}
            onChange={(e) => onChange(Number(e.target.value))}
            className="w-full"
          />
        </FieldShell>
      )
    }

    case 'number': {
      const f = field as NumberField
      const num = value === '' || value == null ? '' : Number(value)
      const showSlider = f.min != null && f.max != null && f.max - f.min <= 30

      return (
        <FieldShell
          label={f.label}
          htmlFor={id}
          description={f.description}
          aside={showSlider ? <span>{num || f.min}</span> : undefined}
        >
          {showSlider ? (
            <input
              id={id}
              type="range"
              min={f.min}
              max={f.max}
              step={f.step ?? 1}
              value={num || f.min}
              onChange={(e) => onChange(Number(e.target.value))}
              className="w-full"
            />
          ) : (
            <input
              id={id}
              type="number"
              min={f.min}
              max={f.max}
              step={f.step ?? 1}
              value={num}
              onChange={(e) =>
                onChange(e.target.value === '' ? '' : Number(e.target.value))
              }
              className={inputClass}
            />
          )}
        </FieldShell>
      )
    }

    case 'seed': {
      const f = field as NumberField
      return (
        <FieldShell
          label={f.label}
          htmlFor={id}
          description={f.description}
          aside={
            <button
              type="button"
              onClick={() =>
                onChange(Math.floor(Math.random() * (f.max ?? 2147483647)))
              }
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-ink-faint transition-colors hover:bg-overlay hover:text-accent"
            >
              <Dices className="size-3" />
              Random
            </button>
          }
        >
          <input
            id={id}
            type="number"
            min={f.min}
            max={f.max}
            value={value === '' || value == null ? '' : Number(value)}
            onChange={(e) =>
              onChange(e.target.value === '' ? '' : Number(e.target.value))
            }
            placeholder="Auto"
            className={cn(inputClass, 'font-mono tabular-nums')}
          />
        </FieldShell>
      )
    }

    case 'image':
    case 'images':
    case 'audio':
    case 'video':
    case 'videos': {
      const f = field as AssetField
      return (
        <FieldShell label={f.label} description={f.description} required={f.required}>
          <AssetInput
            field={f}
            value={(value as string | string[]) ?? (f.kind === 'images' || f.kind === 'videos' ? [] : '')}
            onChange={onChange}
          />
        </FieldShell>
      )
    }

    default:
      return null
  }
}
