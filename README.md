# LUME

End-to-end encrypted messenger. Zero knowledge architecture — the server is a blind relay that never sees plaintext.

## Cryptography

| Layer | Implementation |
|-------|---------------|
| Key Exchange | X3DH (Extended Triple Diffie-Hellman) |
| Message Encryption | Double Ratchet Protocol |
| Symmetric Cipher | XSalsa20-Poly1305 (NaCl secretbox) |
| Signing | Ed25519 |
| Key Agreement | X25519 |
| Key Derivation | HMAC-SHA256 (ratchet), PBKDF2-SHA256 600K iterations (storage) |
| File Encryption | Per-file random key, XSalsa20-Poly1305 |

Authentication is signature-based — no passwords, no sessions, no cookies. Every API request is signed with your Ed25519 identity key.

## Stack

**Client:** Next.js 16, React 19, Tailwind CSS, Zustand, tweetnacl

**Server:** Express, WebSocket (ws), SQLite (better-sqlite3), TypeScript

**Infrastructure:** Vercel (client), Render (server), GitHub Actions CI

## Features

- 1-to-1 encrypted messaging with forward secrecy
- Double Ratchet with out-of-order message handling
- Encrypted file attachments (up to 5MB)
- Group chats with role-based member management
- Real-time delivery via WebSocket
- Typing indicators and read receipts
- Self-destructing messages (up to 7 days)
- Profile avatars and display names
- Contact blocking (invisible to the blocked party)
- Hidden chats with separate PIN protection
- Panic wipe — erase all local data instantly
- Mnemonic seed phrase backup and recovery
- Signed prekey rotation (7-day cycle with grace period)
- One-time prekey replenishment
- Safety number verification
- Offline message queue (30-day TTL)
- Push notifications (Web Push API)
- Dark/light/system theme
- Progressive Web App with offline support

## Architecture

```
┌─────────────┐         ┌─────────────┐
│   Client    │◄──E2E──►│   Client    │
│  (Next.js)  │         │  (Next.js)  │
└──────┬──────┘         └──────┬──────┘
       │  Encrypted blobs only │
       └──────────┬────────────┘
                  │
          ┌───────▼───────┐
          │    Server     │
          │  (Express)    │
          │               │
          │  Blind relay  │
          │  No plaintext │
          │  No decryption│
          └───────┬───────┘
                  │
          ┌───────▼───────┐
          │    SQLite     │
          │  (WAL mode)   │
          └───────────────┘
```

The server stores and forwards encrypted payloads. It cannot read message content, decrypt files, or access private keys. All cryptographic operations happen exclusively on the client.

## Quick Start

```bash
# Clone
git clone https://github.com/umaiw/LUME.git
cd LUME

# Server
cd server
cp .env.example .env
# Edit .env — set WS_JWT_SECRET to a random 32+ byte string
npm install
npm run dev

# Client (new terminal)
cd client
cp .env.local.example .env.local
npm install
npm run dev
```

Server runs on `http://localhost:3001`, client on `http://localhost:3000`.

## Docker

```bash
# Set required env vars
export WS_JWT_SECRET=$(openssl rand -hex 32)
export CLIENT_ORIGIN=http://localhost:3000

docker compose up --build
```

## Environment Variables

### Server

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `WS_JWT_SECRET` | Yes | — | JWT signing secret (min 32 bytes) |
| `PORT` | No | `3001` | HTTP/WS port |
| `CLIENT_ORIGIN` | No | `http://localhost:3000` | CORS allowlist (comma-separated) |
| `TRUST_PROXY` | No | `0` | Set to `1` behind reverse proxy |
| `DB_PATH` | No | `./data/messenger.db` | SQLite database path |

### Client

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | No | `http://localhost:3001/api` | Server API URL |
| `NEXT_PUBLIC_WS_URL` | No | `ws://localhost:3001/ws` | WebSocket URL |

## Testing

```bash
# Server tests (55 tests)
cd server && npx vitest run

# Client tests (365+ tests)
cd client && npx vitest run

# E2E tests
cd client && npx playwright test

# Type checking
npm run validate
```

## API Documentation

Full protocol reference including all REST endpoints, WebSocket messages, and encrypted payload formats: [`docs/PROTOCOL.md`](docs/PROTOCOL.md)

## Security

- All messages are end-to-end encrypted — the server never sees plaintext
- Private keys are stored in IndexedDB, encrypted with PBKDF2-derived master key (600K iterations)
- Ed25519 request signing with replay protection (nonce + 60s timestamp window)
- Rate limiting on all endpoints
- Zod schema validation on every API boundary
- No `eval()`, no string-concatenated SQL, no `dangerouslySetInnerHTML`
- CSP headers in production

To report a security vulnerability, open a GitHub issue or contact the maintainers directly.

## License

[AGPL-3.0](LICENSE)
