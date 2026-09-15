'use client'

import { ArrowLeft, ImagePlus, Loader2, Plus, Trash2, UserRound, AudioLines } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/Button'
import { inputClass } from '@/components/ui/Field'
import { OMNI_BASE_VOICES, OMNI_LIMITS, checkCharacter, checkVoice } from '@/lib/omni/kie'
import { cn, timeAgo } from '@/lib/utils'

interface Voice {
  id: string
  kieAudioId: string
  name: string
  baseVoice: string
  voiceDescription: string | null
  exampleDialogue: string | null
  createdAt: number
}

interface Character {
  id: string
  name: string | null
  description: string
  imageUrl: string
  bodyImageUrl: string | null
  voiceIds: string[]
  createdAt: number
}

const label = 'text-[11px] font-medium uppercase tracking-wide text-ink-muted'

async function readJson<T>(res: Response): Promise<T & { error?: string }> {
  return (await res.json().catch(() => ({}))) as T & { error?: string }
}

/** Uploads through Kie so the URL is one Kie can fetch. */
async function uploadImage(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/kie/upload', { method: 'POST', body: form })
  const data = await readJson<{ url?: string }>(res)
  if (!res.ok || !data.url) throw new Error(data.error ?? 'Upload failed.')
  return data.url
}

function ImagePick({ title, file, onFile, optional }: { title: string; file: File | null; onFile: (f: File | null) => void; optional?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!file) return setPreview(null)
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  return (
    <div className="space-y-1.5">
      <span className={label}>
        {title}
        {!optional && ' *'}
      </span>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="relative grid aspect-[3/4] w-full place-items-center overflow-hidden rounded-xl border border-dashed border-line bg-raised text-ink-faint transition-colors hover:border-line-bright hover:text-ink"
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="absolute inset-0 size-full object-cover" />
        ) : (
          <span className="flex flex-col items-center gap-1 text-[12px]">
            <ImagePlus className="size-5" />
            {optional ? 'Optional' : 'Add a photo'}
          </span>
        )}
      </button>
      {file && (
        <button type="button" onClick={() => onFile(null)} className="text-[11px] text-ink-faint hover:text-danger">
          Remove
        </button>
      )}
      <input
        ref={ref}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0]
          if (picked) onFile(picked)
          e.target.value = ''
        }}
      />
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
 * Voices
 * ──────────────────────────────────────────────────────────────────────────*/

