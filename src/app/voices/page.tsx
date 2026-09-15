import { redirect } from 'next/navigation'

import { VoiceStudio } from '@/components/voices/VoiceStudio'
import { currentUser } from '@/lib/auth'
import { ensureBooted } from '@/lib/boot'
import { hasApiKey } from '@/lib/kie/client'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Voices, Highfield' }

/**
 * Voice cloning, apart from the studio.
 *
 * Not a model in the picker: a voice is built over several steps with a
 * recording in the middle, and the result is reused across songs rather than
 * landing in the gallery. Sent back to the studio's own gate when signed out
 * or keyless, since that page already explains both.
 */
export default async function VoicesPage() {
  void ensureBooted()

  const user = await currentUser()
  if (!user || !(await hasApiKey())) redirect('/')

  return <VoiceStudio />
}
