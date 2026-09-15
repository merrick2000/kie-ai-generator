/**
 * Moving a voice through Kie's steps.
 *
 * Nothing here runs on a timer. A step is advanced when the voice is read, so
 * the state survives a closed tab exactly as a generation does, and a voice
 * nobody looks at costs nothing.
 */

import 'server-only'

import { callerIp, record } from '@/lib/activity'
import { createTask, getTask, KieError } from '@/lib/kie/client'
import { explainUpstream } from '@/lib/kie/errors-upstream'
import { createLogger } from '@/lib/logger'
import {
  checkSegment,
  createInput,
  phraseInput,
  readVoiceResult,
  SINGER_LEVELS,
  VOICE_LANGUAGES,
  VOICE_MODELS,
} from './kie'
import { getVoice, insertVoice, newVoiceId, updateVoice, type Voice } from './store'

const log = createLogger('voices')

export interface Actor {
  id: string
  email: string
}

export type FlowResult =
  | { ok: true; voice: Voice }
  | { ok: false; error: string; status: number }

function refused(error: string, status = 400): FlowResult {
  return { ok: false, error, status }
}

/** A Kie refusal as a result rather than a throw, with the reason kept. */
function upstream(err: unknown, fallback: string): FlowResult {
  if (err instanceof KieError) {
    return refused(explainUpstream(err.message) ?? fallback, err.clientStatus)
  }
  log.error('voice step failed', { error: err })
  return refused(fallback, 500)
}

async function submit(model: string, input: Record<string, unknown>): Promise<string> {
  const { taskId } = await createTask({ model, input })
  return taskId
}

export interface StartInput {
  name: unknown
  sourceUrl: unknown
  startS: unknown
  endS: unknown
  language: unknown
  description?: unknown
  style?: unknown
  singerSkillLevel?: unknown
  consent: unknown
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, max) : null
}

/** Step one: a recording in, a phrase requested. */
export async function startVoice(actor: Actor, input: StartInput): Promise<FlowResult> {
  // Asked before anything is spent. Kie's own design already makes the owner
  // read a sentence aloud; this is the account holder saying so in words, and
  // the moment is recorded with the voice.
  if (input.consent !== true) {
    return refused('Confirm that this is your voice, or that you have permission to clone it.')
  }

  const name = text(input.name, 80)
  if (!name) return refused('Give the voice a name.')

  const sourceUrl = text(input.sourceUrl, 2000)
  if (!sourceUrl || !/^https:\/\//.test(sourceUrl)) {
    return refused('Upload the recording to take the voice from.')
  }

  const segment = checkSegment(input.startS, input.endS)
  if (segment) return refused(segment)

  const language = typeof input.language === 'string' ? input.language : ''
  if (!VOICE_LANGUAGES.some((l) => l.value === language)) {
    return refused('Pick a language for the phrase.')
  }

  const level =
    typeof input.singerSkillLevel === 'string' &&
    (SINGER_LEVELS as readonly string[]).includes(input.singerSkillLevel)
      ? input.singerSkillLevel
      : null

  const startS = Number(input.startS)
  const endS = Number(input.endS)

  let phraseTaskId: string
  try {
    phraseTaskId = await submit(
      VOICE_MODELS.phrase,
      phraseInput({ sourceUrl, startS, endS, language }),
    )
  } catch (err) {
    return upstream(err, 'Kie did not accept the recording.')
  }

  const voice = await insertVoice({
    id: newVoiceId(),
    userId: actor.id,
    name,
    description: text(input.description, 500),
    style: text(input.style, 200),
    language,
    singerSkillLevel: level,
    sourceUrl,
    vocalStartS: startS,
    vocalEndS: endS,
    phraseTaskId,
    status: 'phrase_pending',
    consentAt: Date.now(),
  })

  await record({
    kind: 'voice_started',
    userId: actor.id,
    email: actor.email,
    summary: name,
    meta: { voiceId: voice.id, seconds: endS - startS, language },
    ip: await callerIp(),
  })

  return { ok: true, voice }
}

/** Asks Kie for a fresh phrase when the last one expired or was misread. */
export async function regeneratePhrase(actor: Actor, voiceId: string): Promise<FlowResult> {
  const voice = await getVoice(actor.id, voiceId)
  if (!voice) return refused('Not found.', 404)

  if (!voice.phraseTaskId || voice.voiceId) {
    return refused('This voice has no phrase to replace.')
  }

  try {
    const taskId = await submit(VOICE_MODELS.regenerate, { task_id: voice.phraseTaskId })
    const updated = await updateVoice(actor.id, voice.id, {
      regenerateTaskId: taskId,
      phrase: null,
      status: 'phrase_pending',
      error: null,
    })
    return updated ? { ok: true, voice: updated } : refused('Not found.', 404)
  } catch (err) {
    return upstream(err, 'Kie could not write a new phrase.')
  }
}