function VoiceForm({ onCreated, onCancel }: { onCreated: (v: Voice) => void; onCancel: () => void }) {
  const [baseVoice, setBaseVoice] = useState('sulafat')
  const [name, setName] = useState('')
  const [voiceDescription, setVoiceDescription] = useState('')
  const [exampleDialogue, setExampleDialogue] = useState('')
  const [busy, setBusy] = useState(false)

  const draft = { baseVoice, name, voiceDescription, exampleDialogue }
  const problem = checkVoice(draft)

  async function submit() {
    setBusy(true)
    try {
      const res = await fetch('/api/omni/voices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      })
      const data = await readJson<{ voice?: Voice }>(res)
      if (!res.ok || !data.voice) throw new Error(data.error ?? 'Kie did not create the voice.')
      toast.success(`Voice "${data.voice.name}" ready.`)
      onCreated(data.voice)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the voice.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-line bg-surface p-5">
      <label className="block space-y-1.5">
        <span className={label}>Base voice *</span>
        <select value={baseVoice} onChange={(e) => setBaseVoice(e.target.value)} className={inputClass}>
          {OMNI_BASE_VOICES.map((v) => (
            <option key={v.value} value={v.value}>
              {v.value[0]!.toUpperCase() + v.value.slice(1)} · {v.hint}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1.5">
        <span className={label}>Name *</span>
        <input value={name} maxLength={OMNI_LIMITS.voiceName} onChange={(e) => setName(e.target.value)} placeholder="Warm narrator" className={inputClass} />
      </label>
      <label className="block space-y-1.5">
        <span className={label}>How it sounds</span>
        <textarea
          value={voiceDescription}
          maxLength={OMNI_LIMITS.voiceDescription}
          rows={3}
          onChange={(e) => setVoiceDescription(e.target.value)}
          placeholder="Calm and warm, speaks slowly, a slight smile in the voice."
          className={cn(inputClass, 'resize-y')}
        />
      </label>
      <label className="block space-y-1.5">
        <span className={label}>Example line</span>
        <input
          value={exampleDialogue}
          maxLength={OMNI_LIMITS.exampleDialogue}
          onChange={(e) => setExampleDialogue(e.target.value)}
          placeholder="Hello, I am Maya."
          className={inputClass}
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" loading={busy} disabled={Boolean(problem)} title={problem ?? undefined} onClick={() => void submit()}>
          Create voice
        </Button>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
 * Characters
 * ──────────────────────────────────────────────────────────────────────────*/

function CharacterForm({ voices, onCreated, onCancel }: { voices: Voice[]; onCreated: (c: Character) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [portrait, setPortrait] = useState<File | null>(null)
  const [body, setBody] = useState<File | null>(null)
  const [voiceIds, setVoiceIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  // Checked with a stand-in URL: the real one only exists after upload, and
  // uploading before the rest of the form is valid would waste the upload.
  const problem = checkCharacter({
    name,
    description,
    portraitUrl: portrait ? 'https://pending' : '',
    bodyUrl: body ? 'https://pending' : '',
  })

  async function submit() {
    if (!portrait) return
    setBusy(true)
    try {
      const portraitUrl = await uploadImage(portrait)
      const bodyUrl = body ? await uploadImage(body) : undefined
      const res = await fetch('/api/omni/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, portraitUrl, bodyUrl, voiceIds }),
      })
      const data = await readJson<{ character?: Character }>(res)
      if (!res.ok || !data.character) throw new Error(data.error ?? 'Kie did not create the character.')
      toast.success('Character ready. Pick it in Gemini Omni.')
      onCreated(data.character)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the character.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 rounded-2xl border border-line bg-surface p-5">
      <div className="grid grid-cols-2 gap-3">
        <ImagePick title="Portrait" file={portrait} onFile={setPortrait} />
        <ImagePick title="Full body" file={body} onFile={setBody} optional />
      </div>
      <label className="block space-y-1.5">
        <span className={label}>Name</span>
        <input value={name} maxLength={OMNI_LIMITS.characterName} onChange={(e) => setName(e.target.value)} placeholder="Maya" className={inputClass} />
      </label>
      <label className="block space-y-1.5">
        <span className={label}>Description *</span>
        <textarea
          value={description}
          maxLength={OMNI_LIMITS.characterDescription}
          rows={3}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Look, style, clothing, personality."
          className={cn(inputClass, 'resize-y')}
        />
      </label>

      <div className="space-y-1.5">
        <span className={label}>Voice</span>
        {voices.length === 0 ? (
          <p className="text-[12px] text-ink-faint">Create a voice first to give this character one.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {voices.map((v) => {
              const on = voiceIds.includes(v.id)
              return (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setVoiceIds(on ? voiceIds.filter((id) => id !== v.id) : [...voiceIds, v.id])}
                  className={cn(
                    'rounded-lg border px-2 py-1 text-[12px] transition-colors',
                    on ? 'border-accent/50 bg-accent-glow text-ink' : 'border-line bg-raised text-ink-muted hover:text-ink',
                  )}
                >
                  {v.name}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" loading={busy} disabled={Boolean(problem)} title={problem ?? undefined} onClick={() => void submit()}>
          Create character
        </Button>
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
 * Page
 * ──────────────────────────────────────────────────────────────────────────*/

export function CharacterStudio() {
  const [voices, setVoices] = useState<Voice[] | null>(null)
  const [characters, setCharacters] = useState<Character[] | null>(null)
  const [adding, setAdding] = useState<'voice' | 'character' | null>(null)

  const load = useCallback(async () => {
    const [v, c] = await Promise.all([
      fetch('/api/omni/voices', { cache: 'no-store' }).then((r) => readJson<{ voices?: Voice[] }>(r)),
      fetch('/api/omni/characters', { cache: 'no-store' }).then((r) => readJson<{ characters?: Character[] }>(r)),
    ])
    setVoices(v.voices ?? [])
    setCharacters(c.characters ?? [])
  }, [])

  useEffect(() => {
    void load().catch(() => {
      setVoices([])
      setCharacters([])
    })
  }, [load])

  async function remove(kind: 'voices' | 'characters', id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? It will no longer be offered in Gemini Omni.`)) return
    const res = await fetch(`/api/omni/${kind}/${id}`, { method: 'DELETE' })
    if (!res.ok) return void toast.error('Could not delete it.')
    if (kind === 'voices') setVoices((l) => (l ?? []).filter((v) => v.id !== id))
    else setCharacters((l) => (l ?? []).filter((c) => c.id !== id))
  }

  const voiceName = (id: string) => voices?.find((v) => v.id === id)?.name

  return (
    <main className="min-h-dvh bg-void text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-void/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-5 py-3">
          <a href="/" className="flex items-center gap-1.5 text-[13px] text-ink-faint transition-colors hover:text-ink">
            <ArrowLeft className="size-3.5" />
            Studio
          </a>
          <h1 className="ml-2 text-[15px] font-semibold">Characters</h1>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-8 px-5 py-6">
        <p className="rounded-xl border border-line bg-raised px-4 py-3 text-[12px] leading-relaxed text-ink-muted">
          Characters are for Gemini Omni video. The face can be yours. The voice is
          <strong className="font-semibold text-ink"> designed</strong>, from one of Gemini&apos;s thirty base
          voices and a description, not copied from a recording. For your own voice, clone a singing voice
          in <a href="/voices" className="text-accent hover:underline">Voices</a>, or use Animate on any
          audio result to lip-sync a face to it.
        </p>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold">
              <AudioLines className="size-4 text-ink-faint" />
              Voices
            </h2>
            {adding !== 'voice' && (
              <Button size="sm" variant="secondary" onClick={() => setAdding('voice')}>
                <Plus className="size-3.5" />
                New voice
              </Button>
            )}
          </div>

          {adding === 'voice' && (
            <VoiceForm
              onCancel={() => setAdding(null)}
              onCreated={(v) => {
                setAdding(null)
                setVoices((l) => [v, ...(l ?? [])])
              }}
            />
          )}

          {voices === null ? (
            <p className="flex items-center gap-2 text-[13px] text-ink-faint">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </p>
          ) : voices.length === 0 ? (
            <p className="text-[12px] text-ink-faint">No voice yet.</p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
              {voices.map((v) => (
                <li key={v.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">{v.name}</p>
                    <p className="text-[12px] text-ink-faint">
                      {v.baseVoice} · {timeAgo(v.createdAt)}
                    </p>
                    {v.voiceDescription && <p className="mt-1 line-clamp-2 text-[12px] text-ink-muted">{v.voiceDescription}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => void remove('voices', v.id, v.name)}
                    aria-label={`Delete ${v.name}`}
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold">
              <UserRound className="size-4 text-ink-faint" />
              Characters
            </h2>
            {adding !== 'character' && (
              <Button size="sm" variant="secondary" onClick={() => setAdding('character')}>
                <Plus className="size-3.5" />
                New character
              </Button>
            )}
          </div>

          {adding === 'character' && (
            <CharacterForm
              voices={voices ?? []}
              onCancel={() => setAdding(null)}
              onCreated={(c) => {
                setAdding(null)
                setCharacters((l) => [c, ...(l ?? [])])
              }}
            />
          )}

          {characters === null ? null : characters.length === 0 ? (
            <p className="text-[12px] text-ink-faint">No character yet.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {characters.map((c) => (
                <article key={c.id} className="flex gap-3 rounded-2xl border border-line bg-surface p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={c.imageUrl} alt="" className="h-24 w-20 shrink-0 rounded-lg object-cover" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate text-[13px] font-medium text-ink">{c.name ?? 'Unnamed character'}</p>
                      <button
                        type="button"
                        onClick={() => void remove('characters', c.id, c.name ?? 'this character')}
                        aria-label={`Delete ${c.name ?? 'character'}`}
                        className="grid size-7 shrink-0 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-danger/10 hover:text-danger"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                    <p className="mt-1 line-clamp-3 text-[12px] text-ink-muted">{c.description}</p>
                    <p className="mt-1 text-[11px] text-ink-faint">
                      {c.voiceIds.length
                        ? `Voice: ${c.voiceIds.map((id) => voiceName(id) ?? 'deleted voice').join(', ')}`
                        : 'No voice'}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
