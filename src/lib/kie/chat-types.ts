/**
 * How to reach a language model.
 *
 * Split out of `chat.ts` because the catalog carries these descriptors and
 * the catalog is read in the browser, while the transport itself is
 * server-only. Types alone are erased at build time; the values are not.
 */

export type ChatTransport =
  | 'openai-chat'
  | 'openai-responses'
  | 'grok-responses'
  | 'anthropic-messages'

export interface ChatEndpoint {
  transport: ChatTransport
  /** Value sent in the `model` field, where the transport takes one. */
  model: string
  /**
   * URL path segment, for transports that name the model in the URL. Falls
   * back to `model` when the two agree.
   */
  path?: string
  /** Reasoning effort levels this model accepts, if any. */
  effortLevels?: string[]
  /** The built-in search tool's name, when the model has one. */
  webSearch?: 'web_search' | 'googleSearch' | 'native'
  /** Accepts images alongside the prompt. */
  vision?: boolean
  /** Required by the Anthropic transport, which has no default of its own. */
  maxTokens?: number
}
