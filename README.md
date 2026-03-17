<div align="center">

# LUME

![Next.js](https://img.shields.io/badge/Next.js-16.1.6-black?style=flat-square&logo=nextdotjs)
![React](https://img.shields.io/badge/React-19.2.3-61DAFB?style=flat-square&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)
![TweetNaCl](https://img.shields.io/badge/TweetNaCl-E2E%20Encryption-6B21A8?style=flat-square)
![WebSocket](https://img.shields.io/badge/WebSocket-real--time-22C55E?style=flat-square)
![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-003B57?style=flat-square&logo=sqlite)
![License](https://img.shields.io/badge/license-All%20rights%20reserved-red?style=flat-square)

**End-to-end encrypted messaging.** Double Ratchet protocol, hidden chats, self-destruct, read receipts — all in the browser.

</div>

---

## Features

- **End-to-end encryption** — Double Ratchet algorithm over X25519 keys via TweetNaCl. Messages are encrypted client-side before leaving the device.
- **Hidden chats** — PIN-protected chats invisible in the main list. Separate PIN, separate state.
- **Self-destruct** — configurable auto-delete timer per conversation, applied to new chats by default from Settings.
- **Read receipts** — delivered/read status on every message, updated in real time via WebSocket.
- **Desktop notifications** — browser Notifications API, permission-gated, respects in-app sound toggle.
- **Sound notifications** — Web Audio API two-tone chime (C5→E5), no external audio files, preference persisted in localStorage.
- **Contact blocking** — blocked contacts get a silent drop on the server (block status not revealed to sender).
- **Reply/quote** — reply to specific messages with inline quote block.
- **Message deletion** — delete individual messages from a conversation.
- **Contact deletion** — removes contact, chat history, and the Double Ratchet session.
- **Panic wipe** — one action deletes all local data and the server account.
- **Backup** — export and restore encrypted local state.
- **Dark/light theme** — persisted preference.

---

## Architecture

Monorepo with two packages:

```
LUME/MAIN/
├── client/    # Next.js 16 + React 19 + Tailwind 4
└── server/    # Express + WebSocket + SQLite (better-sqlite3)
```

**Client** — Next.js App Router SPA. All crypto runs in the browser. State managed with Zustand. Keys and messages stored in IndexedDB (idb-keyval). No plaintext ever sent to the server.

**Server** — Express REST API + WebSocket server. Stores only encrypted message blobs, public keys (X25519 prekey bundles), and minimal auth data. SQLite via better-sqlite3.

---

## Encryption

LUME implements the **Double Ratchet Algorithm** using **TweetNaCl** (`tweetnacl` npm package):

- Key agreement: X25519 Diffie-Hellman
- Encryption: XSalsa20-Poly1305 (NaCl `box`)
- Key derivation: BIP39 mnemonic seed for identity key, PBKDF2 for PIN-based master key (100,000 iterations)
- PIN verification: constant-time XOR comparison, brute-force lockout persisted in IndexedDB
- Prekey bundles: server caps at 1,000 prekeys per user

---

## Local development

**Prerequisites:** Node.js 18+, npm

```bash
# Server
cd server
npm install
npm run dev
# Starts on http://localhost:3001

# Client (separate terminal)
cd client
npm install
npm run dev
# Starts on http://localhost:3000
```

The client proxies API requests to the server. Both must be running for the app to work.

---

## Server API (summary)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Register with username + public keys |
| POST | `/auth/login` | Authenticate, receive JWT |
| GET | `/auth/bundle/:username` | Fetch prekey bundle for key agreement |
| POST | `/auth/block` | Block a user |
| POST | `/auth/unblock` | Unblock a user |
| POST | `/messages/send` | Send encrypted message |
| GET | `/messages/:contactId` | Fetch message history |
| DELETE | `/auth/account` | Delete account and all data |

WebSocket: authenticated on connect via JWT, used for real-time message delivery, read receipts, and online status.

---

## Development

```bash
# Server
npm run type-check
npm run lint
npm run format-check
npm test          # Vitest integration tests

# Client
npm run lint
npm run build
```

---

## Tech stack

| Component | Technology |
|-----------|-----------|
| Client framework | Next.js 16.1.6, React 19.2.3 |
| Styling | Tailwind CSS 4 |
| State management | Zustand 5 |
| Encryption | TweetNaCl (X25519 + XSalsa20-Poly1305) |
| Key storage | IndexedDB via idb-keyval |
| Server framework | Express 4 |
| Real-time | WebSocket (ws) |
| Database | SQLite via better-sqlite3 |
| Auth | JWT (jsonwebtoken) |
| Testing | Vitest |
| Language | TypeScript 5 |

---
