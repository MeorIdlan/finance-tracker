# Deployment: DigitalOcean droplet + Cloudflare Tunnel

The droplet is shared: Mongo and the Cloudflare Tunnel/edge proxy run as
their own stacks (outside this repo) and are reused by multiple apps on the
host. This app's `docker-compose.prod.yml` only runs the
`finance-tracker-server`/`finance-tracker-client` pair and joins those shared
stacks over two external Docker networks, `shared-mongo` and `shared-edge`.

## One-time setup

1. **Droplet**: Ubuntu LTS, 2 vCPU / 4 GB RAM. Install Docker Engine +
   compose plugin (`https://docs.docker.com/engine/install/ubuntu/`). Create
   a non-root user in the `docker` group.
2. **Shared infrastructure** (once per droplet, not per app — skip if
   already set up for another app on the same host):
   - A standalone Mongo container/stack running as a single-node replica set
     `rs0`, on the external network `shared-mongo`, reachable at hostname
     `mongo`.
   - A shared edge stack (nginx/cloudflared) that terminates the Cloudflare
     Tunnel and reverse-proxies to app containers over the external network
     `shared-edge`.
   - Create the external networks if they don't exist yet:
     `docker network create shared-mongo` / `docker network create shared-edge`.
3. **Clone**: `git clone <repo> && cd finance-tracker`.
4. **Env**: `cp .env.example .env`, then set real values:
   - `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM_EMAIL` (a verified sender domain)
   - `ADMIN_EMAIL` (the only inbox that ever receives registration OTPs — the admin relays the code to the registrant out-of-band if approved)
   - `WEBAUTHN_RP_ID=finance.example.com` (bare domain, no scheme)
   - `WEBAUTHN_ORIGIN=https://finance.example.com`
   MONGODB_URI and COOKIE_SECURE are set by docker-compose.prod.yml. There is
   no per-app `CLOUDFLARE_TUNNEL_TOKEN` — the tunnel is owned by the shared
   edge stack.
5. **Register this app with the shared tunnel**: Cloudflare dashboard →
   Zero Trust → Networks → Tunnels → (the existing shared tunnel) → Public
   Hostname: `finance.example.com` → Service `HTTP` → URL
   `finance-tracker-client:80` (the container name on `shared-edge`).
   Cloudflare creates the DNS record automatically.
6. **Start**: `docker compose -f docker-compose.prod.yml up -d --build`. The
   `shared-mongo`/`shared-edge` networks are declared `external: true`, so
   they must already exist (step 2) or this fails.

## Updating

    git pull
    docker compose -f docker-compose.prod.yml up -d --build

Note this only restarts `finance-tracker-server`/`finance-tracker-client` —
the shared Mongo and edge stacks are untouched.

## Resource limits

`docker-compose.prod.yml` caps server at 0.5 CPU / 300M and client at 0.2
CPU / 64M — sized to leave room for other apps when the droplet was 1 vCPU /
1 GB. The droplet is now 2 vCPU / 4 GB, so there's headroom to raise these
if the app is memory/CPU constrained in practice; not done preemptively
since the current limits haven't caused issues.

## Backups

Mongo lives in the shared Mongo stack, not this compose file, so back it up
with a plain `docker exec` against its container (confirm the name with
`docker ps` if it isn't `mongo`):

    docker exec mongo mongodump --archive --db finance-tracker > backup-$(date +%F).archive

Restore with `mongorestore --archive < backup-YYYY-MM-DD.archive` (exec'd the
same way). Keep backups off-droplet.

## Production smoke checklist

- [ ] `https://finance.example.com` loads the login page over HTTPS
- [ ] Register a new account: OTP email arrives in the `ADMIN_EMAIL` inbox (not the registrant's), relay the code manually, then complete passkey creation on a phone
- [ ] `document.cookie` does not expose `sid`; DevTools shows the cookie as
      HttpOnly + Secure
- [ ] Log out, log back in with the passkey
- [ ] Add a second passkey from another device via Settings
- [ ] Create a bank account + one transaction of each type; balances update
- [ ] Dashboard renders all 7 widgets with data
- [ ] Settings > Agent access: create an agent token, then connect an MCP
      client (e.g. Claude) via the OAuth flow and confirm a tool call
      (e.g. list accounts) succeeds
- [ ] `docker compose -f docker-compose.prod.yml restart` — session survives
      (sessions are in Mongo, not memory; this only restarts the app
      containers, not the shared Mongo stack)
- [ ] Backup command produces a non-empty archive

## Troubleshooting

- **Passkey prompt fails with "invalid domain"**: `WEBAUTHN_RP_ID` must match
  the public hostname exactly, and the origin must be the `https://` form.
- **OTP emails missing**: check Mailgun dashboard for sender-domain
  verification; check the app's audit log for `auth.otp_requested`; quota
  exhaustion returns a clear 503 from `/api/auth/register`. Remember
  registration OTPs go to `ADMIN_EMAIL`, not the registrant's inbox — check
  there first, not the registrant's mailbox.
- **Mongo "not primary" errors**: the replica set didn't initiate. This is
  the shared Mongo stack's problem, not this repo's — check that stack's
  container is healthy (`docker ps`); `docker compose -f
  docker-compose.prod.yml ps` won't show it since Mongo isn't part of this
  compose file anymore.
- **Server can't reach Mongo / client can't reach the tunnel**: confirm the
  `shared-mongo`/`shared-edge` external networks exist and that the shared
  Mongo/edge containers are actually attached to them.