/** Step two: the owner's reading in, the voice requested. */
export async function verifyVoice(
  actor: Actor,
  voiceId: string,
  verifyUrl: unknown,
): Promise<FlowResult> {
  const voice = await getVoice(actor.id, voiceId)
  if (!voice) return refused('Not found.', 404)

  if (!voice.phrase || !voice.phraseTaskId) {
    return refused('There is no phrase to read yet.')
  }
  if (voice.status !== 'phrase_ready' && voice.status !== 'failed') {
    return refused('This voice is not waiting for a reading.')
  }

  const url = text(verifyUrl, 2000)
  if (!url || !/^https:\/\//.test(url)) return refused('Record or upload the reading first.')

  try {
    const taskId = await submit(
      VOICE_MODELS.create,
      createInput({
        // The original task, as the docs ask, even after a regenerated phrase.
        phraseTaskId: voice.phraseTaskId,
        verifyUrl: url,
        name: voice.name,
        description: voice.description,
        style: voice.style,
        singerSkillLevel: voice.singerSkillLevel,
      }),
    )
    const updated = await updateVoice(actor.id, voice.id, {
      verifyUrl: url,
      createTaskId: taskId,
      status: 'creating',
      error: null,
    })
    return updated ? { ok: true, voice: updated } : refused('Not found.', 404)
  } catch (err) {
    return upstream(err, 'Kie did not accept the reading.')
  }
}

/**
 * Advances whichever step is waiting on Kie, if any.
 *
 * Never throws: a failed poll leaves the voice where it was, to be tried again
 * on the next read, rather than marking a slow upstream as a failed voice.
 */
export async function refreshVoice(voice: Voice, actor?: Actor): Promise<Voice> {
  const patch = (p: Parameters<typeof updateVoice>[2]) =>
    updateVoice(voice.userId, voice.id, p).then((v) => v ?? voice)

  try {
    if (voice.status === 'phrase_pending') {
      const taskId = voice.regenerateTaskId ?? voice.phraseTaskId
      if (!taskId) return voice

      const task = await getTask(taskId)
      if (task.state === 'fail') {
        return patch({
          status: 'failed',
          error: explainUpstream(task.failMsg) ?? 'Kie could not write a phrase for this recording.',
        })
      }
      if (task.state !== 'success') return voice

      const { phrase } = readVoiceResult(task.resultJson)
      if (phrase) return patch({ status: 'phrase_ready', phrase, error: null })

      log.warn('phrase step finished without a phrase', {
        voice: voice.id,
        resultJson: task.resultJson?.slice(0, 600),
      })
      return patch({ status: 'failed', error: 'Kie finished the phrase step but sent no phrase back.' })
    }

    if (voice.status === 'creating' && voice.createTaskId) {
      const task = await getTask(voice.createTaskId)
      if (task.state === 'fail') {
        return patch({
          status: 'failed',
          error:
            explainUpstream(task.failMsg) ??
            'Kie could not build a voice from that reading. Read the phrase again, clearly, and resubmit.',
        })
      }
      if (task.state !== 'success') return voice

      const { voiceId } = readVoiceResult(task.resultJson)
      if (!voiceId) {
        log.warn('voice step finished without a voiceId', {
          voice: voice.id,
          resultJson: task.resultJson?.slice(0, 600),
        })
        return patch({ status: 'failed', error: 'Kie finished the voice but sent no voice id back.' })
      }

      const ready = await patch({ status: 'ready', voiceId, error: null })
      await record({
        kind: 'voice_created',
        userId: voice.userId,
        email: actor?.email ?? null,
        summary: voice.name,
        meta: { voice: voice.id },
        ip: await callerIp(),
      })
      return ready
    }

    // The voice is usable once its id exists. The availability check only
    // refines that, so it runs once, and stops at the first answer or error.
    if (voice.status === 'ready' && voice.voiceId && voice.available === null && !voice.error) {
      if (!voice.checkTaskId) {
        if (!voice.createTaskId) return voice
        const taskId = await submit(VOICE_MODELS.check, { task_id: voice.createTaskId })
        return patch({ checkTaskId: taskId })
      }

      const task = await getTask(voice.checkTaskId)
      if (task.state === 'fail') {
        return patch({ error: 'Kie could not confirm this voice is available yet.' })
      }
      if (task.state !== 'success') return voice

      const { available } = readVoiceResult(task.resultJson)
      if (available === undefined) {
        log.warn('check step finished without isAvailable', {
          voice: voice.id,
          resultJson: task.resultJson?.slice(0, 600),
        })
        return patch({ error: 'Kie did not say whether this voice is available.' })
      }
      return patch({ available })
    }
  } catch (err) {
    log.warn('could not advance a voice', { voice: voice.id, error: err })
  }

  return voice
}

/** What the browser is told. No task ids, no account id, no consent stamp. */
export function publicVoice(voice: Voice) {
  return {
    id: voice.id,
    name: voice.name,
    description: voice.description,
    style: voice.style,
    language: voice.language,
    singerSkillLevel: voice.singerSkillLevel,
    sourceUrl: voice.sourceUrl,
    vocalStartS: voice.vocalStartS,
    vocalEndS: voice.vocalEndS,
    phrase: voice.phrase,
    verifyUrl: voice.verifyUrl,
    voiceId: voice.voiceId,
    available: voice.available,
    status: voice.status,
    error: voice.error,
    createdAt: voice.createdAt,
    updatedAt: voice.updatedAt,
  }
}

export type PublicVoice = ReturnType<typeof publicVoice>

/** Whether a read should try to advance this voice. */
export function isWaiting(voice: Voice): boolean {
  return (
    voice.status === 'phrase_pending' ||
    voice.status === 'creating' ||
    (voice.status === 'ready' && voice.available === null && !voice.error)
  )
}
