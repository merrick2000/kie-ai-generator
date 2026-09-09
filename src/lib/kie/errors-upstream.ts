/**
 * Plain wording for a provider's refusal.
 *
 * Kie passes the provider's own message through untouched, so a Veo refusal
 * arrives as `PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED` and lands on the
 * card exactly like that. It is an accurate string and a useless one: it does
 * not say what was refused, whether retrying could work, or what to change.
 *
 * Only codes worth explaining are listed. Anything else is passed through, on
 * the grounds that an unfamiliar message is still better than a wrong
 * paraphrase of one.
 */

interface Explained {
  match: RegExp
  text: string
}

const KNOWN: Explained[] = [
  {
    // Google refuses to generate or continue footage with a recognisable
    // person in it. Rerunning changes nothing; the source has to.
    match: /PROMINENT_PEOPLE_FILTER/i,
    text: 'Google refused this: the clip shows a recognisable person. Its filter blocks that whatever the prompt says, so a rerun will fail the same way. Start from a source without an identifiable face.',
  },
  {
    match: /SAFETY_FILTER|CONTENT_POLICY|content policy|violates/i,
    text: "The provider's content filter refused this. The prompt or the source image is what it objected to, not the settings.",
  },
  {
    match: /PUBLIC_ERROR_(IMAGE|VIDEO)_(SAFETY|MODERATION)/i,
    text: 'The provider refused the image or video that was sent in, before generating anything.',
  },
  {
    match: /RECITATION|COPYRIGHT/i,
    text: 'The provider refused this as too close to material it will not reproduce. Describing the subject rather than naming it usually gets past this.',
  },
  {
    match: /timeout|timed out|deadline/i,
    text: 'The provider ran out of time on this one. A rerun often works, and a shorter clip or a lower resolution works more often.',
  },
  {
    match: /insufficient|not enough credit|balance/i,
    text: 'The upstream account is out of credits.',
  },
  {
    match: /rate.?limit|too many requests|429/i,
    text: 'The provider is rate limiting this account. Waiting a minute and running it again is usually enough.',
  },
]

/**
 * Returns a sentence a person can act on, or the original when there is
 * nothing better to say.
 *
 * The raw text is kept alongside rather than discarded: it is what anyone
 * would quote to Kie's support, and losing it to make the card read nicely
 * would be a poor trade.
 */
export function explainUpstream(message: string | null | undefined): string | null {
  if (!message) return null

  const raw = message.trim()
  if (!raw) return null

  const known = KNOWN.find((entry) => entry.match.test(raw))
  return known ? `${known.text} (${raw})` : raw
}
