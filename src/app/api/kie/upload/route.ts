import { NextResponse } from 'next/server'

import { KieError, uploadFile, uploadFromUrl } from '@/lib/kie/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Kie's URL-upload endpoint caps at 100MB; keep local uploads under that. */
const MAX_BYTES = 100 * 1024 * 1024

/**
 * POST /api/kie/upload
 *
 * Accepts either multipart form data (`file`) or JSON (`{ fileUrl }`), and
 * returns a public URL that generation endpoints can consume.
 */
export async function POST(req: Request) {
  const contentType = req.headers.get('content-type') ?? ''

  try {
    if (contentType.includes('application/json')) {
      const { fileUrl } = (await req.json()) as { fileUrl?: string }
      if (!fileUrl || !/^https?:\/\//.test(fileUrl)) {
        return NextResponse.json({ error: 'A valid fileUrl is required.' }, { status: 400 })
      }
      const data = await uploadFromUrl(fileUrl)
      return NextResponse.json({ url: data.fileUrl, name: data.fileName, size: data.fileSize })
    }

    const form = await req.formData()
    const file = form.get('file')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 })
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File is too large (${(file.size / 1e6).toFixed(1)}MB). Limit is 100MB.` },
        { status: 413 },
      )
    }

    const data = await uploadFile(file)
    return NextResponse.json({
      url: data.fileUrl,
      name: data.fileName,
      size: data.fileSize,
      mimeType: data.mimeType,
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
