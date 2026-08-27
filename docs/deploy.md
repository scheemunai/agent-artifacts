# Deployment guide

Agent Artifacts deploys as one container that listens on `PORT` and persists `/data`. The default database is SQLite at `/data/agent-artifacts.db`; set `DATABASE_URL` for Postgres when the platform does not provide durable local disk.

For the hosted product launch runbook — DNS, mail, secrets, backups, monitoring, and go-live gates — see [production.md](./production.md).

Official platform references used for the checked-in configs:

- Railway Dockerfile path and health checks: <https://docs.railway.com/config-as-code/reference>
- Railway volumes: <https://docs.railway.com/volumes/reference>
- Render Docker blueprints and disks: <https://render.com/docs/blueprint-spec> and <https://render.com/docs/disks>
- Fly Dockerfile and volume mounts: <https://fly.io/docs/reference/configuration/>
- Coolify Docker Compose and persistent storage: <https://coolify.io/docs/knowledge-base/docker/compose> and <https://coolify.io/docs/knowledge-base/persistent-storage>

## Platform support

Supported:

- Docker Compose on a VM or local machine.
- Railway with a service volume mounted at `/data`.
- Render Docker web service with a persistent disk mounted at `/data`.
- Fly.io Machines with a volume mounted at `/data`.
- Coolify using this repo's `docker-compose.yml`.

Unsupported by design:

- Vercel, Netlify, Cloudflare Pages/Workers, AWS Lambda, and similar serverless-only hosts.

Why: the app is a long-running Hono/Node process and the default database is SQLite on disk. Serverless filesystems are ephemeral and request lifetimes are not a fit. If you need to run behind an ephemeral filesystem, move the database out of the container with `DATABASE_URL` to Postgres. Turso/libSQL is intentionally called out as a future-compatible escape hatch, but this repository currently implements SQLite and Postgres adapters only.

## Docker Compose

The published GHCR image is not live yet. The compose file builds from the local checkout and tags the result as `agent-artifacts:local` unless you set `AA_IMAGE` yourself.

```bash
docker compose up
```

Then open `/setup`, copy the setup token from the boot log, and create the first admin/bot.

Default storage is the `aa_data` Docker volume mounted at `/data`.

## Railway

Config file: [`railway.json`](../railway.json)

One-click Railway deploy is **pending** until the public GitHub repository is published. See [repository publication status](./decisions.md#repository-publication-status). The manual CLI path below assumes you already have a source checkout.

Railway's current config-as-code support covers build and deploy settings. Persistent volumes are managed as Railway resources, so attach one to the web service before real use:

```bash
railway login
railway init
railway up
railway volume add --service agent-artifacts --mount-path /data
railway redeploy
```

Set service variables:

```env
DEPLOYMENT=self-hosted
PORT=3000
BASE_URL=https://YOUR-RAILWAY-DOMAIN.up.railway.app
AA_SQLITE_PATH=/data/agent-artifacts.db
LOG_LEVEL=info
```

If you provision Railway Postgres instead of SQLite, set `DATABASE_URL` to the Postgres service reference and keep the `/data` volume only if you still want the generated self-host session secret on durable disk.

## Render

Config file: [`render.yaml`](../render.yaml)

One-click Render deploy is **pending** until the public GitHub repository is published. See [repository publication status](./decisions.md#repository-publication-status). Use the blueprint only after Render can access the real repository.

The blueprint defines one Docker web service, one instance, `/healthz` health checks, and a persistent disk mounted at `/data`. Render persistent disks require a paid web service and cannot be used with multiple running instances, so keep `numInstances: 1` for SQLite.

After creation, update `BASE_URL` if Render assigns a different subdomain than the one in the blueprint.

## Fly.io

Config file: [`fly.toml`](../fly.toml)

Fly app names are globally unique. Edit `app` and `BASE_URL` in `fly.toml`, then create the volume and deploy:

```bash
fly auth login
fly apps create YOUR-APP-NAME
fly volumes create agent_artifacts_data --size 1 --region iad --app YOUR-APP-NAME
fly deploy --app YOUR-APP-NAME
```

The checked-in `fly.toml` mounts `agent_artifacts_data` at `/data` and sets `AA_SQLITE_PATH=/data/agent-artifacts.db`.

Use one Machine for SQLite. For multiple regions or horizontal scale, move to Postgres via `DATABASE_URL` first.

## Coolify

Config file: [`docker-compose.yml`](../docker-compose.yml)

Coolify can deploy directly from a public GitHub repository and uses the compose file as the source of truth for environment variables, service ports, and volumes. That direct public-repo path is **pending** until the repository is published; see [repository publication status](./decisions.md#repository-publication-status). Use the root `docker-compose.yml` once Coolify can access the source.

1. New resource → Public Repository.
2. Repository URL: pending until launch; after publication, use the final URL from [decisions.md](./decisions.md#repository-publication-status).
3. Build pack: Docker Compose.
4. Service port: `3000`.
5. Set `BASE_URL` to the Coolify public URL.
6. Keep the named `aa_data:/data` volume.
7. Deploy, then copy the setup token from logs and open `/setup`.

## External Postgres option

For any host:

```env
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require
AA_SQLITE_PATH=/data/agent-artifacts.db
```

When `DATABASE_URL` is set, SQLite is ignored. Migrations run at boot against Postgres.
