/**
 * Language model transports.
 *
 * Kie exposes four unrelated wire formats for text, and getting one wrong
 * means a rejected request or a silently empty answer. These checks cover the
 * request each transport builds and the four places an answer can be buried,
 * without spending a credit on any of them.
 *
 *   bun --preload ./scripts/preload.ts scripts/test-chat.mts
 */

import assert from 'node:assert/strict'

import { __internal } from '../src/lib/kie/chat'
import type { ChatEndpoint } from '../src/lib/kie/chat-types'
import { MODELS, getModel } from '../src/lib/kie/catalog'

const { buildBody, extractText, urlFor, readError, readUsage, envelopeFailure } =
  __internal

let passed = 0
function check(name: string, fn: () => void) {
  fn()
  passed++
  console.log(`  ok  ${name}`)
}

const chatModels = MODELS.filter((m) => m.api === 'chat')

const ANTHROPIC: ChatEndpoint = {
  transport: 'anthropic-messages',
  model: 'claude-opus-5',
  maxTokens: 4096,
}
const OPENAI_CHAT: ChatEndpoint = {
  transport: 'openai-chat',
  model: 'gpt-5-2',
  path: 'gpt-5-2',
  effortLevels: ['low', 'high'],
  webSearch: 'web_search',
  vision: true,
}
const RESPONSES: ChatEndpoint = {
  transport: 'openai-responses',
  model: 'gpt-5-6-sol',
  effortLevels: ['low', 'medium', 'high', 'xhigh'],
  webSearch: 'web_search',
}
const GROK: ChatEndpoint = {
  transport: 'grok-responses',
  model: 'grok-4-6',
  effortLevels: ['low', 'high'],
  webSearch: 'web_search',
}

console.log('\nchat catalog')

check('every chat model carries an endpoint', () => {
  assert.ok(chatModels.length > 0, 'no chat models in the catalog')
  for (const model of chatModels) {
    assert.ok(model.chat, `${model.id} has api 'chat' but no endpoint`)
    assert.equal(model.output, 'text', `${model.id} should output text`)
    assert.equal(model.category, 'text', `${model.id} should be in the text category`)
  }
})

check('every chat model has a prompt field', () => {
  for (const model of chatModels) {
    const prompt = model.fields.find((f) => f.name === 'prompt')
    assert.ok(prompt, `${model.id} has no prompt field`)
    assert.equal(prompt!.required, true, `${model.id}'s prompt must be required`)
  }
})

check('effort options match what the endpoint accepts', () => {
  for (const model of chatModels) {
    const field = model.fields.find((f) => f.name === 'effort')
    if (!field) continue

    const levels = model.chat!.effortLevels
    assert.ok(levels, `${model.id} offers an effort field but the endpoint takes none`)

    const offered = 'options' in field ? field.options.map((o) => o.value) : []
    for (const value of offered) {
      assert.ok(
        levels!.includes(value),
        `${model.id} offers effort "${value}" which the endpoint does not accept`,
      )
    }
  }
})

check('a search toggle only appears where there is a search tool', () => {
  for (const model of chatModels) {
    if (!model.fields.some((f) => f.name === 'web_search')) continue
    assert.ok(model.chat!.webSearch, `${model.id} offers search but has no tool configured`)
  }
})

check('an attachment field only appears on a vision endpoint', () => {
  for (const model of chatModels) {
    if (!model.fields.some((f) => f.name === 'image_urls')) continue
    assert.ok(model.chat!.vision, `${model.id} takes attachments but is not marked vision`)
  }
})

check('chat ids do not collide with market model slugs', () => {
  for (const model of chatModels) {
    // The id is a catalog key here, not something sent upstream, so it is
    // namespaced to keep it out of the way of the real slugs.
    assert.ok(model.id.startsWith('chat/'), `${model.id} should be namespaced`)
    assert.equal(getModel(model.id)!.id, model.id)
  }
})

console.log('\nchat endpoints')

check('each transport goes to its own URL', () => {
  assert.equal(urlFor(ANTHROPIC), 'https://api.kie.ai/claude/v1/messages')
  assert.equal(urlFor(RESPONSES), 'https://api.kie.ai/codex/v1/responses')
  assert.equal(urlFor(GROK), 'https://api.kie.ai/grok/v1/responses')
  assert.equal(urlFor(OPENAI_CHAT), 'https://api.kie.ai/gpt-5-2/v1/chat/completions')
})

