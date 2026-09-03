'use client'

import { ChevronDown, RotateCcw, Sparkles, Wand2 } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/Button'
import { useGeneration } from '@/hooks/useGeneration'
import { getModel } from '@/lib/kie/catalog'
import { isVisible } from '@/lib/kie/fields'
import {
  describeEstimate,
  estimateFromReference,
  formatCredits,
  formatUsd,
} from '@/lib/kie/pricing'
import { presetsFor } from '@/lib/presets'
import { cn } from '@/lib/utils'
import { useStudio } from '@/store/studio'
import { FieldRenderer } from './FieldRenderer'
import { ModelPicker } from './ModelPicker'

const EMPTY_VALUES: Record<string, unknown> = {}

/** The left rail: pick a model, fill its schema, submit. */
export function Composer() {
  const modelId = useStudio((s) => s.modelId)
  const selectModel = useStudio((s) => s.selectModel)
  const setValue = useStudio((s) => s.setValue)
  const resetForm = useStudio((s) => s.resetForm)
  // A shared constant, not a fresh `{}`. Returning a new object from a
  // selector gives Zustand a different snapshot on every render, which React
  // reports as "Maximum update depth exceeded" and the app stops responding.
  // It only shows up when the current model has no form entry yet, which is
  // why it survived until a model was selected without one.
  const values = useStudio((s) => s.formsByModel[s.modelId] ?? EMPTY_VALUES)
  const activeCount = useStudio(
    (s) => s.jobs.filter((j) => j.state !== 'success' && j.state !== 'fail').length,
  )
  // A measured charge is the truth. Failing that, Kie's published unit price
  // applied to the settings actually chosen. Failing both, say nothing.
  const knownCost = useStudio((s) => s.costByModel[s.modelId])
  const reference = useMemo(
    () => (knownCost ? null : estimateFromReference(modelId, values)),
    [knownCost, modelId, values],
  )

  const [showAdvanced, setShowAdvanced] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const { generate } = useGeneration()

  const model = getModel(modelId)

  const { basic, advanced } = useMemo(() => {
    if (!model) return { basic: [], advanced: [] }
    const visible = model.fields.filter((f) => isVisible(f, values))
    return {
      basic: visible.filter((f) => !f.advanced),
      advanced: visible.filter((f) => f.advanced),
    }
  }, [model, values])

  const presets = model ? presetsFor(model.output) : []
  const hasPromptField = model?.fields.some(
    (f) => f.name === 'prompt' || f.name === 'text',
  )

  const onGenerate = async () => {
    setSubmitting(true)
    try {
      await generate()
    } finally {
      setSubmitting(false)
    }
  }

  if (!model) return null

  return (
    <div className="flex h-full flex-col">
      <div className="rule shrink-0 p-4">
        <ModelPicker modelId={modelId} onSelect={selectModel} />
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {presets.length > 0 && hasPromptField && (
          <div className="flex flex-wrap gap-1.5">
            {presets.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() =>
                  setValue(
                    model.fields.some((f) => f.name === 'prompt') ? 'prompt' : 'text',
                    p.prompt,
                  )
                }
                className="flex items-center gap-1 rounded-lg border border-line bg-raised px-2 py-1 text-[11px] text-ink-muted transition-colors hover:border-accent hover:text-accent"
              >
                <Wand2 className="size-2.5" />
                {p.label}
              </button>
            ))}
          </div>
        )}

        {basic.map((field) => (
          <FieldRenderer
            key={field.name}
            field={field}
            value={values[field.name]}
            onChange={(v) => setValue(field.name, v)}
          />
        ))}

        {advanced.length > 0 && (
          <div className="rounded-xl border border-line">
            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
              className="flex w-full items-center justify-between px-3 py-2.5 text-[12px] font-medium text-ink-muted transition-colors hover:text-ink"
            >
              Advanced
              <span className="flex items-center gap-2">
                <span className="text-[11px] text-ink-faint">{advanced.length}</span>
                <ChevronDown
                  className={cn(
                    'size-3.5 transition-transform duration-200',
                    showAdvanced && 'rotate-180',
                  )}
                />
              </span>
            </button>
            {showAdvanced && (
              <div className="space-y-5 border-t border-line p-3">
                {advanced.map((field) => (
                  <FieldRenderer
                    key={field.name}
                    field={field}
                    value={values[field.name]}
                    onChange={(v) => setValue(field.name, v)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-line bg-surface p-4">
        <div className="flex gap-2">
          <Button
            variant="primary"
            size="lg"
            className="flex-1"
            loading={submitting}
            onClick={() => void onGenerate()}
          >
            {!submitting && <Sparkles className="size-4" />}
            Generate
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={resetForm}
            aria-label="Reset form"
            title="Reset to defaults"
            className="px-3"
          >
            <RotateCcw className="size-4" />
          </Button>
        </div>
        <p className="mt-2 text-center text-[11px] text-ink-faint">
          {knownCost ? (
            describeEstimate(knownCost)
          ) : reference ? (
            <>
              {formatCredits(reference.credits)} cr {formatUsd(reference.usd)}
              <span className="text-ink-faint/70"> · {reference.basis}</span>
            </>
          ) : (
            'Cost appears here once this model has run once.'
          )}
        </p>
        <p className="mt-1 text-center text-[11px] text-ink-faint">
          {activeCount > 0
            ? `${activeCount} generation${activeCount > 1 ? 's' : ''} running`
            : 'Runs asynchronously. You can queue several at once.'}
        </p>
      </div>
    </div>
  )
}
