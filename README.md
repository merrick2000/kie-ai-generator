# Highfield

A complete AI generation studio built on the [Kie.ai](https://kie.ai) API.
Image, video, audio, text and enhancement across **56 models**, in one
interface, with every generation carried to completion server-side.

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
Kling Motion Control, InfiniTalk · Suno, ElevenLabs · Claude Opus 5 and
Sonnet 5, GPT 5.2 and 5.6, Gemini 3 Pro, Grok 4.6 · Topaz upscale, Recraft
cutout.

**The studio.** Model search across every family, schema-driven parameter forms,
drag-and-drop asset upload, aspect-ratio tiles, seed control, live progress,
a full-screen viewer with the run's parameters, projects with their own
defaults, a searchable gallery, and a ranking of the models that actually work
on this account.

**Generations survive the browser.** A run is recorded server-side before it is
submitted and polled there until it finishes, so reloading the page, closing
the tab or redeploying the container does not lose it. Open the studio on
another device and the same history is there.

---

## Architecture

```
src/
├─ lib/
│  ├─ db/            Postgres client and migrations
│  ├─ auth/          Accounts: passwords, sessions, repositories
│  ├─ blog/          Webhook verification, sanitisation, articles
│  ├─ jobs/          Job records, the runner, usage aggregates
│  ├─ projects/      Folders with their own defaults
│  ├─ boot.ts        Starts the reconciler on the first request
│  └─ kie/
│     ├─ types.ts    Wire types for the Kie job APIs
│     ├─ client.ts   Server-only HTTP client (auth, retries, errors)
│     ├─ chat.ts     The four language-model transports
│     ├─ catalog.ts  56 models to declarative field schemas
│     ├─ fields.ts   Field system: defaults, validation, input building
│     ├─ tasks.ts    Adapter normalising market/veo/suno into one shape
│     └─ reconciler.ts  Carries every running job to completion
├─ app/blog/        Public articles, no authentication
├─ app/api/
│  ├─ auth/          Sign up, sign in, sign out, password
│  ├─ jobs/          The gallery and the sync loop
│  ├─ projects/      Project CRUD
│  ├─ stats/         Which models actually work here
│  ├─ webhooks/      Signed article intake
│  └─ kie/           Proxy routes: the API key never leaves the server
├─ components/       Auth, onboarding, studio, settings
├─ hooks/            Workspace sync, generation, credits, uploads, session
└─ store/            Zustand, mirroring what the server holds
```

### Generations outlive the tab that started them

The browser used to own polling, which meant a generation only existed for as
long as its tab did: reload, and the job was orphaned mid-flight with the
credits already spent.

Now `/api/kie/create` writes the job to Postgres *before* submitting it, and a
loop in `lib/kie/reconciler.ts` carries it the rest of the way whether or not
anyone is watching. The browser only reads.

- Jobs are claimed with a lease and `FOR UPDATE SKIP LOCKED`, so several
  instances can run the reconciler without two of them polling one task.
- The poll interval widens with a job's age, and every request is spent from a
  per-account token bucket, so a busy user cannot throttle anyone else.
- Kie's callback does not carry the result: it brings the next poll forward to
  now. The callback body differs per transport and can arrive out of order, so
  it is a hint to go and look, never a second source of truth.
- A job that was inserted but never submitted is closed after two minutes with
  a message saying nothing was charged.

The browser runs one sync loop for the whole studio, asking only for what
changed since its last answer: 2s while something is generating, 20s otherwise,
and nothing at all while the tab is hidden.

### Several at once

Of the 177 model pages Kie publishes, seven take a count of their own:
Seedream 4 and its edit variant take `max_images` (1 to 6), and Ideogram's
character, character-edit, character-remix and v3-remix endpoints plus Qwen's
image-edit take `num_images` (1 to 4). Everything else produces one image per
request, whatever its sibling endpoints do.

So the composer has a run count beside Generate. It submits the same prompt
several times, giving each run its own seed, because four runs of one prompt
with one seed are four copies of the same picture. An explicit seed is walked
forward from rather than replaced, so a batch started from a result you liked
stays anchored to it; a blank one is filled in, which also makes every
variation reproducible afterwards.

The two multiply, and the footer says what one press will actually produce:
four runs of a model set to three images is twelve files.

Runs go out one at a time rather than together, since each is a submission
against the same rate limit, and the batch stops at the first refusal: a
rejected prompt or an empty balance does not improve on the next attempt.

### On a phone

The studio is usable on a small screen rather than merely reachable from one.

The composer is a full-height sheet below 1024px, opened from a Create button
in the thumb's reach rather than from a corner control that used to sit on top
of the search field. The gallery keeps two columns instead of one enormous
card, the search gets a row of its own rather than the 121px it was sharing
with three other controls, and the viewer's actions collapse to icons so Close
never leaves the screen: without it, and with no keyboard for Escape, a result
opened on a phone could not be closed.

Fields are 16px on small screens. iOS zooms the page in when a smaller one
takes focus and then leaves it zoomed, and the usual fix, `maximum-scale=1`
in the viewport meta, also takes zooming away from anyone who needs it.

### Projects

A project groups runs and carries the defaults that work keeps repeating: a
brief, a prompt prefix and suffix, the model that kind of work is usually done
in. The open project scopes the gallery and receives new runs.

Every project can be renamed, recoloured and reconfigured from the gear beside
it in the switcher, without switching into it first. Duplicating one always
copies the defaults, and optionally the finished work inside, which is the
difference between "same setup, fresh start" and "a variant of this".

Deleting one keeps everything inside it. The rows move to Unfiled rather than
being destroyed.

### Upgrading from the browser-only build

Anyone who used Highfield before generations moved to the server has their
whole history in that browser's IndexedDB. On the first load after the
upgrade it is read once, sent to `/api/jobs/import`, and filed into a project
called **Default project**. The composer draft comes across with it.

The old record is never deleted, and each row is keyed on the account plus its
original id, so importing twice, or opening the same history on a second
device, adds nothing. Anything the old build left mid-flight is stored closed:
its task expired long before the row existed, and polling it would report an
old run as a fresh failure.

### Seven APIs, one interface

Kie exposes generation through unrelated shapes. `lib/kie/tasks.ts` is the only
file that knows the difference between the job APIs:

| Transport | Create | Poll | Completion signal |
|---|---|---|---|
| `market` | `POST /api/v1/jobs/createTask` | `GET /api/v1/jobs/recordInfo` | `state` string |
| `veo` | `POST /api/v1/veo/generate` | `GET /api/v1/veo/record-info` | `successFlag` integer |
| `suno` | `POST /api/v1/generate` | `GET /api/v1/generate/record-info` | `status` enum |

Everything above that layer sees one `NormalizedTask`.

Language models do not use the job API at all. They answer in the request, each
vendor in its own format, and `lib/kie/chat.ts` is the only file that knows it:

| Transport | Endpoint | Used by |
|---|---|---|
| `openai-chat` | `POST /{model}/v1/chat/completions` | GPT 5.2, Gemini |
| `openai-responses` | `POST /codex/v1/responses` | GPT 5.4 and later |
| `grok-responses` | `POST /grok/v1/responses` | Grok |
| `anthropic-messages` | `POST /claude/v1/messages` | Claude |

All four answer HTTP 200 with a failing `code` in the body when something is
wrong, so the status alone means nothing: an expired key arrives as 200 plus
`code: 401`. Reading only the status turned that into "the model returned an
empty answer", which sends you looking at your prompt instead of your key.

A text run still becomes a job row. The request returns immediately and the
answer is written when it arrives, so a browser is never left holding a
connection open while a reasoning model thinks.

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