check('the URL path can differ from the model name', () => {
  // Kie serves the OpenAI-shaped Gemini routes under their own slugs, which
  // are not the model string.
  assert.equal(
    urlFor({ transport: 'openai-chat', model: 'gemini-3-8-flash', path: 'gemini-3-8-flash-openai' }),
    'https://api.kie.ai/gemini-3-8-flash-openai/v1/chat/completions',
  )
})

console.log('\nchat requests')

check('streaming is off on every transport', () => {
  for (const endpoint of [ANTHROPIC, OPENAI_CHAT, RESPONSES, GROK]) {
    const body = buildBody(endpoint, { prompt: 'hello' })
    assert.equal(body.stream, false, `${endpoint.transport} left streaming on`)
  }
})

check('openai-chat sends no model field', () => {
  // The model is the URL path there, and one of Kie's own pages lists a
  // mismatched enum for the body field, so sending it would be trusting a
  // value their docs get wrong.
  const body = buildBody(OPENAI_CHAT, { prompt: 'hello' })
  assert.equal(body.model, undefined)
})

check('the other transports name the model in the body', () => {
  assert.equal(buildBody(ANTHROPIC, { prompt: 'x' }).model, 'claude-opus-5')
  assert.equal(buildBody(RESPONSES, { prompt: 'x' }).model, 'gpt-5-6-sol')
  assert.equal(buildBody(GROK, { prompt: 'x' }).model, 'grok-4-6')
})

check('anthropic takes max_tokens, which it has no default for', () => {
  const fallback = buildBody(ANTHROPIC, { prompt: 'x' })
  assert.equal(fallback.max_tokens, 4096)

  const explicit = buildBody(ANTHROPIC, { prompt: 'x', maxTokens: 32000 })
  assert.equal(explicit.max_tokens, 32000)
})

check('the system prompt goes where each vendor expects it', () => {
  // Anthropic takes it at the top level, not as a message.
  const claude = buildBody(ANTHROPIC, { prompt: 'x', system: 'Be terse.' })
  assert.equal(claude.system, 'Be terse.')
  assert.equal((claude.messages as unknown[]).length, 1)

  // OpenAI-shaped ones take it as the first message.
  const gpt = buildBody(OPENAI_CHAT, { prompt: 'x', system: 'Be terse.' })
  const messages = gpt.messages as { role: string; content: unknown }[]
  assert.equal(messages.length, 2)
  assert.equal(messages[0].role, 'system')
  assert.equal(messages[0].content, 'Be terse.')

  const responses = buildBody(RESPONSES, { prompt: 'x', system: 'Be terse.' })
  const input = responses.input as { role: string }[]
  assert.equal(input[0].role, 'system')
})

check('an absent system prompt adds no empty field', () => {
  const body = buildBody(ANTHROPIC, { prompt: 'x' })
  assert.equal('system' in body, false)
})

check('attachments use the unified image_url envelope', () => {
  const body = buildBody(OPENAI_CHAT, {
    prompt: 'What is this?',
    imageUrls: ['https://example.com/a.png'],
  })
  const content = (body.messages as { content: unknown }[])[0].content as Record<
    string,
    unknown
  >[]

  assert.equal(content[0].type, 'text')
  assert.deepEqual(content[1], {
    type: 'image_url',
    image_url: { url: 'https://example.com/a.png' },
  })
})

check('attachments are dropped on an endpoint without vision', () => {
  const body = buildBody(RESPONSES, {
    prompt: 'hello',
    imageUrls: ['https://example.com/a.png'],
  })
  // A URL sent to a transport whose docs do not describe media would be
  // rejected, or worse, silently ignored after being paid for.
  assert.equal(JSON.stringify(body).includes('example.com'), false)
})

check('an effort the model does not accept is dropped', () => {
  const valid = buildBody(RESPONSES, { prompt: 'x', effort: 'xhigh' })
  assert.deepEqual(valid.reasoning, { effort: 'xhigh' })

  // GPT 5.2 only takes low and high, so "medium" must not be forwarded.
  const invalid = buildBody(OPENAI_CHAT, { prompt: 'x', effort: 'medium' })
  assert.equal('reasoning_effort' in invalid, false)
})

