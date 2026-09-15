'use client'

import { useEffect, useState } from 'react'

import { inputClass } from '@/components/ui/Field'
import { cn } from '@/lib/utils'

interface ReadyVoice {
  id: string
  name: string
  voiceId: string | null
}

interface VoicePickerProps {
  id?: string
  value: string
  onChange: (value: string) => void
}

/**
 * Picks one of this account's cloned voices.
 *
 * Fetched rather than declared: the catalog is shared and static, and these
 * are whatever the signed-in account has built. The value is the provider's
 * voice id, which is what Suno is sent.
 */
export function VoicePicker({ id, value, onChange }: VoicePickerProps) {
  const [voices, setVoices] = useState<ReadyVoice[] | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/voices?ready=1', { cache: 'no-store', signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { voices: [] }))
      .then((data: { voices?: ReadyVoice[] }) => setVoices(data.voices ?? []))
      .catch(() => {
        if (!controller.signal.aborted) setVoices([])
      })
    return () => controller.abort()
  }, [])

  if (voices === null) {
    return <p className="text-[12px] text-ink-faint">Loading your voices…</p>
  }

  if (voices.length === 0) {
    return (
      <p className="text-[12px] text-ink-faint">
        No cloned voice yet.{' '}
        <a href="/voices" className="text-accent hover:underline">
          Clone one
        </a>{' '}
        and it will appear here.
      </p>
    )
  }

  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(inputClass, 'cursor-pointer')}
    >
      <option value="">No cloned voice</option>
      {voices.map((voice) => (
        <option key={voice.id} value={voice.voiceId ?? ''}>
          {voice.name}
        </option>
      ))}
    </select>
  )
}
