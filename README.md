## Changelog

### `b39c68d` — 2026-02-16 (feat)
**feat: reply/quote messages, sound notifications, contact blocking**

Reply/Quote Messages:
- `client/src/stores/index.ts` — `MessageReplyRef` interface, optional `replyTo` field on `Message`
- `client/src/app/chat/[id]/page.tsx` — reply button on bubbles, quote block (border-l-2 accent, sender name + truncated text), reply bar above textarea, `replyTo` included in encrypted JSON payload; `MessageBubbleMemo` updated for `replyTo` comparison
- `client/src/hooks/useMessengerSync.ts` — `appendIncomingMessage` parses `replyTo` from decrypted plaintext

Sound Notifications:
- `client/src/lib/sounds.ts` — **new** Web Audio API two-tone chime (C5→E5), no external audio file; `playMessageSound()`, `setSoundEnabled()`, `isSoundEnabled()`, `initSoundPreference()`; preference saved in `localStorage('lume:sound')`
- `client/src/hooks/useMessengerSync.ts` — `playMessageSound()` on incoming message in inactive chat; `initSoundPreference()` on load
- `client/src/app/settings/page.tsx` — Sound toggle in Notifications section

Contact Blocking (server):
- `server/src/db/database.ts` — `blocked_users` table (blocker_id, blocked_id), prepared statements, `blockUser()`, `unblockUser()`, `isBlocked()`, `getBlockedUsers()`
- `server/src/routes/auth.ts` — `POST /auth/block` and `POST /auth/unblock` with `requireSignature`
- `server/src/routes/messages.ts` — silent drop: if recipient blocked sender, return 201 but don't deliver (doesn't reveal block status)

Contact Blocking (client):
- `client/src/stores/index.ts` — `useBlockedStore` with `blockedIds: Set<string>`, `addBlocked`, `removeBlocked`, `isBlocked`, `setBlockedIds`
- `client/src/lib/api.ts` — `authApi.blockUser()`, `authApi.unblockUser()`
- `client/src/hooks/useMessengerSync.ts` — load/save blocked IDs from localStorage, filter incoming messages from blocked users (ack but ignore)
- `client/src/app/chat/[id]/page.tsx` — Block/Unblock button in contact profile modal (orange, before Delete Contact)
- `client/src/components/messenger/ChatListPanel.tsx` — "Blocked" preview instead of last message for blocked contacts

10 files changed, +459 / −27

---

### `11f02a7` — 2026-02-16 (fix)
**fix: infinite loop (Maximum update depth exceeded) on chat open**

- `client/src/stores/index.ts` — `markAsRead()` bail-out: skip state update when `unreadCount` already 0 (prevents Zustand re-render loop)
- `client/src/app/chat/[id]/page.tsx` — removed reactive `chat` object from `useEffect` dep array; read current chat via `useChatsStore.getState()` instead (breaks render→effect→setState→render cycle)

---

### `dcd2cfe` — 2026-02-15 (feat + security)
**feat: settings page, security hardening, read receipts UI, delete messages/contacts**

New files:
- `client/src/app/settings/page.tsx` — **new** full Settings page: theme, notifications, self-destruct, hidden chats, Change PIN (re-encrypts all data), Delete Account (server + local wipe)
- `client/src/components/ui/Skeleton.tsx` — **new** skeleton loading components
- `client/src/lib/theme.ts` — **new** unified theme module (replaces duplicated logic)

Security (12 fixes):
- `client/src/app/settings/page.tsx` — Delete Account now calls `authApi.deleteAccount()` before `panicWipe()` (was local-only) [CRITICAL]
- `client/src/lib/websocket.ts` — split `disconnect()` into `_closeSocket()` (internal, preserves handlers) and `disconnect()` (full logout) [HIGH]
- `client/src/lib/api.ts` — nonce fallback replaced `Math.random()` with `crypto.getRandomValues()` [HIGH]
- `client/src/crypto/storage.ts` — `clearCachedMasterKey()` exported, called in `clearAuth()`; constant-time PIN verify via XOR; `hiddenChatPinHash` moved to separate IDB key; brute-force lockout persists in IDB; Change PIN with PBKDF2 100K iterations re-encryption [4×MEDIUM]
- `client/src/hooks/useMessengerSync.ts` — debounced saves flush on unmount (was losing 600ms writes); read receipt handler O(1) via Set + direct lookup [MEDIUM+LOW]
- `client/src/lib/theme.ts` — `applyTheme()` accepts `skipPersist` flag (no double-write) [LOW]
- `server/src/index.ts` — `/api/health` stripped `connectedUsers`/`activeConnections` [LOW]
- `server/src/routes/auth.ts` — prekey upload cap 1000/user on registration + rotation [LOW]

Client:
- `client/src/app/chat/[id]/page.tsx` — self-destruct default from Settings applied to new chats
- `client/src/app/chats/page.tsx` — minor hook updates
- `client/src/components/messenger/LeftRail.tsx` — Settings navigation (gear icon)
- `client/src/components/theme/ThemeToggle.tsx` — uses unified `theme.ts`
- `client/src/components/ui/index.ts` — exports `Skeleton`
- `client/src/stores/index.ts` — `clearCachedMasterKey()` call on auth clear

Server:
- `server/src/index.ts` — graceful shutdown (SIGTERM/SIGINT), metrics blocked in production, trust proxy via env

16 files changed, +1056 / −61

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
