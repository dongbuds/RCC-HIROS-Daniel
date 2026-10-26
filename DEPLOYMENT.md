# Deployment — RCC-HIROS

Production deployment of the RCC-HIROS HRIS: a Next.js 16 application backed by
MariaDB, local file storage, and a USB fingerprint bridge, hosted on a
school-controlled machine behind a Cloudflare Tunnel.

- **Repository:** https://github.com/dongbuds/RCC-HIROS-Daniel
- **CI/CD:** [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
- **Public URL:** https://smell-employee-castle-glow.trycloudflare.com
- **Container images:** `ghcr.io/dongbuds/rcc-hiros-daniel` (`:latest`, `:<sha>`, `:migrate`)

`hiros.dpdns.org` is a free subdomain from DigitalPlat's `dpdns.org` namespace,
delegated to Cloudflare. A named tunnel (`rcc-hiros-daniel`) owns a proxied
record for the hostname and routes it to `http://app:3000` on the compose
network. The origin never listens on the public internet.

---

## 1. Chosen infrastructure

| Layer | Choice | Why |
|---|---|---|
| Runtime | Docker image (`node:22-bookworm-slim`) running the Next.js **standalone** server | The app is a Node server, not a static export. One immutable artifact runs identically in CI and production. |
| Orchestration | Docker Compose: `app`, `db`, `migrate`, `cloudflared` | Four processes on one host. Compose provides restart policies, health checks, and named volumes without a cluster. |
| Database | MariaDB 11.4 container with a named volume | Matches the existing MySQL/MariaDB schema exactly. No rewrite, no managed-database bill. |
| File storage | Docker volume `rcc-hiros-daniel_uploads-data` mounted at `/app/uploads` | Employee photos, profile files, and leave documents are written to disk by five route handlers. A volume makes them survive restarts and gives backups a single source. |
| Ingress | Cloudflare Tunnel (`cloudflared`) | Outbound-only connection: no port forwarding, no public IP, no certificate management, free TLS, and the origin is unreachable from the internet. |
| Compute | The existing kiosk/server PC | It already owns the ZK9500 scanner and the data. Marginal cost is zero. |
| Registry | GHCR (`ghcr.io/dongbuds/rcc-hiros-daniel`) | Free for public packages and authenticated with the workflow's built-in `GITHUB_TOKEN`. |
| CI/CD | GitHub Actions + a self-hosted runner labelled `rcc-hiros-daniel` | CI runs on GitHub-hosted runners; CD must run on the host that holds the database volume. The runner polls GitHub, so no inbound access is required. |

**Cost:** $0/month. GitHub Actions is free for public repositories, GHCR is free
for public packages, Cloudflare's free plan covers DNS and tunnels, and the
hardware already exists. The only optional expense is a custom domain.

---

## 2. Why this fits the architecture

1. **Server-side state.** Five route handlers write uploads to
   `process.cwd()/uploads` with `fs/promises`. Serverless platforms give each
   invocation an ephemeral filesystem, so photos and leave documents would
   disappear or 404 on the next request. A container with a volume keeps them.
2. **Request and response sizes.** Leave documents are capped at 25 MB and
   employee files at 10 MB. The FPAS export merges up to 100 PDFs into one
   response. Both exceed the 4.5 MB body and response limits of managed
   serverless functions.
3. **Hardware dependency.** The fingerprint flow is an HTTP call to a Python
   bridge bound to `127.0.0.1:8765`, which talks to the scanner through
   `libzkfp.dll`. Any host that cannot reach the scanner machine cannot serve
   ZK clock-ins. The app and the bridge share a host.
4. **Data sensitivity.** Employee records and fingerprint templates stay on a
   machine the institution controls. Only the web front door is public, and it
   is TLS-terminated at Cloudflare.
5. **Database protocol.** Prisma 7 uses `@prisma/adapter-mariadb`, a TCP
   driver. Managed serverless platforms cannot host that database in-process;
   a container can.

---

## 3. Two deployments, one host

This machine also runs another RCC-HIROS deployment. Docker Compose derives
container and volume names from the project name, so a second stack that reused
`rcc-hiros` would adopt the first stack's database volume and overwrite it.
Every identifier is therefore distinct:

| Resource | Other stack | This deployment |
|---|---|---|
| Compose project | `rcc-hiros` | `rcc-hiros-daniel` |
| App host port | `127.0.0.1:3000` | `127.0.0.1:3001` |
| Database host port | `127.0.0.1:3307` | `127.0.0.1:3308` |
| Volumes | `rcc-hiros_*` | `rcc-hiros-daniel_*` |
| GHCR image | `ghcr.io/sfrussel/...` | `ghcr.io/dongbuds/...` |
| Host env file | `~/rcc-hiros-deploy/` | `~/rcc-hiros-daniel-deploy/` |
| Runner label | `rcc-hiros` | `rcc-hiros-daniel` |
| Public hostname | `rcchiros.dpdns.org` | `hiros.dpdns.org` |
| Database + JWT secrets | independent | independent |

The two stacks share only the Docker daemon and the fingerprint bridge. The
bridge is a single-device service that serialises calls behind a lock, so
concurrent kiosk use waits rather than corrupting a capture.

---

## 4. Limitations and trade-offs

- **Single point of failure.** If the host is off or offline, the site is down.
  `restart: unless-stopped` covers process crashes, not power loss.
- **No horizontal scaling.** Sessions are stateless JWTs, but uploads and the
  database are local. A second replica would still share one volume and one
  database.
- **Builds are offloaded.** Images are built on GitHub's runners; the host only
  pulls them, so a school PC never spends CPU on `next build`.
- **The free `dpdns.org` namespace is community-run.** The delegation depends on
  DigitalPlat's parent zone. The named tunnel is permanent; the namespace is not
  guaranteed to be. A paid domain is the migration path.
- **No CDN for uploads.** Photos are streamed by a route handler with
  `Cache-Control: no-store`, so every request reaches the host. Acceptable at
  campus scale, not at thousands of concurrent users.
- **Kiosk endpoints are unauthenticated by design.** They are called by a
  browser that holds only a fingerprint. `KIOSK_ALLOWED_IPS` restricts them to
  the school's egress IP, and a Cloudflare WAF rule on `/api/biometric/zk/*` is
  the outer layer. The guard is inert while the variable is empty.

---

## 5. Rejected alternatives

| Option | Why it was rejected |
|---|---|
| **Vercel** | Serverless functions cap request and response bodies at 4.5 MB, while leave documents reach 25 MB and FPAS exports merge up to 100 PDFs. Uploads written to `uploads/` become ephemeral. The function cannot reach a loopback fingerprint bridge. Supporting it would mean rewriting storage, capping uploads, and exposing the scanner through a second tunnel — for a worse result. |
| **Netlify** | Same serverless constraints, plus weaker support for a long-lived Node process with native-adjacent dependencies (`sharp`, `@react-pdf/renderer`). |
| **Cloudflare Pages / Workers** | The app is not an edge-runtime application: it uses `fs`, `bcryptjs`, a TCP MariaDB driver, and server-side PDF generation. Porting it would mean replacing four subsystems. Cloudflare is used where it fits — as the TLS edge and tunnel. |
| **AWS ECS / Fargate** | Technically viable, but the operational surface (VPC, ALB, ECR, IAM, security groups) and the cost of a running task plus a database are not justified for one container. |
| **Bare metal without containers** | Requires XAMPP, Node, and a Python service installed by hand, with no reproducible artifact and no safe rollback. That is the development setup, not a deployment. |
| **Quick tunnel as the permanent URL** | The `trycloudflare.com` hostname is regenerated whenever the connector restarts, so it cannot be submitted as a stable URL. It remains available as a demo fallback. |

---

## 6. CI/CD pipeline

```
push / PR ──► ci ──────────────────────────────┐
                                                ├─► docker (main only) ─► deploy (main only)
                                                │      push GHCR            self-hosted runner
```

| Job | Trigger | Runner | What it does |
|---|---|---|---|
| `prepare` | every run | ubuntu-latest | Lowercases the image name (GHCR rejects uppercase owners) and derives a 12-character SHA tag. |
| `ci` | every push and PR | ubuntu-latest | `npm ci` → `prisma generate` → `tsc --noEmit` → `eslint` → `next build`. Placeholder `DATABASE_URL` and `JWT_SECRET`; no database is contacted. |
| `docker` | push to `main` | ubuntu-latest | Builds and pushes two targets: `:latest` + `:<sha>` (runtime) and `:migrate` (Prisma CLI + seeds). Layer cache is shared through GitHub Actions cache. |
| `deploy` | push to `main` | self-hosted `rcc-hiros-daniel` | Restores the host env file, logs in to GHCR, pulls the exact SHA image, runs `prisma migrate deploy`, starts the app, polls `/api/health` over the public URL, pins the deployed tag, and prunes dangling images. |

**Safety properties**

- `concurrency: deploy-${{ github.ref }}` prevents two merges from racing.
- The deploy job requires `github.event_name == 'push'` and `refs/heads/main`,
  so pull requests can never reach the self-hosted runner.
- Every image is tagged with its commit SHA, which is also the rollback unit.
- The deployed image is written back into the host env file, so a manual
  restart cannot silently fall back to an older `:latest`.

---

## 7. Configuration

| Variable | Scope | Example | Notes |
|---|---|---|---|
| `DATABASE_URL` | runtime | `mysql://hiros:***@db:3306/rcc_hiros` | Read by Prisma at request time. Host is the compose service name. |
| `JWT_SECRET` | runtime | 48 random bytes, base64 | Rotating it invalidates all sessions. |
| `TZ` | runtime | `Asia/Manila` | Attendance timestamps use server-local time. |
| `KIOSK_SERVICE_URL` | runtime | `http://host.docker.internal:8765` | Server-side 1:N matching. |
| `NEXT_PUBLIC_KIOSK_SERVICE_URL` | **build time** | `http://127.0.0.1:8765` | Inlined into the browser bundle; changing it requires a rebuild. |
| `KIOSK_ALLOWED_IPS` | runtime | `203.0.113.10` | Comma-separated allowlist for `/api/biometric/zk/*`. Empty = open (demo). |
| `MARIADB_*` | db container | — | First-boot initialisation only. `MARIADB_PASSWORD` must match `DATABASE_URL`. |
| `CLOUDFLARE_TUNNEL_TOKEN` | tunnel container | `eyJ...` | Minted when the tunnel is created. |
| `APP_IMAGE` / `MIGRATE_IMAGE` | compose | `ghcr.io/dongbuds/rcc-hiros-daniel:<sha>` | Pinned by the deploy job; edit to roll back. |
| `PUBLIC_URL` | GitHub variable | `https://smell-employee-castle-glow.trycloudflare.com` | Used by the post-deploy smoke test. |

The host copy lives at `~/rcc-hiros-daniel-deploy/.env.production` and is never
committed. `.env.production` is gitignored, and `.dockerignore` keeps `.env*`
out of the build context, so no secret is baked into the image.

---

## 8. Host runbook

### One-time setup

```bash
# 1. Prerequisites: Docker Desktop (WSL2 backend), WSL2 Ubuntu, and the ZK
#    bridge running natively on Windows.

# 2. Environment file, outside the checkout
mkdir -p ~/rcc-hiros-daniel-deploy
cp .env.production.example ~/rcc-hiros-daniel-deploy/.env.production
chmod 600 ~/rcc-hiros-daniel-deploy/.env.production
$EDITOR ~/rcc-hiros-daniel-deploy/.env.production

# 3. Start the database
docker compose --env-file .env.production up -d db

# 4. Connect the tunnel (before the first app image exists)
docker compose --env-file .env.production --profile tunnel up -d --no-deps cloudflared

# 5. Install the self-hosted runner on the host (repository Settings →
#    Actions → Runners → New self-hosted runner), label `rcc-hiros-daniel`.
```

The first `push` to `main` then builds the images, applies migrations, starts
the app, and passes the smoke test. Seed the demo content once:

```bash
docker compose --env-file .env.production --profile tools run --rm migrate npx tsx prisma/seed.ts
docker compose --env-file .env.production --profile tools run --rm migrate npx tsx prisma/seed-showcase.ts
```

### Restart

After every deploy the job pins `APP_IMAGE` and `MIGRATE_IMAGE` in the host env
file, so a restart reuses the exact image that was deployed:

```bash
docker compose --env-file .env.production up -d app
docker compose --env-file .env.production restart app
```

### Rollback

```bash
APP_IMAGE=ghcr.io/dongbuds/rcc-hiros-daniel:<previous-sha> \
  docker compose --env-file .env.production up -d app
```

Images are immutable and SHA-tagged, so rollback is a single variable change.
Migrations are forward-only; restore the pre-deploy dump if one must be undone.

### Backups

```bash
./scripts/backup.sh
```

Dumps the database and archives the uploads volume into
`$HOME/rcc-hiros-daniel-backups`, then prunes files older than `KEEP_DAYS`
(default 14). Schedule it in Task Scheduler or cron:

```
0 2 * * * cd /mnt/e/rcc-hiros-daniel && ./scripts/backup.sh >> ~/rcc-hiros-daniel-backups/backup.log 2>&1
```

---

## 9. Verification

Performed after the first production deploy:

- [ ] `docker compose up -d` brings up a healthy `app` and `db`
- [ ] `GET /api/health` returns `{"status":"ok","database":"up"}`
- [ ] Login works over the public HTTPS URL
- [ ] Uploads volume is writable by the non-root container user
- [ ] `npx tsc --noEmit` and `npm run lint` pass (0 errors)
- [ ] Image builds from a clean context
- [ ] Green run of `.github/workflows/deploy.yml` on `main`
- [ ] An uploaded file survives an app container restart
- [ ] A 9–10 MB PDF uploads and downloads through the tunnel
- [ ] FPAS export produces the merged PDF
- [ ] The kiosk guard returns 403 for a non-allowlisted IP when configured
- [ ] `scripts/backup.sh` produces a dump and an uploads archive
- [ ] The public hostname serves over HTTPS with a valid certificate

---

## 10. Operational notes

- **The committed migration was stale.** The original migration predated
  `canManageBiometrics`, `ContractType`, the Engineering employment fields, and
  the FPAS table, because the development database had been evolved with
  `prisma db push`. The gap is captured in
  `prisma/migrations/20261020000000_sync_schema_with_model`, generated with
  `prisma migrate diff`. A fresh database now applies both migrations and
  matches `schema.prisma`.
- **HTTPS redirect vs container health checks.** The production middleware
  redirects every request to `https://`, including loopback health probes. The
  redirect now skips loopback hosts; public traffic still gets forced to HTTPS
  because Cloudflare always sends `x-forwarded-proto: https`.
- **Secrets never enter the image.** `next build` copies `.env` into
  `.next/standalone` when present, so `.env*` is excluded from the Docker build
  context and all values are injected at runtime.
- **Compose can silently start a stale image.** `up -d` resolves
  `${APP_IMAGE:-…:latest}` and does not pull. The deploy job pins the deployed
  tag in the host env file, and the runbook uses that file for restarts.
- **Profile photos are served through a route handler** with
  `Cache-Control: no-store`; they are not part of the Next.js static output.
