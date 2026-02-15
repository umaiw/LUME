## Changelog

### `cd5ead0` — 2026-02-15 (feat + ci)
**feat: read receipts, desktop notifications, message/contact deletion + ci: disable deploy triggers**

Server:
- `server/src/websocket/handler.ts` — new WS type `read`: receives `{ recipientId, messageIds }`, forwards to sender as `read_receipt` event. Added `handleReadReceipt()` with UUID validation

Client:
- `client/src/lib/notifications.ts` — **new** Desktop Notifications API: permission request, show notifications for incoming messages
- `client/src/lib/websocket.ts` — new method `sendReadReceipt(recipientId, messageIds)` for sending read receipts via WS
- `client/src/hooks/useMessengerSync.ts` — handle incoming `read_receipt` events → update message status to `read`. Send read receipt on chat open and on message received in active chat. Desktop notification for messages in inactive chat
- `client/src/components/OnlineStatus.tsx` — added `requestNotificationPermission()` on mount
- `client/src/app/chat/[id]/page.tsx` — message deletion: delete button (hover) on each message with `deleteMessage()`. Contact deletion: "Delete Contact" button in contact profile with confirmation — deletes contact, chat, ratchet session and redirects to `/chats`

CI:
- `.github/workflows/deploy-server.yml` — disabled push trigger (only `workflow_dispatch`) until `FLY_API_TOKEN` is configured
- `.github/workflows/deploy-client.yml` — disabled push trigger (only `workflow_dispatch`) until hosting is configured

8 files changed, +320 / −48

### `e797463` — 2026-02-15 (docs)
**docs: update README.md**

### `e40a8c0` — 2026-02-15 (docs)
**docs: rewrite README as dev changelog**

### `9cf6b40` — 2026-02-15 (patch)
**fix: TS2556 spread in getUsersByIds, fix integration test self-bundle block**
- `server/src/db/database.ts` — fixed TypeScript spread argument error in cached `getUsersByIds` prepared statements
- `server/test/flow.integration.test.ts` — integration test was requesting own bundle (Bob→Bob), fixed to Alice→Bob to match self-request block logic

### `9538bcc` — 2026-02-15 (bugs + refactor)
**fix: bugs, refactor duplicated code, remove dead code**

Server:
- `server/src/routes/auth.ts` — prekey exhaustion protection: dedicated `bundleRateLimit` (10 req/min), self-request block on `/auth/bundle`, audit logging for bundle consumption
- `server/src/db/database.ts` — cached `getUsersByIds` prepared statements by arity (was re-preparing every call), migration error logging when `LOG_SECURITY=1`

Client:
- `client/src/app/chat/[id]/page.tsx` — pass `onOpenBackup` to LeftRail (backup button was broken), added full Backup modal, smart auto-scroll (only when user is within 120px of bottom)
- `client/src/app/chats/page.tsx` — moved auth redirect from render phase to `useEffect`, extracted shared hooks
- `client/src/app/layout.tsx` — `lang="ru"` → `lang="en"`
- `client/src/app/setup/page.tsx` — 400ms debounce on username availability check
- `client/src/app/unlock/page.tsx` — auto-re-register now shows warning dialog instead of silent action
- `client/src/hooks/useContactActions.ts` — **new** shared hook (add-contact + open-chat logic)
- `client/src/hooks/usePanic.ts` — **new** shared hook (panic wipe logic)
- `client/src/crypto/keys.ts` — removed dead `ed25519ToX25519PublicKey` stub
- `client/src/crypto/storage.ts` — removed unused `verifyPin`

11 files changed, +1648 / −999

### `51fb4e6` — 2026-02-15 (style)
**style: format server code with Prettier & add .gitattributes**
- Auto-formatted all server code with Prettier
- Added `.gitattributes` for consistent line endings (`lf`)

### `a537b85` — 2026-02-15 (fix)
**fix: add NodeJS global to ESLint config**

### `f766df3` — 2026-02-15 (fix)
**fix: add Node.js globals to ESLint config, disable no-console**

### `3bccaa3` — 2026-02-15 (fix)
**fix: simplify ESLint config for v9 compatibility**

### `f220869` — 2026-02-15 (fix)
**fix: migrate server ESLint to flat config (v9)**
- Migrated from legacy `.eslintrc` to `eslint.config.mjs` flat config format

### `399891d` — 2026-02-15 (fix)
**fix: resolve build errors for CI**

### `d1890e6` — 2026-02-15 (fix)
**fix: add missing deps (supertest, typescript) & regenerate lock files**

### `2831d86` — 2026-02-14 (init)
**feat: initial project setup**
- Full client + server codebase
- GitHub repo created (`rekonov/LUME`, private)
- CI/CD: `ci.yml` (6 jobs), `deploy-server.yml`, `deploy-client.yml`, `dependabot.yml`
- Docker: `server/Dockerfile`, `server/fly.toml`
