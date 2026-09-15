/**
 * Microphone recording, delivered as WAV.
 *
 * MediaRecorder produces WebM in Chrome, Ogg in Firefox and MP4 in Safari, and
 * nothing in Kie's docs says which of those Suno Voice will read. WAV is the
 * one format every audio pipeline takes, so the recording is decoded in the
 * browser and written back out as 16-bit PCM before it is uploaded.
 */

export interface Recording {
  /** Stops and returns the take as a WAV file. */
  stop: () => Promise<File>
  /** Stops and throws the take away. */
  cancel: () => void
}

export async function startRecording(name = 'recording.wav'): Promise<Recording> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    throw new Error('This browser cannot record audio. Upload a file instead.')
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const recorder = new MediaRecorder(stream)
  const chunks: Blob[] = []

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }
  recorder.start()

  // Releasing the tracks is what turns the browser's recording light off.
  const release = () => stream.getTracks().forEach((track) => track.stop())

  return {
    stop: () =>
      new Promise<File>((resolve, reject) => {
        recorder.onstop = async () => {
          release()
          try {
            resolve(await toWavFile(new Blob(chunks, { type: recorder.mimeType }), name))
          } catch (err) {
            reject(err)
          }
        }
        recorder.stop()
      }),
    cancel: () => {
      recorder.onstop = null
      if (recorder.state !== 'inactive') recorder.stop()
      release()
    },
  }
}

/** Decodes any browser-playable audio and re-encodes it as mono WAV. */
export async function toWavFile(blob: Blob, name: string): Promise<File> {
  const context = new AudioContext()
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer())
    return new File([encodeWav(audio)], name, { type: 'audio/wav' })
  } finally {
    void context.close()
  }
}

/**
 * Mono, because a voice sample carries nothing in the second channel worth
 * doubling the upload for.
 */
function encodeWav(audio: AudioBuffer): ArrayBuffer {
  const channels = audio.numberOfChannels
  const length = audio.length
  const rate = audio.sampleRate

  const mono = new Float32Array(length)
  for (let c = 0; c < channels; c++) {
    const data = audio.getChannelData(c)
    for (let i = 0; i < length; i++) mono[i]! += data[i]! / channels
  }

  const buffer = new ArrayBuffer(44 + length * 2)
  const view = new DataView(buffer)
  const ascii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i))
  }

  ascii(0, 'RIFF')
  view.setUint32(4, 36 + length * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, length * 2, true)

  for (let i = 0; i < length; i++) {
    const sample = Math.max(-1, Math.min(1, mono[i]!))
    view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }

  return buffer
}

/** Reads a local audio file's length without uploading it. */
export function audioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(Number.isFinite(audio.duration) ? audio.duration : 0)
    }
    audio.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That file could not be read as audio.'))
    }
    audio.src = url
  })
}

/** Uploads through Kie so the URL is one Kie itself can fetch. */
export async function uploadAudio(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch('/api/kie/upload', { method: 'POST', body: form })
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
  if (!res.ok || !data.url) throw new Error(data.error ?? 'Upload failed.')
  return data.url
}
