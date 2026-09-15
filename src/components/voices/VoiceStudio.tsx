'use client'

import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Loader2,
  Mic,
  Plus,
  RotateCw,
  Square,
  Trash2,
  Upload,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { inputClass } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { cn, timeAgo } from '@/lib/utils'
import { checkSegment, SINGER_LEVELS, VOICE_LANGUAGES, type VoiceStatus } from '@/lib/voices/kie'
import { audioDuration, startRecording, uploadAudio, type Recording } from '@/lib/voices/record'

interface Voice {
  id: string
  name: string
  description: string | null
  style: string | null
  language: string
  sourceUrl: string
  vocalStartS: number
  vocalEndS: number
  phrase: string | null
  voiceId: string | null
  available: boolean | null
  status: VoiceStatus
  error: string | null
  createdAt: number
}

const isWaiting = (v: Voice) =>
  v.status === 'phrase_pending' ||
  v.status === 'creating' ||
  (v.status === 'ready' && v.available === null && !v.error)

/** Often enough to see a phrase arrive, rarely enough to leave open. */
const POLL_MS = 3_000

async function readJson<T>(res: Response): Promise<T & { error?: string }> {
  return (await res.json().catch(() => ({}))) as T & { error?: string }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Recording
 * ──────────────────────────────────────────────────────────────────────────*/

function useRecorder(name: string) {
  const take = useRef<Recording | null>(null)
  const [recording, setRecording] = useState(false)

  useEffect(() => () => take.current?.cancel(), [])

  const start = useCallback(async () => {
    try {
      take.current = await startRecording(name)
      setRecording(true)
    } catch (err) {
      toast.error(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Microphone access was refused. Allow it in the browser, or upload a file.'
          : err instanceof Error
            ? err.message
            : 'Could not start recording.',
      )
    }
  }, [name])

  const stop = useCallback(async (): Promise<File | null> => {
    const current = take.current
    take.current = null
    setRecording(false)
    if (!current) return null
    try {
      return await current.stop()
    } catch {
      toast.error('The recording could not be read back. Try again or upload a file.')
      return null
    }
  }, [])

  return { recording, start, stop }
}

function AudioSource({
  file,
  onFile,
  recordName,
}: {
  file: File | null
  onFile: (file: File) => void
  recordName: string
}) {
  const { recording, start, stop } = useRecorder(recordName)
  const [preview, setPreview] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {recording ? (
          <Button
            size="sm"
            variant="danger"
            onClick={async () => {
              const taken = await stop()
              if (taken) onFile(taken)
            }}
          >
            <Square className="size-3.5 fill-current" />
            Stop recording
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => void start()}>
            <Mic className="size-3.5" />
            Record
          </Button>
        )}

        <Button
          size="sm"
          variant="secondary"
          disabled={recording}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-3.5" />
          Upload a file
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          onChange={(e) => {
            const picked = e.target.files?.[0]
            if (picked) onFile(picked)
            e.target.value = ''
          }}
        />
      </div>

      {recording && (
        <p className="flex items-center gap-2 text-[12px] text-danger">
          <span className="size-2 animate-pulse rounded-full bg-danger" />
          Recording…
        </p>
      )}

      {preview && !recording && (
        <div className="space-y-1">
          <audio src={preview} controls className="w-full" />
          <p className="truncate text-[11px] text-ink-faint">{file?.name}</p>
        </div>
      )}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
 * Step one
 * ──────────────────────────────────────────────────────────────────────────*/

function NewVoiceForm({ onCreated, onCancel }: { onCreated: (v: Voice) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [duration, setDuration] = useState(0)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(10)
  const [language, setLanguage] = useState('fr')
  const [style, setStyle] = useState('')
  const [description, setDescription] = useState('')
  const [level, setLevel] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)

  const pick = async (picked: File) => {
    setFile(picked)
    try {
      const seconds = await audioDuration(picked)
      setDuration(seconds)
      setStart(0)
      // The whole take when it is short, a clean opening stretch when it is
      // not. Kie documents no length rule, so this is a starting point only.
      setEnd(Math.max(1, Math.min(Math.floor(seconds), 20)))
    } catch (err) {
      setFile(null)
      toast.error(err instanceof Error ? err.message : 'That file could not be read.')
    }
  }

  const segmentError = file ? checkSegment(start, end) : null
  const pastEnd = duration > 0 && end > Math.ceil(duration)
  const ready = Boolean(name.trim() && file && !segmentError && !pastEnd && consent)

  async function submit() {
    if (!file || !ready) return
    setBusy(true)
    try {
      const sourceUrl = await uploadAudio(file)
      const res = await fetch('/api/voices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          sourceUrl,
          startS: start,
          endS: end,
          language,
          style,
          description,
          singerSkillLevel: level || undefined,
          consent,
        }),
      })
      const data = await readJson<{ voice?: Voice }>(res)
      if (!res.ok || !data.voice) throw new Error(data.error ?? 'Kie did not accept the recording.')
      toast.success('Recording sent. Kie is writing a phrase for you to read.')
      onCreated(data.voice)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start the voice.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5 rounded-2xl border border-line bg-surface p-5">
      <div>
        <h2 className="text-[15px] font-semibold text-ink">New voice</h2>
        <p className="mt-0.5 text-[12px] text-ink-faint">
          Step 1 of 2. A recording of the voice, ideally singing, with nothing else in it.
        </p>
      </div>

      <label className="block space-y-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Name *</span>
        <input
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          placeholder="My studio voice"
          className={inputClass}
        />
      </label>

      <div className="space-y-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
          Recording *
        </span>
        <p className="text-[12px] text-ink-faint">
          Clean a cappella works best: no music, no echo, one person.
        </p>
        <AudioSource file={file} onFile={(f) => void pick(f)} recordName="source.wav" />
      </div>

      {file && (
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
              Sample starts (s)
            </span>
            <input
              type="number"
              min={0}
              step={1}
              value={start}
              onChange={(e) => setStart(Math.floor(Number(e.target.value)))}
              className={inputClass}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
              Sample ends (s)
            </span>
            <input
              type="number"
              min={1}
              step={1}
              value={end}
              onChange={(e) => setEnd(Math.floor(Number(e.target.value)))}
              className={inputClass}
            />
          </label>
          <p className={cn('col-span-2 text-[12px]', segmentError || pastEnd ? 'text-danger' : 'text-ink-faint')}>
            {segmentError ??
              (pastEnd
                ? `The recording is only ${Math.ceil(duration)} seconds long.`
                : `Using ${end - start} of ${Math.ceil(duration)} seconds.`)}
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
            Phrase language
          </span>
          <select value={language} onChange={(e) => setLanguage(e.target.value)} className={inputClass}>
            {VOICE_LANGUAGES.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
            Singer level
          </span>
          <select value={level} onChange={(e) => setLevel(e.target.value)} className={inputClass}>
            <option value="">Not specified</option>
            {SINGER_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l[0]!.toUpperCase() + l.slice(1)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">Style</span>
        <input
          value={style}
          maxLength={200}
          onChange={(e) => setStyle(e.target.value)}
          placeholder="Soul, warm female vocal"
          className={inputClass}
        />
      </label>

      <label className="block space-y-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">
          Description
        </span>
        <textarea
          value={description}
          maxLength={500}
          rows={2}
          onChange={(e) => setDescription(e.target.value)}
          className={cn(inputClass, 'resize-y')}
        />
      </label>

      <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-line bg-raised p-3">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-0.5 size-4 accent-[var(--color-accent)]"
        />
        <span className="text-[12px] leading-relaxed text-ink-muted">
          This is my voice, or I have permission from the person whose voice it is. The next step
          asks that person to read a sentence aloud.
        </span>
      </label>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" loading={busy} disabled={!ready} onClick={() => void submit()}>
          Send recording
        </Button>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
 * A voice, whatever step it is at
 * ──────────────────────────────────────────────────────────────────────────*/

const STATUS: Record<VoiceStatus, { label: string; tone: string }> = {
  phrase_pending: { label: 'Writing phrase', tone: 'text-warn' },
  phrase_ready: { label: 'Waiting for your reading', tone: 'text-accent' },
  creating: { label: 'Building voice', tone: 'text-warn' },
  ready: { label: 'Ready', tone: 'text-ok' },
  failed: { label: 'Failed', tone: 'text-danger' },
}

function VoiceCard({ voice, onChange, onRemove }: { voice: Voice; onChange: (v: Voice) => void; onRemove: () => void }) {
  const [reading, setReading] = useState<File | null>(null)
  const [busy, setBusy] = useState<'verify' | 'regenerate' | 'retry' | 'delete' | null>(null)
  const status = STATUS[voice.status]
  const canRead = Boolean(voice.phrase) && (voice.status === 'phrase_ready' || voice.status === 'failed')

  async function post(path: string, body?: unknown): Promise<Voice | null> {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
    const data = await readJson<{ voice?: Voice }>(res)
    if (!res.ok || !data.voice) {
      toast.error(data.error ?? 'Kie refused this step.')
      return null
    }
    return data.voice
  }

  async function verify() {
    if (!reading) return
    setBusy('verify')
    try {
      const verifyUrl = await uploadAudio(reading)
      const next = await post(`/api/voices/${voice.id}/verify`, { verifyUrl })
      if (next) {
        setReading(null)
        onChange(next)
        toast.success('Reading sent. Kie is building the voice.')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setBusy(null)
    }
  }

  async function retry() {
    setBusy('retry')
    const next = await post(`/api/voices/${voice.id}/retry`)
    if (next) {
      onChange(next)
      toast.success('Sent again. Kie is writing a phrase for you to read.')
    }
    setBusy(null)
  }

  async function regenerate() {
    setBusy('regenerate')
    const next = await post(`/api/voices/${voice.id}/regenerate`)
    if (next) onChange(next)
    setBusy(null)
  }

  async function remove() {
    if (!window.confirm(`Delete "${voice.name}"? It will no longer be offered in Suno.`)) return
    setBusy('delete')
    const res = await fetch(`/api/voices/${voice.id}`, { method: 'DELETE' })
    setBusy(null)
    if (res.ok) onRemove()
    else toast.error('Could not delete this voice.')
  }

  return (
    <article className="space-y-4 rounded-2xl border border-line bg-surface p-5">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-ink">{voice.name}</h3>
          <p className="mt-0.5 text-[12px] text-ink-faint">
            <span className={cn('font-medium', status.tone)}>{status.label}</span>
            {' · '}
            {voice.vocalEndS - voice.vocalStartS}s sample · {timeAgo(voice.createdAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy !== null}
          aria-label={`Delete ${voice.name}`}
          className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger disabled:opacity-50"
        >
          {busy === 'delete' ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
        </button>
      </header>

      {(voice.status === 'phrase_pending' || voice.status === 'creating') && (
        <p className="flex items-center gap-2 text-[13px] text-ink-muted">
          <Loader2 className="size-4 animate-spin text-warn" />
          {voice.status === 'phrase_pending'
            ? 'Kie is listening to the sample and writing a sentence for you to read.'
            : 'Kie is building the voice from your reading.'}
        </p>
      )}

      {canRead && (
        <div className="space-y-3">
          <div className="rounded-xl border border-accent/30 bg-accent-glow p-4">
            <p className="text-[11px] font-medium uppercase tracking-wide text-accent">
              Step 2 of 2 · Read this aloud
            </p>
            <p className="mt-2 text-[17px] leading-relaxed text-ink">{voice.phrase}</p>
            <p className="mt-2 text-[12px] text-ink-faint">
              In the voice being cloned, clearly and in one take. Singing it gives a better voice
              than speaking it.
            </p>
          </div>

          <AudioSource file={reading} onFile={setReading} recordName="reading.wav" />

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              loading={busy === 'regenerate'}
              disabled={busy !== null}
              onClick={() => void regenerate()}
            >
              <RotateCw className="size-3.5" />
              New phrase
            </Button>
            <Button
              size="sm"
              variant="primary"
              loading={busy === 'verify'}
              disabled={!reading || busy !== null}
              onClick={() => void verify()}
            >
              Send reading
            </Button>
          </div>
        </div>
      )}

      {voice.status === 'ready' && (
        <div className="space-y-1.5 rounded-xl border border-ok/30 bg-ok/10 p-3">
          <p className="flex items-center gap-2 text-[13px] font-medium text-ok">
            <Check className="size-4" />
            {voice.available === false ? 'Created, but Kie reports it unavailable' : 'Ready to sing'}
          </p>
          <p className="text-[12px] text-ink-muted">
            In the studio, pick Suno, turn on Custom mode, and choose it under Cloned voice.
          </p>
        </div>
      )}

      {voice.error && (
        <p className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-[12px] leading-relaxed text-danger">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {voice.error}
        </p>
      )}

      {/*
        It used to say to delete and start over, for what is usually a timeout
        on Kie's side. The recording and its stretch are still stored, so the
        first thing offered is to ask again with them.
      */}
      {voice.status === 'failed' && !voice.phrase && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12px] text-ink-faint">
            The phrase never arrived. Your recording is kept, so you can ask again.
          </p>
          <Button
            size="sm"
            variant="primary"
            loading={busy === 'retry'}
            disabled={busy !== null}
            onClick={() => void retry()}
          >
            {busy !== 'retry' && <RotateCw className="size-3.5" />}
            Try again
          </Button>
        </div>
      )}
    </article>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
 * Page
 * ──────────────────────────────────────────────────────────────────────────*/

export function VoiceStudio() {
  const [voices, setVoices] = useState<Voice[] | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    const res = await fetch('/api/voices', { cache: 'no-store', signal })
    if (!res.ok) return
    const data = await readJson<{ voices?: Voice[] }>(res)
    setVoices(data.voices ?? [])
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    load(controller.signal).catch(() => {
      if (!controller.signal.aborted) setVoices([])
    })
    return () => controller.abort()
  }, [load])

  const waiting = voices?.some(isWaiting) ?? false

  // Polls only while Kie is doing something. A voice waiting on a person
  // needs no requests at all until that person acts.
  useEffect(() => {
    if (!waiting) return
    const timer = setInterval(() => {
      if (!document.hidden) void load().catch(() => {})
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [waiting, load])

  const replace = (next: Voice) =>
    setVoices((list) => (list ?? []).map((v) => (v.id === next.id ? next : v)))

  return (
    <main className="min-h-dvh bg-void text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-void/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-3">
          <a
            href="/"
            className="flex items-center gap-1.5 text-[13px] text-ink-faint transition-colors hover:text-ink"
          >
            <ArrowLeft className="size-3.5" />
            Studio
          </a>
          <h1 className="ml-2 text-[15px] font-semibold">Voices</h1>
          {!adding && (
            <Button size="sm" variant="primary" className="ml-auto" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" />
              New voice
            </Button>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-4 px-5 py-6">
        <p className="rounded-xl border border-line bg-raised px-4 py-3 text-[12px] leading-relaxed text-ink-muted">
          Cloning here goes through Suno Voice, the only cloning Kie offers. It clones a
          <strong className="font-semibold text-ink"> singing </strong>
          voice for Suno songs, not a speaking voice for text to speech.
        </p>

        {adding && (
          <NewVoiceForm
            onCancel={() => setAdding(false)}
            onCreated={(voice) => {
              setAdding(false)
              setVoices((list) => [voice, ...(list ?? [])])
            }}
          />
        )}

        {voices === null ? (
          <p className="flex items-center gap-2 py-10 text-[13px] text-ink-faint">
            <Loader2 className="size-4 animate-spin" />
            Loading your voices…
          </p>
        ) : voices.length === 0 && !adding ? (
          <div className="rounded-2xl border border-dashed border-line p-10 text-center">
            <Mic className="mx-auto size-6 text-ink-faint" />
            <p className="mt-3 text-[14px] text-ink">No voice yet</p>
            <p className="mt-1 text-[12px] text-ink-faint">
              Record or upload a voice, read one sentence back, and it becomes available in Suno.
            </p>
            <Button size="sm" variant="primary" className="mt-4" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" />
              New voice
            </Button>
          </div>
        ) : (
          voices.map((voice) => (
            <VoiceCard
              key={voice.id}
              voice={voice}
              onChange={replace}
              onRemove={() => setVoices((list) => (list ?? []).filter((v) => v.id !== voice.id))}
            />
          ))
        )}
      </div>
    </main>
  )
}
