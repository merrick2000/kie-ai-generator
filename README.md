# Highfield

A complete AI generation studio built on the [Kie.ai](https://kie.ai) API.
Image, video, audio and enhancement across **55 models**, in one interface.

![stack](https://img.shields.io/badge/Next.js-15-black) ![stack](https://img.shields.io/badge/React-19-blue) ![stack](https://img.shields.io/badge/Tailwind-4-38bdf8)

---

## Quick start

```bash
cp .env.example .env.local     # optional, see Configuration
bun install                    # or npm install
bun run dev                    # http://localhost:3400
```

Then create an account in the app and connect your Kie.ai API key. Get a key at
[kie.ai/api-key](https://kie.ai/api-key).

```bash
docker compose -f docker-compose.dev.yml up -d
DATABASE_URL=postgres://postgres:postgres@localhost:5432/highfield npm test
```

---

## Accounts

Highfield has its own accounts, and each one carries its owner's Kie.ai key.
One instance can serve several people, each billing their own Kie account.

The first run walks through two steps: create an account with an email and
password, then connect a key. The key is validated against Kie.ai before it is
stored, so a typo surfaces immediately rather than on the first generation.

| Concern | How it works |
|---|---|
| Passwords | scrypt (N=65536, r=8, p=1), random salt per user, timing-safe compare |
| Sessions | random 32-byte token in an httpOnly cookie; only its SHA-256 is stored |
| API keys | AES-256-GCM at rest, decrypted server-side only to call Kie.ai |

---

## Database

Postgres, required. An earlier build also supported SQLite; it was dropped
because carrying two dialects made every query the intersection of both, and
any deployment worth running needs Postgres anyway. The app container is now
stateless, so it can be replaced or scaled freely.

```bash
docker compose -f docker-compose.dev.yml up -d    # local Postgres
```

Migrations run automatically at startup, each in its own transaction. Schema
lives in `lib/db/schema.ts`; queries are written with `?` placeholders and
rewritten to `$1, $2` by the client, so no call site hand-numbers parameters.

---

## Blog

`/blog` is public. It sits outside the studio's auth gate, so anyone can read
it without an account, while `/` still resolves to sign-in, key setup or the
studio.

Articles arrive from an external publisher over a signed webhook.

```
POST /api/webhooks/articles
X-Webhook-Signature: sha256=<hmac>
X-Webhook-Timestamp: <unix seconds>
X-Webhook-Event: article.published
```

The signature is `HMAC-SHA256(secret, timestamp + "." + rawBody)`, checked
against the **raw** bytes: re-serialising the parsed JSON would change key
order and whitespace, and no signature would ever match.

| Step | Behaviour |
|---|---|
| Unsigned or wrong secret | `401`, nothing stored |
| Timestamp older than 5 minutes | `401`, bounds replay |
| Body fails to parse or is empty once sanitised | `400` / `422`, not retried |
| Known article id resent | updated in place, `200` |
| New article | stored, `201` with `{ url }` |
| Database problem | `500`, so the sender retries |

The response carries `{ "url": "https://…/blog/<slug>" }` for the publisher to
link back to.

### The body is sanitised before it is stored

The webhook is authenticated, which is not the same as the content being safe:
the body is authored upstream and rendered into this origin with
`dangerouslySetInnerHTML`. It is filtered against an allowlist on the way in,
so `<script>`, event handlers, `javascript:` URLs and inline styles never reach
the database. Filtering on write rather than on read means the stored row is
safe by construction and no future rendering path can forget.

Set `ARTICLE_WEBHOOK_SECRET`, or the endpoint refuses every delivery with
`503` rather than accepting unsigned HTML.

### Configuration### Configuration
### Configuration

Every variable is optional.

| Variable | Purpose |
|---|---|
| `APP_SECRET` | Encrypts stored API keys. Generated and kept in the database if unset. Set it explicitly so it can be rotated and lives outside the store it protects. |
| `KIE_API_KEY` | Fallback key used when a user has not set their own. Leave blank for a pure bring-your-own-key instance. |
| `KIE_WEBHOOK_HMAC_KEY` | Verifies webhook callbacks. |
| `NEXT_PUBLIC_APP_URL` | Public origin for `callBackUrl`. Without it, the studio polls. |
| `SIGNUPS_ENABLED` | `false` closes registration after the first account. See [DEPLOY.md](DEPLOY.md). |
| `DATABASE_URL` | **Required.** Postgres connection string. |
| `ARTICLE_WEBHOOK_SECRET` | Signing secret for the blog webhook. |
| `ARTICLE_WEBHOOK_TOKEN` | Optional bearer token, checked in addition to the signature. |

---

## What's inside

**Models.** Nano Banana 2, Seedream 5 Pro, FLUX.2, GPT Image 2, Z-Image, Imagen 4,
Ideogram V3 + Character, Qwen 3, Grok Imagine · Veo 3.1, Seedance 2, Kling 3
Turbo/Omni, Wan 2.7, Hailuo, MiniMax H3, PixVerse · OmniHuman 1.5, Kling Avatar,
Kling Motion Control, InfiniTalk · Suno, ElevenLabs · Topaz upscale, Recraft
cutout.

**The studio.** Model search across every family, schema-driven parameter forms,
drag-and-drop asset upload, aspect-ratio tiles, seed control, live progress,
a full-screen viewer with the run's parameters, and a persistent library.

---

## Architecture

```
src/
├─ lib/
│  ├─ db/            Postgres client and migrations
│  ├─ auth/          Accounts: passwords, sessions, repositories
│  ├─ blog/          Webhook verification, sanitisation, articles
│  └─ kie/
│     ├─ types.ts    Wire types for all three Kie API surfaces
│     ├─ client.ts   Server-only HTTP client (auth, retries, errors)
│     ├─ catalog.ts  55 models to declarative field schemas
│     ├─ fields.ts   Field system: defaults, validation, input building
│     └─ tasks.ts    Adapter normalising market/veo/suno into one shape
├─ app/blog/        Public articles, no authentication
├─ app/api/
│  ├─ auth/          Sign up, sign in, sign out, password
│  ├─ webhooks/      Signed article intake
│  └─ kie/           Proxy routes: the API key never leaves the server
├─ components/       Auth, onboarding, studio, settings
├─ hooks/            Generation polling, credits, uploads, session
└─ store/            Zustand + IndexedDB persistence
```

### Three APIs, one interface

Kie exposes generation through unrelated shapes. `lib/kie/tasks.ts` is the only
file that knows the difference:

| Transport | Create | Poll | Completion signal |
|---|---|---|---|
| `market` | `POST /api/v1/jobs/createTask` | `GET /api/v1/jobs/recordInfo` | `state` string |
| `veo` | `POST /api/v1/veo/generate` | `GET /api/v1/veo/record-info` | `successFlag` integer |
| `suno` | `POST /api/v1/generate` | `GET /api/v1/generate/record-info` | `status` enum |

Everything above that layer sees one `NormalizedTask`.

### Adding a model

Append an entry to `src/lib/kie/catalog.ts`. The form, validation, request body
and result rendering all derive from it: no UI code to touch.

```ts
{
  id: 'vendor/model-slug',        // exact Kie model string
  name: 'Model Name',
  family: 'Vendor',
  category: 'image',
  mode: 'text-to-image',
  api: 'market',
  output: 'image',
  tagline: 'One line on what it is good at.',
  speed: 'fast',
  fields: [
    prompt({ maxLength: 5000 }),
    ratio(['1:1', '16:9', '9:16'], '1:1'),
    nsfwChecker(),
  ],
}
```

---

## Security

- **API keys never reach the browser.** `lib/kie/client.ts` imports
  `server-only`; every browser call goes through `/api/kie/*`.
- **Keys are encrypted at rest** with AES-256-GCM and decrypted only to call
  Kie.ai. A leaked database alone does not reveal them.
- **Passwords are never stored**, only scrypt hashes with a per-user salt.
- **Email uniqueness is enforced by the database**, so two simultaneous signups
  for one address cannot both succeed.
- **Session tokens are never stored**, only their SHA-256 digests.
- **Sign-in does not leak which emails exist**: unknown addresses take the same
  path and return the same message as a wrong password.
- **Submissions are re-validated server-side** in `/api/kie/create`, so a
  tampered client cannot spend credits on a malformed job.
- **Webhooks are HMAC-verified** (`taskId.timestamp`, SHA-256, base64) with a
  timing-safe compare and a 5-minute skew window.
- **The asset proxy is host-restricted** to known Kie/provider CDNs: it cannot
  be used as an open relay.
- **Incoming article HTML is sanitised on write**, so a compromised or careless
  publisher cannot land a stored XSS on this origin.

## Notes

- **Kie asset URLs are temporary.** Download anything worth keeping; the studio
  shows a clear message when a link has expired.
- **Webhooks need a public origin.** Set `NEXT_PUBLIC_APP_URL` to a reachable
  URL (a tunnel in dev). Without it the studio polls, which works everywhere.
- **There is no cancel endpoint.** Stopping a job stops local tracking only.
  The task still runs, and still bills, upstream.
- **Rate limit** is 20 requests / 10s per account; polling backs off from 1.5s
  to 8s to stay well inside it.

---

## Deployment

CI runs typecheck, the full test suite against a real Postgres, and a
production build. Each commit is packaged as a Docker image, published to GHCR,
and deployed by webhook.

See **[DEPLOY.md](DEPLOY.md)** for the full guide, including which database to
pick and why `APP_SECRET` is not optional in production.
