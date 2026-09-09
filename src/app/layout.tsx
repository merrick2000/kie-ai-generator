import type { Metadata, Viewport } from 'next'
import { Toaster } from 'sonner'

import '@/styles/globals.css'

export const metadata: Metadata = {
  title: 'Highfield, an AI generation studio',
  description:
    'A complete studio for image, video and audio generation across 45 models, powered by the Kie.ai API.',
}

export const viewport: Viewport = {
  themeColor: '#07070a',
  width: 'device-width',
  initialScale: 1,
  // No maximumScale. It was here to stop iOS zooming in when a field takes
  // focus, but that is caused by fields smaller than 16px and the fix for it
  // is in the stylesheet. Blocking zoom altogether takes the page away from
  // anyone who needs to magnify it.
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      {/*
        No height or overflow constraint here: this layout is shared by the
        studio, which fills the viewport and scrolls internally, and by the
        blog, which is a normal document that has to scroll. Pinning the body
        to the viewport froze every article page.
      */}
      <body className="antialiased">
        {children}
        {/*
          The height cap is not cosmetic. A toast's description is often a
          prompt, and a long one turned it into a column of text running the
          full height of the screen, on top of the gallery it was announcing.
          Callers trim their own text; this is the floor under all of them,
          including the ones that forget.
        */}
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: 'var(--color-overlay)',
              border: '1px solid var(--color-line-bright)',
              color: 'var(--color-ink)',
              maxHeight: 'min(40vh, 320px)',
              overflowY: 'auto',
              // A pasted URL or a prompt written without spaces would
              // otherwise push the toast wider than the window.
              overflowWrap: 'anywhere',
            },
          }}
        />
      </body>
    </html>
  )
}
