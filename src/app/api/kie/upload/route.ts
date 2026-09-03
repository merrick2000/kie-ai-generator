import { NextResponse } from 'next/server'

import { currentUser } from '@/lib/auth'
import { KieError, uploadFile, uploadFromUrl } from '@/lib/kie/client'
import { withLogging } from '@/lib/api-logging'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Kie's URL-upload endpoint caps at 100MB; keep local uploads under that. */
const MAX_BYTES = 100 * 1024 * 1024

/**
 * POST /api/kie/upload
 *
 * Accepts either multipart form data (`file`) or JSON (`{ fileUrl }`), and
 * returns a public URL that generation endpoints can consume.
 *
 * The JSON form is also how a generated result becomes an input for the next
 * generation: Kie fetches the asset server-side, so it never travels down to
 * the browser and back up.
 */
async function handlePOST(req: Request) {
  // Uploads spend the user's own Kie quota and land in their own directory,
  // so an anonymous caller has no business here.
  const user = await currentUser()
  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const contentType = req.headers.get('content-type') ?? ''

  try {
    if (contentType.includes('application/json')) {
      const { fileUrl, fileName } = (await req.json()) as {
        fileUrl?: string
        fileName?: string
      }

      if (!fileUrl || !/^https?:\/\//.test(fileUrl)) {
        return NextResponse.json({ error: 'A valid fileUrl is required.' }, { status: 400 })
      }

      const data = await uploadFromUrl(fileUrl, user.id, fileName)
      return NextResponse.json({
        url: data.fileUrl,
        name: data.fileName,
        size: data.fileSize,
        mimeType: data.mimeType,
        expiresAt: data.expiresAt,
      })
    }

    const form = await req.formData()
    const file = form.get('file')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 })
    }
    if (file.size === 0) {
      return NextResponse.json({ error: 'That file is empty.' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File is too large (${(file.size / 1e6).toFixed(1)}MB). Limit is 100MB.` },
        { status: 413 },
      )
    }

    const data = await uploadFile(file, user.id)
    return NextResponse.json({
      url: data.fileUrl,
      name: data.fileName,
      size: data.fileSize,
      mimeType: data.mimeType,
      // Kie deletes uploads within a day or three depending on which page of
      // their docs you read, so the real value is passed through.
      expiresAt: data.expiresAt,
    })
  } catch (err) {
    if (err instanceof KieError) {
      return NextResponse.json({ error: err.message }, { status: err.clientStatus })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed.' },
      { status: 500 },
    )
  }
}

export const POST = withLogging(handlePOST)
