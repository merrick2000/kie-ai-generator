'use client'

import { useCallback, useState } from 'react'
import { toast } from 'sonner'

export interface UploadedAsset {
  url: string
  name: string
  size?: number
  mimeType?: string
}

/**
 * Upload local files to Kie's CDN and return public URLs.
 *
 * Models only accept URLs, so anything a user drops has to round-trip through
 * storage before it can be referenced in a request.
 */
export function useUpload() {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  const uploadOne = useCallback(async (file: File): Promise<UploadedAsset | null> => {
    const form = new FormData()
    form.append('file', file)

    const res = await fetch('/api/kie/upload', { method: 'POST', body: form })
    const data = (await res.json()) as UploadedAsset & { error?: string }

    if (!res.ok || !data.url) {
      throw new Error(data.error || `Upload failed for ${file.name}.`)
    }
    return data
  }, [])

  const upload = useCallback(
    async (files: File[] | FileList): Promise<UploadedAsset[]> => {
      const list = Array.from(files)
      if (!list.length) return []

      setUploading(true)
      setProgress(0)
      const done: UploadedAsset[] = []

      try {
        // Sequential, so a batch of large videos does not saturate the
        // connection and time out mid-flight.
        for (const [index, file] of list.entries()) {
          try {
            const asset = await uploadOne(file)
            if (asset) done.push(asset)
          } catch (err) {
            toast.error('Upload failed', {
              description: err instanceof Error ? err.message : file.name,
            })
          }
          setProgress(Math.round(((index + 1) / list.length) * 100))
        }
        return done
      } finally {
        setUploading(false)
        setProgress(0)
      }
    },
    [uploadOne],
  )

  const uploadUrl = useCallback(async (fileUrl: string): Promise<UploadedAsset | null> => {
    setUploading(true)
    try {
      const res = await fetch('/api/kie/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileUrl }),
      })
      const data = (await res.json()) as UploadedAsset & { error?: string }
      if (!res.ok || !data.url) throw new Error(data.error || 'Remote upload failed.')
      return data
    } catch (err) {
      toast.error('Could not import URL', {
        description: err instanceof Error ? err.message : undefined,
      })
      return null
    } finally {
      setUploading(false)
    }
  }, [])

  return { upload, uploadUrl, uploading, progress }
}