check('search tools take the shape each transport wants', () => {
  const responses = buildBody(RESPONSES, { prompt: 'x', webSearch: true })
  assert.deepEqual(responses.tools, [{ type: 'web_search' }])

  const openai = buildBody(OPENAI_CHAT, { prompt: 'x', webSearch: true })
  assert.deepEqual(openai.tools, [{ type: 'function', function: { name: 'web_search' } }])

  const gemini = buildBody(
    { transport: 'openai-chat', model: 'gemini-3-pro', webSearch: 'googleSearch' },
    { prompt: 'x', webSearch: true },
  )
  assert.deepEqual(gemini.tools, [
    { type: 'function', function: { name: 'googleSearch' } },
  ])
})

check('no tools are sent when search is off', () => {
  assert.equal('tools' in buildBody(OPENAI_CHAT, { prompt: 'x' }), false)
  assert.equal('tools' in buildBody(RESPONSES, { prompt: 'x', webSearch: false }), false)
})

console.log('\nchat responses')

check('openai-chat answers are read from choices', () => {
  const text = extractText('openai-chat', {
    choices: [{ message: { role: 'assistant', content: 'Hello there.' } }],
  })
  assert.equal(text, 'Hello there.')
})

check('anthropic answers are read from content blocks', () => {
  const text = extractText('anthropic-messages', {
    content: [
      { type: 'text', text: 'First part.' },
      { type: 'text', text: 'Second part.' },
    ],
  })
  assert.equal(text, 'First part.\nSecond part.')
})

check('responses answers skip the reasoning items', () => {
  const text = extractText('openai-responses', {
    output: [
      { type: 'reasoning', id: 'rs_1', summary: [] },
      {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'The answer.' }],
      },
    ],
  })
  // A reasoning item has no text, and including it would put an empty line
  // or a stray summary in front of every answer.
  assert.equal(text, 'The answer.')
})

check('grok answers read the same way', () => {
  const text = extractText('grok-responses', {
    output: [
      { type: 'message', content: [{ type: 'output_text', text: 'Grok says hi.' }] },
    ],
  })
  assert.equal(text, 'Grok says hi.')
})

check('a plain string content still reads', () => {
  const text = extractText('openai-chat', {
    choices: [{ message: { content: 'Just a string.' } }],
  })
  assert.equal(text, 'Just a string.')
})

check('an empty answer reads as empty rather than throwing', () => {
  assert.equal(extractText('openai-chat', {}), '')
  assert.equal(extractText('anthropic-messages', {}), '')
  assert.equal(extractText('openai-responses', {}), '')
})

check('usage is read from either token naming', () => {
  assert.deepEqual(readUsage({ usage: { input_tokens: 10, output_tokens: 5 } }), {
    inputTokens: 10,
    outputTokens: 5,
  })
  assert.deepEqual(readUsage({ usage: { prompt_tokens: 7, completion_tokens: 3 } }), {
    inputTokens: 7,
    outputTokens: 3,
  })
  assert.deepEqual(readUsage({}), { inputTokens: null, outputTokens: null })
})

check('a failure inside a 200 is recognised', () => {
  // Verified against all four endpoints: an expired key comes back as HTTP
  // 200 with `code: 401` in the body. Reading only the status turned that
  // into "the model returned an empty answer", which sends you looking at
  // your prompt instead of your key.
  assert.equal(envelopeFailure({ code: 401, msg: 'Unauthorized' }), 401)
  assert.equal(envelopeFailure({ code: 402, msg: 'Out of credits' }), 402)
})

check('a real answer is not mistaken for an envelope', () => {
  // A chat completion carries no `code` of its own, and code 200 is success.
  assert.equal(envelopeFailure({ choices: [] }), null)
  assert.equal(envelopeFailure({ code: 200, choices: [] }), null)
  // A string there is something else entirely, not a status.
  assert.equal(envelopeFailure({ code: 'stop' }), null)
})

check('an error message is found wherever the vendor put it', () => {
  assert.equal(readError({ error: { message: 'Bad prompt.' } }, 400), 'Bad prompt.')
  assert.equal(readError({ error: 'Rate limited.' }, 429), 'Rate limited.')
  assert.equal(readError({ msg: 'Out of credits.' }, 402), 'Out of credits.')
  assert.equal(readError({ message: 'Nope.' }, 400), 'Nope.')
  // Nothing usable in the body still says something useful.
  assert.equal(readError({}, 503), 'The model returned HTTP 503.')
})

console.log(`\n${passed} checks passed`)
