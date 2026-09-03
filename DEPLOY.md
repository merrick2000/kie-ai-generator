# Deploying Highfield

The pipeline builds one Docker image per commit, publishes it to GHCR, and
tells the host to pull it. The same artefact is promoted from `dev` to
`master` unchanged, because no configuration is baked into the image.

```
push to master (or dev)
   -> CI: typecheck, tests against a real Postgres, build
   -> Docker image, tagged :latest on master, :dev on dev, plus :<sha>
   -> pushed to ghcr.io/<owner>/highfield
   -> webhook tells Dokploy to pull and restart
```

### Tags

`master` publishes **`:latest`**, so a host can pin a stable tag and never
chase a commit hash. Every build also carries `:<sha>`, which is what makes a
rollback a redeploy rather than a revert.

The release branch is declared once, as `RELEASE_BRANCH` at the top of
`.github/workflows/deploy.yml`. Any other branch publishes under its own name,
with slashes and other characters Docker rejects replaced by `-`.

| Branch | Tags published |
|---|---|
| `master` | `:latest` and `:<sha>` |
| `dev` | `:dev` and `:<sha>` |
| `feature/x` | `:feature-x` and `:<sha>` |

---

## 1. Required secrets

Set these in **Settings, Secrets and variables, Actions**.

| Secret | Needed for | Notes |
|---|---|---|
| `GITHUB_TOKEN` | pushing to GHCR | provided automatically |
| `DOKPLOY_WEBHOOK_URL` | deploy from `master` | omit and the image is still published |
| `DOKPLOY_WEBHOOK_URL_DEV` | dev deploy | same |

The deploy step is skipped when its webhook is absent, so the workflow is
useful before any host exists.

## 2. Runtime environment

These are set on the **host**, not in the repository. Nothing sensitive is
present in the image.

| Variable | Required | Purpose |
|---|---|---|
| `APP_SECRET` | **yes** | Encrypts stored Kie.ai keys. `openssl rand -base64 32` |
| `DATABASE_URL` | **yes** | Postgres connection string |
| `KIE_API_KEY` | no | Fallback key when a user has not set their own |
| `KIE_WEBHOOK_HMAC_KEY` | no | Verifies Kie webhook callbacks |
| `NEXT_PUBLIC_APP_URL` | no | Public origin, enables webhooks instead of polling |
| `SIGNUPS_ENABLED` | recommended | `false` closes registration after the first account |
| `ARTICLE_WEBHOOK_SECRET` | for the blog | Signing secret shared with the publisher |
| `ARTICLE_WEBHOOK_TOKEN` | no | Optional bearer token, checked as well as the signature |

### APP_SECRET is not optional in production

Without it the app generates a secret and stores it in the database. That works
until the database is reset, and it puts the secret beside the data it
protects. Set it explicitly, keep it out of the repository, and treat losing it
as: every user must reconnect their Kie.ai key. Accounts and passwords are
unaffected.

## 3. Database

Postgres, required. There is no local fallback, so a misconfigured deployment
fails loudly at the first query instead of quietly writing to a file that
disappears on the next redeploy.

The app container holds no state: no volume to mount, nothing to preserve
across a deploy, and replicas can be added without any of them diverging.

Migrations run automatically at startup, each inside its own transaction, so a
failed migration leaves nothing half-applied.

Any managed Postgres works: Neon, Supabase, Railway, RDS, or the `postgres`
service in `docker-compose.yml`.

### TLS

TLS is decided by the `sslmode` in `DATABASE_URL`, following the libpq
convention every provider documents. It is **off when `sslmode` is absent**.

| Where Postgres runs | Connection string |
|---|---|
| Private network (Docker, Dokploy) | no `sslmode` needed |
| Managed provider | `?sslmode=require` |
| Managed, with a trusted CA | `?sslmode=verify-full` |

A Postgres container speaks no TLS. Forcing it there fails with
`The server does not support SSL connections`, which is what the health
endpoint reports as a `503`.

`DATABASE_SSL` overrides the URL (`require`, `verify-full`, `disable`) when the
connection string is supplied by a platform and cannot be edited.

## 4. Deploying

### Dokploy or any Docker host

```bash
docker run -d \
  --name highfield \
  -p 3000:3000 \
  -e APP_SECRET="$(openssl rand -base64 32)" \
  -e DATABASE_URL="postgres://user:pass@host:5432/highfield" \
  ghcr.io/<owner>/highfield:latest
```

In Dokploy, point the application at the GHCR image, set the variables above,
and paste the deploy webhook into the repository secrets.

### Compose, app plus database

```bash
cp .env.example .env      # fill APP_SECRET and POSTGRES_PASSWORD
docker compose up -d
```

The app waits for Postgres to pass its healthcheck before starting, so the
first migration cannot race the database coming up.

### Serverless (Vercel and similar)

Set `DATABASE_URL` to a managed Postgres such as Neon or Supabase, plus
`APP_SECRET`. The Dockerfile is not involved on this path.

## 5. Health and rollback

`GET /api/health` returns `200` with the active engine and the deployed commit,
and `503` when the database is unreachable. It queries the database rather than
merely confirming the process is alive, so a replica that cannot sign anyone in
is reported as unhealthy and taken out of rotation.

```json
{ "status": "ok", "database": "postgres", "latencyMs": 3, "version": "a1b2c3d" }
```

Every build is also tagged with its commit SHA, so a rollback is a redeploy of
`ghcr.io/<owner>/highfield:<previous-sha>`.

## 6. Blog webhook

The publisher posts articles to `POST /api/webhooks/articles`. Give it:

- the endpoint URL, `https://your-host/api/webhooks/articles`
- the value you set in `ARTICLE_WEBHOOK_SECRET`

Deliveries are signed `HMAC-SHA256(secret, timestamp + "." + rawBody)` and
verified against the raw bytes. A delivery older than five minutes is refused,
which bounds replay of a captured request.

Until `ARTICLE_WEBHOOK_SECRET` is set the endpoint answers `503` and stores
nothing, rather than accepting unsigned HTML that would be served to every
visitor.

Responses tell the sender what to do: `4xx` means the delivery was wrong and
should not be retried, `5xx` means a transient failure on our side and a retry
is welcome. A successful response carries `{ "url": "…" }` pointing at the
published article.

## 7. Access control

A deployed instance is reachable by anyone who knows its URL, and registration
is open by default. Set `SIGNUPS_ENABLED=false` before exposing it.

The first account is always allowed through, so you can still bootstrap a
closed instance: deploy, visit it, register, and every subsequent attempt is
refused. Existing users keep signing in normally, and the sign-up form is
hidden rather than left to fail on submit.

## 8. Before the first deploy

- [ ] `APP_SECRET` generated and stored on the host
- [ ] `DATABASE_URL` points at a Postgres you control and back up
- [ ] `.env*` is git-ignored (it already is)
- [ ] Deploy webhook added to repository secrets, if using one
- [ ] `SIGNUPS_ENABLED=false` set, then create your account on first visit.
      The first registration is always permitted; every later one is refused,
      so nobody who finds the URL can help themselves to an account
