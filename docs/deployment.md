# Deployment: DigitalOcean droplet + Cloudflare Tunnel

## One-time setup

1. **Droplet**: Ubuntu LTS, 1 GB+ RAM. Install Docker Engine + compose plugin
   (`https://docs.docker.com/engine/install/ubuntu/`). Create a non-root user
   in the `docker` group.
2. **Clone**: `git clone <repo> && cd finance-tracker`.
3. **Env**: `cp .env.example .env`, then set real values:
   - `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_FROM_EMAIL` (a verified sender domain)
   - `ADMIN_EMAIL` (the only inbox that ever receives registration OTPs — the admin relays the code to the registrant out-of-band if approved)
   - `WEBAUTHN_RP_ID=finance.example.com` (bare domain, no scheme)
   - `WEBAUTHN_ORIGIN=https://finance.example.com`
   - `CLOUDFLARE_TUNNEL_TOKEN` (next step)
   MONGODB_URI and COOKIE_SECURE are set by docker-compose.prod.yml.
4. **Tunnel**: Cloudflare dashboard → Zero Trust → Networks → Tunnels →
   Create a tunnel (Cloudflared connector). Copy the token into `.env`.
   Add a Public Hostname: `finance.example.com` → Service `HTTP` →
   URL `client:80`. Cloudflare creates the DNS record automatically.
5. **Start**: `docker compose -f docker-compose.prod.yml up -d --build`.

## Updating

    git pull
    docker compose -f docker-compose.prod.yml up -d --build

## Backups

Mongo data lives in the `mongo-data` volume. Snapshot with:

    docker compose -f docker-compose.prod.yml exec mongo \
      mongodump --archive --db finance-tracker > backup-$(date +%F).archive

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
- [ ] `docker compose -f docker-compose.prod.yml restart` — session survives
      (sessions are in Mongo, not memory)
- [ ] Backup command produces a non-empty archive

## Troubleshooting

- **Passkey prompt fails with "invalid domain"**: `WEBAUTHN_RP_ID` must match
  the public hostname exactly, and the origin must be the `https://` form.
- **OTP emails missing**: check Mailgun dashboard for sender-domain
  verification; check the app's audit log for `auth.otp_requested`; quota
  exhaustion returns a clear 503 from `/api/auth/register`. Remember
  registration OTPs go to `ADMIN_EMAIL`, not the registrant's inbox — check
  there first, not the registrant's mailbox.
- **Mongo "not primary" errors**: the replica set didn't initiate — check
  `docker compose -f docker-compose.prod.yml ps` shows mongo healthy; the
  healthcheck runs `rs.initiate()` automatically.
