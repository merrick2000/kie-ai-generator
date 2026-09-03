'use client'

import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'

export interface UploadedAsset {
  url: string
  name: string
  size?: number
  mimeType?: string
}

export interface UploadProgress {
  /** 0 to 100 across the whole batch, weighted by file size. */
  percent: number
  /** File currently being sent, for the label. */
  currentName: string | null
  done: number
  total: number
}

/**
 * How many files go up at once.
 *
 * Sequential uploads make a batch of references painfully slow; unbounded
 * parallelism saturates the connection and starts timing out on large videos.
 */
const CONCURRENCY = 3

/** Retries per file, for transient network failures only. */
const MAX_ATTEMPTS = 3

interface UploadOptions {
  /** Rejected before leaving the browser, to avoid a pointless round trip. */
  maxSizeMb?: number
  accept?: string
}

/**
 * Upload local files and return public URLs.
 *
 * Models only accept URLs, so anything dropped in has to reach storage before
 * it can be referenced in a request.
 *
 * Progress is reported with XMLHttpRequest rather than fetch: fetch cannot
 * report upload progress, and a 40MB video with no feedback looks broken.
 */
export function useUpload() {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState<UploadProgress>({
    percent: 0,
    currentName: null,
    done: 0,
    total: 0,
  })

  /** Lets an in-flight batch be abandoned when the component unmounts. */
  const pending = useRef(new Set<XMLHttpRequest>())

  const uploadOne = useCallback(
    (file: File, onBytes: (sent: number) => void): Promise<UploadedAsset> =>
      new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        pending.current.add(xhr)

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) onBytes(e.loaded)
        })

        xhr.addEventListener('load', () => {
          pending.current.delete(xhr)
          let payload: UploadedAsset & { error?: string }

          try {
            payload = JSON.parse(xhr.responseText)
          } catch {
            reject(new Error(`Upload of ${file.name} returned an unreadable response.`))
            return
          }

          if (xhr.status >= 200 && xhr.status < 300 && payload.url) {
            resolve(payload)
          } else {
            reject(new Error(payload.error || `Upload of ${file.name} failed.`))
          }
        })

        xhr.addEventListener('error', () => {
          pending.current.delete(xhr)
          reject(new Error(`Network error while uploading ${file.name}.`))
        })

        xhr.addEventListener('abort', () => {
          pending.current.delete(xhr)
          reject(new Error('Upload cancelled.'))
        })

        const form = new FormData()
        form.append('file', file)

        xhr.open('POST', '/api/kie/upload')
        xhr.send(form)
      }),
    [],
  )

  const upload = useCallback(
    async (files: File[] | FileList, options: UploadOptions = {}): Promise<UploadedAsset[]> => {
      const list = Array.from(files)
      if (!list.length) return []

      // Reject oversize files up front rather than after the round trip.
      const limitBytes = (options.maxSizeMb ?? 100) * 1024 * 1024
      const accepted: File[] = []

      for (const file of list) {
        if (file.size > limitBytes) {
          toast.error(`${file.name} is too large`, {
            description: `${(file.size / 1e6).toFixed(1)}MB, limit is ${options.maxSizeMb ?? 100}MB.`,
          })
          continue
        }
        if (file.size === 0) {
          toast.error(`${file.name} is empty`)
          continue
        }
        accepted.push(file)
      }

      if (!accepted.length) return []

      const totalBytes = accepted.reduce((sum, f) => sum + f.size, 0)
      const sentByFile = new Map<File, number>()

      setUploading(true)
      setProgress({ percent: 0, currentName: accepted[0].name, done: 0, total: accepted.length })

      const results: UploadedAsset[] = []
      let done = 0

      const report = (current: string | null) => {
        const sent = [...sentByFile.values()].reduce((a, b) => a + b, 0)
        setProgress({
          // Weighted by bytes, so one large file does not sit at 0% while
          // small ones race to the end.
          percent: totalBytes ? Math.min(99, Math.round((sent / totalBytes) * 100)) : 0,
          currentName: current,
          done,
          total: accepted.length,
        })
      }

      const queue = [...accepted]

      const worker = async () => {
        for (;;) {
          const file = queue.shift()
          if (!file) return

          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
              const asset = await uploadOne(file, (sent) => {
                sentByFile.set(file, sent)
                report(file.name)
              })
              results.push(asset)
              sentByFile.set(file, file.size)
              break
            } catch (err) {
              const message = err instanceof Error ? err.message : 'Upload failed.'

              // A cancelled upload is deliberate, and a rejected one will be
              // rejected again; only network trouble is worth retrying.
              const worthRetrying =
                attempt < MAX_ATTEMPTS && /network error/i.test(message)

              if (!worthRetrying) {
                toast.error('Upload failed', { description: message })
                sentByFile.set(file, file.size)
                break
              }

              await new Promise((r) => setTimeout(r, 500 * attempt))
            }
          }

          done += 1
          report(null)
        }
      }

      try {
        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCY, accepted.length) }, worker),
        )
        return results
      } finally {
        setUploading(false)
        setProgress({ percent: 0, currentName: null, done: 0, total: 0 })
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
      toast.error('Could not import that URL', {
        description: err instanceof Error ? err.message : undefined,
      })
      return null
    } finally {
      setUploading(false)
    }
  }, [])

  /** Abandon anything in flight. */
  const cancelAll = useCallback(() => {
    for (const xhr of pending.current) xhr.abort()
    pending.current.clear()
  }, [])

  return { upload, uploadUrl, uploading, progress, cancelAll }
}
