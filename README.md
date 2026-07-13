# Finance Tracker

Self-hosted personal finance tracker. Passwordless (WebAuthn passkeys),
NestJS + React + MongoDB, single currency (MYR).

## Development

Prereqs: Node 22+, Docker.

    cp .env.example .env        # fill in MailerSend key + from-address
    npm install
    npm run build:shared
    docker compose up -d mongo
    npm run start:dev --workspace server   # http://localhost:3000

Mongo runs as a single-node replica set (required for multi-document transactions);
the compose healthcheck initiates it automatically.
    npm run dev --workspace client         # http://localhost:5173

The Vite dev server proxies `/api` to the NestJS server, so cookies and
WebAuthn both see a single origin (`http://localhost:5173`).

Passkeys on localhost work without HTTPS. For a passkey-less test setup, use
Chrome DevTools → WebAuthn → virtual authenticator.

## Tests

    npm test --workspace server
    npm test --workspace client

## Docs

- Spec: `docs/superpowers/specs/2026-07-12-finance-tracker-design.md`
- Plans: `docs/superpowers/plans/`
