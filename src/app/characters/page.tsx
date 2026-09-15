import { redirect } from 'next/navigation'

import { CharacterStudio } from '@/components/characters/CharacterStudio'
import { currentUser } from '@/lib/auth'
import { ensureBooted } from '@/lib/boot'
import { hasApiKey } from '@/lib/kie/client'

export const dynamic = 'force-dynamic'

export const metadata = { title: 'Characters, Highfield' }

/** Gemini Omni voices and characters, made here and picked in Omni video. */
export default async function CharactersPage() {
  void ensureBooted()
  const user = await currentUser()
  if (!user || !(await hasApiKey())) redirect('/')
  return <CharacterStudio />
}
