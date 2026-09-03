'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'

import { getModel, MODELS, type ModelDef } from '@/lib/kie/catalog'
import type { AssetField, Field } from '@/lib/kie/fields'
import { useStudio } from '@/store/studio'
import type { TaskAsset } from '@/lib/kie/tasks'

/**
 * Feed a generated result back in as an input.
 *
 * Without this, chaining means downloading the result and uploading it again,
 * which is slow and pointless: Kie can fetch its own URL server-side through
 * the URL-upload endpoint, so the file never travels to the browser at all.
 *
 * Re-hosting rather than passing the original URL straight through matters
 * because Kie's result URLs are temporary. A reference that expires mid-run
 * fails with an unhelpful "could not read your file".
 */

/** Asset kinds an input field can accept. */
const ACCEPTS: Record<string, TaskAsset['kind'][]> = {
  image: ['image'],
  images: ['image'],
  audio: ['audio'],
  video: ['video'],
  videos: ['video'],
}

function assetFields(model: ModelDef): AssetField[] {
  return model.fields.filter(
    (f): f is AssetField => f.kind in ACCEPTS,
  )
}

/** First field on a model that can hold this kind of asset. */
function targetField(model: ModelDef, kind: TaskAsset['kind']): AssetField | undefined {
  return assetFields(model).find((f) => ACCEPTS[f.kind]?.includes(kind))
}

/** Models that can take this asset as an input, for the picker. */
export function modelsAccepting(kind: TaskAsset['kind']): ModelDef[] {
  return MODELS.filter((m) => targetField(m, kind) !== undefined)
}

export function useReuseAsset() {
  const selectModel = useStudio((s) => s.selectModel)
  const setValue = useStudio((s) => s.setValue)
  const [working, setWorking] = useState(false)

  /**
   * Re-host the asset and load it into a model's reference field.
   *
   * When no model is named, the current one is used if it can take the asset;
   * otherwise the first model that can.
   */
  const reuse = useCallback(
    async (asset: TaskAsset, modelId?: string): Promise<boolean> => {
      const current = useStudio.getState().modelId
      const candidate =
        (modelId && getModel(modelId)) ||
        (targetField(getModel(current)!, asset.kind) ? getModel(current) : undefined) ||
        modelsAccepting(asset.kind)[0]

      if (!candidate) {
        toast.error('No model takes that kind of file as input.')
        return false
      }

      const field = targetField(candidate, asset.kind)
      if (!field) {
        toast.error(`${candidate.name} does not take a ${asset.kind} as input.`)
        return false
      }

      setWorking(true)

      try {
        const res = await fetch('/api/kie/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileUrl: asset.url, fileName: `reuse-${asset.kind}` }),
        })

        const data = (await res.json()) as { url?: string; error?: string }

        if (!res.ok || !data.url) {
          throw new Error(data.error || 'Could not re-host that asset.')
        }

        if (candidate.id !== current) selectModel(candidate.id)

        // Multi-value fields append, so several results can be stacked as
        // references; single-value fields replace.
        if (field.kind === 'images' || field.kind === 'videos') {
          const existing = useStudio.getState().formsByModel[candidate.id]?.[field.name]
          const list = Array.isArray(existing) ? (existing as string[]) : []
          const room = field.maxItems ?? 10

          if (list.length >= room) {
            toast.error(`${field.label} already holds ${room} files.`)
            return false
          }
          setValue(field.name, [...list, data.url])
        } else {
          setValue(field.name, data.url)
        }

        toast.success(`Added to ${candidate.name}`, {
          description: `Loaded into ${field.label}.`,
        })
        return true
      } catch (err) {
        toast.error('Could not reuse that result', {
          description: err instanceof Error ? err.message : undefined,
        })
        return false
      } finally {
        setWorking(false)
      }
    },
    [selectModel, setValue],
  )

  return { reuse, working }
}
