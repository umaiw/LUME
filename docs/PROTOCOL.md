# LUME Protocol Reference

Complete API and WebSocket protocol documentation for the LUME encrypted messaging server.

---

## 1. Overview

LUME is an end-to-end encrypted messaging system. The server is a relay -- it stores and forwards opaque encrypted payloads without access to plaintext. Cryptographic operations (X3DH key agreement, Double Ratchet) happen exclusively on the client.

**Stack:** Express + WebSocket (ws) + SQLite, TypeScript.

**Base URL:** `http://<host>:<port>/api`

**Default port:** `3001` (configurable via `PORT` env var).

**WebSocket path:** `ws://<host>:<port>/ws`

**JSON body limit:** `256kb` (configurable via `JSON_LIMIT` env var).

**CORS:** Origin allowlist derived from `CLIENT_ORIGIN` env var. In production, state-changing requests (`POST`, `PUT`, `DELETE`, `PATCH`) require an `Origin` header.

---

## 2. Authentication

LUME uses Ed25519 request signing instead of sessions or bearer tokens. Every authenticated request must include the following headers:

| Header | Type | Description |
|---|---|---|
| `X-Lume-Identity-Key` | Base64 string (32 bytes decoded) | The sender's Ed25519 public key. |
| `X-Lume-Signature` | Base64 string (64 bytes decoded) | Ed25519 detached signature over the message. |
| `X-Lume-Timestamp` | String (integer) | Unix timestamp in seconds or milliseconds. Must be within 60 seconds of server time. |
| `X-Lume-Nonce` | String | Unique nonce to prevent replay attacks. |
| `X-Lume-Path` | String | The canonical API path being signed (e.g., `/auth/register`). Must start with `/` and match the actual request path (without the `/api` prefix). Max 256 characters. |

### Signature Construction

The signed message is a dot-delimited string:

```
<timestamp>.<nonce>.<METHOD>.<path>.<body>
```

- `METHOD` is uppercase (e.g., `GET`, `POST`).
- `path` is the canonical path without the `/api` prefix (e.g., `/auth/register`).
- `body` is the raw JSON body string. For empty bodies, both `""` and `"{}"` are accepted.

The message is UTF-8 encoded and signed with `nacl.sign.detached` using the sender's Ed25519 secret key.

### Replay Protection

The server computes a SHA-256 hash of `identityKey|timestamp|signature|nonce|method|path` and stores it. Duplicate hashes within the validity window are rejected with `409 Duplicate request`.

### Error Responses

| Status | Body | Cause |
|---|---|---|
| 401 | `{ "error": "Missing authentication headers" }` | One or more required headers absent. |
| 401 | `{ "error": "Invalid auth header format" }` | Base64 decode failure. |
| 401 | `{ "error": "Invalid auth header length" }` | Key not 32 bytes or signature not 64 bytes. |
| 401 | `{ "error": "Invalid timestamp" }` | Non-numeric timestamp. |
| 401 | `{ "error": "Request expired" }` | Timestamp drift > 60 seconds. |
| 401 | `{ "error": "Invalid signed path" }` | Path too long, missing leading `/`, or mismatch with actual request path. |
| 403 | `{ "error": "Invalid signature" }` | Signature verification failed. |
| 409 | `{ "error": "Duplicate request" }` | Replay detected. |

---

## 3. REST API Endpoints

### Endpoint Summary

| Method | Path | Auth | Rate Limit |
|---|---|---|---|
| `POST` | `/api/auth/register` | No | 30 / 10 min per IP |
| `GET` | `/api/auth/user/:username` | Yes | 60 / 1 min per IP |
| `POST` | `/api/auth/bundle` | Yes | 10 / 1 min per user |
| `GET` | `/api/auth/check/:username` | No | 60 / 1 min per IP |
| `POST` | `/api/auth/prekeys` | Yes | None (inherits global) |
| `POST` | `/api/auth/keys` | Yes | 20 / 1 min per user |
| `DELETE` | `/api/auth/user/:userId` | Yes | None (inherits global) |
| `POST` | `/api/auth/session` | Yes | 20 / 5 min per user |
| `POST` | `/api/auth/block` | Yes | None (inherits global) |
| `POST` | `/api/auth/unblock` | Yes | None (inherits global) |
| `GET` | `/api/auth/blocked` | Yes | 20 / 1 min per user |
| `POST` | `/api/messages/send` | Yes | 120 / 1 min per user |
| `GET` | `/api/messages/pending/:userId` | Yes | None (inherits global) |
| `DELETE` | `/api/messages/:messageId` | Yes | None (inherits global) |
| `POST` | `/api/messages/acknowledge` | Yes | None (inherits global) |
| `GET` | `/api/health` | No | None |
| `GET` | `/api/metrics` | No | None (disabled in production) |

---

### POST /api/auth/register

Register a new user account with cryptographic key material.

**Auth required:** No

**Rate limit:** 30 requests / 10 minutes per IP.

**Request body:**

```typescript
{
  username: string               // 3-32 chars, alphanumeric + underscores
  identityKey: string            // Base64-encoded Ed25519 public key (32 bytes)
  exchangeIdentityKey?: string   // Base64-encoded X25519 public key (32 bytes); defaults to signedPrekey if omitted
  signedPrekey: string           // Base64-encoded X25519 public key (32 bytes)
  signedPrekeySignature: string  // Base64-encoded Ed25519 signature (64 bytes) over signedPrekey
  oneTimePrekeys?: Array<{       // Optional initial batch (max 1000)
    id: string                   // Unique prekey identifier
    publicKey: string            // Base64-encoded X25519 public key (32 bytes)
  }>
}
```

The server verifies `signedPrekeySignature` against `signedPrekey` using `identityKey` via `nacl.sign.detached.verify`.

**Success response:** `201 Created`

```json
{
  "id": "uuid-v4",
  "username": "alice",
  "message": "Registration successful"
}
```

**Error responses:**

| Status | Error | Cause |
|---|---|---|
| 400 | `"Invalid username. Must be 3-32 characters, alphanumeric and underscores only."` | Username validation failed. |
| 400 | `"Invalid identity key"` | Key not valid Base64 or not 32 bytes. |
| 400 | `"Invalid exchange identity key"` | Optional field present but invalid. |
| 400 | `"Invalid signed prekey"` | Key not valid Base64 or not 32 bytes. |
| 400 | `"Invalid signed prekey signature format"` | Signature not valid Base64 or not 64 bytes. |
| 400 | `"Invalid one-time prekeys format"` | Prekey array validation failed (max 500 per batch, unique IDs, valid keys). |
| 400 | `"Too many initial prekeys (max 1000)"` | Exceeded initial prekey cap. |
| 400 | `"Invalid signed prekey signature"` | Ed25519 signature verification failed. |
| 409 | `"Username already taken"` | Username exists. |
| 409 | `"Registration conflict. Try a different username."` | Database unique constraint violation. |

---

### GET /api/auth/user/:username

Retrieve a user's public profile and key material. Does not consume a one-time prekey. Use `/api/auth/bundle` to initiate a key exchange.

**Auth required:** Yes

**Rate limit:** 60 requests / 1 minute per IP.

**URL params:**

| Param | Type | Description |
|---|---|---|
| `username` | string | Target username (3-32 chars, alphanumeric + underscores). |

**Success response:** `200 OK`

```typescript
{
  id: string
  username: string
  identityKey: string              // Ed25519 public key
  exchangeKey: string              // X25519 exchange key (alias for exchangeIdentityKey)
  exchangeIdentityKey: string      // X25519 exchange key
  signedPrekey: string             // Current signed prekey
  signedPrekeySignature: string    // Signature over signed prekey
}
```

**Error responses:**

| Status | Error |
|---|---|
| 400 | `"Invalid username format"` |
| 404 | `"User not found"` |

---

### POST /api/auth/bundle

Fetch a prekey bundle for initiating an X3DH key exchange. Consumes one one-time prekey from the target user (if available).

**Auth required:** Yes

**Rate limit:** 10 requests / 1 minute per user (prevents prekey exhaustion).

**Request body:**

```typescript
{
  username: string  // Target username
}
```

**Success response:** `200 OK`

```typescript
{
  id: string
  username: string
  identityKey: string
  exchangeKey: string
  exchangeIdentityKey: string
  signedPrekey: string
  signedPrekeySignature: string
  oneTimePrekey?: string           // Base64-encoded public key; absent if none available
}
```

**Error responses:**

| Status | Error |
|---|---|
| 400 | `"Invalid username format"` |
| 400 | `"Cannot request your own bundle"` |
| 404 | `"User not found"` |

---

### GET /api/auth/check/:username

Check username availability. Does not require authentication.

**Auth required:** No

**Rate limit:** 60 requests / 1 minute per IP.

**URL params:**

| Param | Type | Description |
|---|---|---|
| `username` | string | Username to check. |

**Success response:** `200 OK`

```json
{ "available": true }
```

or

```json
{ "available": false, "reason": "Invalid format" }
```

---

### POST /api/auth/prekeys

Upload additional one-time prekeys.

**Auth required:** Yes

**Request body:**

```typescript
{
  userId: string
  prekeys: Array<{
    id: string         // Unique ID, max 128 chars
    publicKey: string  // Base64-encoded X25519 public key (32 bytes)
  }>                   // Max 500 per batch
}
```

The server enforces a total cap of **1000 prekeys** per user. If `currentCount + prekeys.length > 1000`, the request is rejected.

The request identity key must match the user's stored identity key.

**Success response:** `200 OK`

```json
{
  "message": "Prekeys uploaded",
  "totalPrekeys": 150
}
```

**Error responses:**

| Status | Error |
|---|---|
| 400 | `"Invalid userId"` |
| 400 | `"Invalid prekeys payload"` |
| 400 | `"Prekey limit exceeded. Max 1000, current <n>, attempted +<m>"` |
| 403 | `"Unauthorized: Identity key mismatch"` |
| 404 | `"User not found"` |

---

### POST /api/auth/keys

Rotate the signed prekey.

**Auth required:** Yes

**Rate limit:** 20 requests / 1 minute per user.

**Request body:**

```typescript
{
  userId: string
  signedPrekey: string            // Base64-encoded X25519 public key (32 bytes)
  signedPrekeySignature: string   // Base64-encoded Ed25519 signature (64 bytes)
}
```

The server verifies the signature over `signedPrekey` using the user's stored identity key.

**Success response:** `200 OK`

```json
{ "message": "Signed prekey updated" }
```

**Error responses:**

| Status | Error |
|---|---|
| 400 | `"Invalid userId"` |
| 400 | `"Invalid signed prekey"` |
| 400 | `"Invalid signed prekey signature format"` |
| 400 | `"Invalid signed prekey signature"` |
| 403 | `"Unauthorized: Identity key mismatch"` |
| 404 | `"User not found"` |

---

### DELETE /api/auth/user/:userId

Delete the authenticated user's account.

**Auth required:** Yes

**URL params:**

| Param | Type | Description |
|---|---|---|
| `userId` | string | UUID of the account to delete. |

The request identity key must match the user's stored identity key.

**Success response:** `200 OK`

```json
{ "message": "Account deleted" }
```

**Error responses:**

| Status | Error |
|---|---|
| 400 | `"Invalid userId"` |
| 403 | `"Unauthorized: Identity key mismatch"` |
| 404 | `"User not found"` |

---

### POST /api/auth/session

Obtain a short-lived JWT for WebSocket authentication.

**Auth required:** Yes

**Rate limit:** 20 requests / 5 minutes per user.

**Request body:**

```typescript
{
  userId: string
}
```

**Success response:** `200 OK`

```typescript
{
  token: string      // JWT (HS256, iss: "lume", aud: "lume-ws", sub: userId)
  expiresIn: 600     // Seconds (10 minutes)
}
```

**Error responses:**

| Status | Error |
|---|---|
| 400 | `"Missing userId"` |
| 403 | `"Identity key mismatch"` |
| 404 | `"User not found"` |

---

### POST /api/auth/block

Block a user. Messages from blocked users are silently accepted but not delivered.

**Auth required:** Yes

**Request body:**

```typescript
{
  blockedId: string  // UUID of user to block
}
```

**Success response:** `200 OK`

```json
{ "ok": true }
```

**Error responses:**

| Status | Error |
|---|---|
| 400 | `"Invalid blockedId"` |
| 400 | `"Cannot block yourself"` |
| 403 | `"Unauthorized"` |
| 404 | `"User not found"` |

---

### POST /api/auth/unblock

Unblock a previously blocked user.

**Auth required:** Yes

**Request body:**

```typescript
{
  blockedId: string  // UUID of user to unblock
}
```

**Success response:** `200 OK`

```json
{ "ok": true }
```

**Error responses:**

| Status | Error |
|---|---|
| 400 | `"Invalid blockedId"` |
| 403 | `"Unauthorized"` |

---

### GET /api/auth/blocked

List all blocked user IDs.

**Auth required:** Yes

**Rate limit:** 20 requests / 1 minute per user.

**Success response:** `200 OK`

```typescript
{
  blockedIds: string[]  // Array of UUIDs
}
```

**Error responses:**

| Status | Error |
|---|---|
| 403 | `"Unauthorized"` |

---

### POST /api/messages/send

Send an encrypted message. The server stores the opaque payload and attempts real-time delivery via WebSocket.

**Auth required:** Yes

**Rate limit:** 120 requests / 1 minute per user.

**Request body:**

```typescript
{
  senderId: string            // UUID of the sender
  recipientUsername: string    // Username of the recipient
  encryptedPayload: string    // JSON string, max 64 KB (see section 5)
}
```

The request identity key must match the sender's stored identity key.

If the recipient has blocked the sender, the server returns a fake success response (status 201, `delivered: false`) without storing the message. This prevents the sender from detecting the block.

**Success response:** `201 Created`

```typescript
{
  messageId: string    // UUID
  delivered: boolean   // true if recipient had an active WebSocket connection
}
```

**Error responses:**

| Status | Error |
|---|---|
| 400 | `"Invalid senderId"` |
| 400 | `"Invalid recipient username"` |
| 400 | `"Invalid encrypted payload"` |
| 401 | `"Unauthorized"` |
| 403 | `"Identity mismatch"` |
| 404 | `"Recipient not found"` |

---

### GET /api/messages/pending/:userId

Retrieve all pending (undelivered) messages for the authenticated user.

**Auth required:** Yes

**URL params:**

| Param | Type | Description |
|---|---|---|
| `userId` | string | UUID of the requesting user. |

**Success response:** `200 OK`

```typescript
{
  messages: Array<{
    id: string               // Message UUID
    senderId: string         // Sender UUID
    senderUsername: string   // Sender username (or "unknown" if deleted)
    encryptedPayload: string // The encrypted envelope (JSON string)
    timestamp: number        // Unix timestamp in milliseconds
  }>
}
```

**Error responses:**

| Status | Error |
|---|---|
| 400 | `"Invalid userId"` |
| 403 | `"Unauthorized access to messages"` |

---

### DELETE /api/messages/:messageId

Acknowledge and delete a single pending message.

**Auth required:** Yes

**URL params:**

| Param | Type | Description |
|---|---|---|
| `messageId` | string | UUID of the message. |

Only the recipient can delete their own pending messages.

**Success response:** `200 OK`

```json
{ "message": "Message acknowledged" }
```

**Error responses:**

| Status | Error |
|---|---|
| 400 | `"Invalid messageId"` |
| 403 | `"Unauthorized"` or `"Unauthorized access to message"` |
| 404 | `"Message not found"` |

---

### POST /api/messages/acknowledge

Batch-acknowledge (delete) multiple pending messages.

**Auth required:** Yes

**Request body:**

```typescript
{
  messageIds: string[]  // Array of UUIDs, max 500
}
```

Only messages where the authenticated user is the recipient are deleted.

**Success response:** `200 OK`

```typescript
{
  acknowledged: number  // Count of messages actually deleted
}
```

**Error responses:**

| Status | Error |
|---|---|
| 400 | `"Invalid messageIds"` |
| 403 | `"Unauthorized"` |

---

### GET /api/health

Basic health check. No authentication.

**Success response:** `200 OK`

```json
{
  "status": "ok",
  "timestamp": "2026-03-21T12:00:00.000Z"
}
```

---

### GET /api/metrics

Server metrics. **Disabled in production** (returns `404`).

**Success response:** `200 OK`

```typescript
{
  status: "ok"
  timestamp: string
  uptimeSec: number
  ws: {
    users: number        // Unique connected users
    connections: number  // Total WebSocket connections
  }
  memory: {
    rss: number
    heapTotal: number
    heapUsed: number
    external: number
  }
}
```

---

## 4. WebSocket Protocol

### Connection

**URL:** `ws(s)://<host>:<port>/ws`

**Max payload:** 64 KB (configurable via `WS_MAX_PAYLOAD_BYTES`).

**Max connections per user:** 5. When exceeded, the oldest connection is closed with code `4005`.

### Authentication

WebSocket authentication uses the `Sec-WebSocket-Protocol` header with two sub-protocols:

1. `lume` -- protocol marker (required).
2. `auth.<jwt_token>` -- JWT obtained from `POST /api/auth/session`.

**Example (browser):**

```javascript
const ws = new WebSocket("wss://example.com/ws", [
  "lume",
  `auth.${jwtToken}`
]);
```

The server verifies the JWT (HS256, issuer `lume`, audience `lume-ws`) and extracts the `sub` claim as the user ID. The token is valid for 10 minutes from issuance.

### Connection Rate Limit

10 connections per minute per IP address. Exceeding this triggers close code `4006`.

### Close Codes

| Code | Meaning |
|---|---|
| `4001` | Missing auth token in sub-protocols. |
| `4002` | Invalid token, missing protocol marker, or user not found. |
| `4003` | Token expired. |
| `4005` | Too many connections (user has >= 5 active sockets). |
| `4006` | Connection rate limit exceeded (>= 10 / minute per IP). |
| `4007` | Origin not allowed (production only). |

### Heartbeat

The server sends WebSocket-level `ping` frames every **30 seconds**. If a client does not respond with a `pong` frame before the next ping cycle, the connection is terminated.

### Client-to-Server Messages

All messages are JSON objects with a `type` field. The `type` must be a non-empty string, max 32 characters. Only three types are accepted:

#### ping

Application-level ping (separate from WebSocket-level ping/pong).

```json
{ "type": "ping" }
```

Server responds with:

```json
{ "type": "pong", "timestamp": 1711036800000 }
```

#### typing

Notify a recipient about typing status.

```typescript
{
  type: "typing"
  recipientId: string   // UUID of the recipient
  isTyping: boolean
}
```

**Rate limiting:** Duplicate state (same `isTyping` value) is throttled to once per 800ms per sender-recipient pair. Any state change is throttled to once per 150ms.

Sending to yourself is silently ignored.

The server relays to the recipient:

```typescript
{
  type: "typing"
  senderId: string
  senderUsername: string
  isTyping: boolean
}
```

#### read

Send read receipts for messages.

```typescript
{
  type: "read"
  recipientId: string     // UUID -- the original sender of the messages
  messageIds: string[]    // 1-100 unique UUID-like strings, no duplicates
}
```

Sending to yourself is silently ignored.

The server relays to the recipient:

```typescript
{
  type: "read"
  senderId: string        // The user who read the messages
  messageIds: string[]
}
```

### Server-to-Client Messages

#### pong

Response to a client `ping` message.

```typescript
{ type: "pong", timestamp: number }
```

#### typing

Relayed typing indicator (see above).

#### read

Relayed read receipt (see above).

#### new_message

Pushed when a new message arrives via `POST /api/messages/send` and the recipient has an active WebSocket connection.

```typescript
{
  type: "new_message"
  messageId: string
  senderId: string
  senderUsername: string
  encryptedPayload: string   // The encrypted envelope (JSON string)
  timestamp: number          // Unix timestamp in milliseconds
}
```

The message is also stored in the pending queue regardless of delivery status. The client must acknowledge it via `DELETE /api/messages/:messageId` or `POST /api/messages/acknowledge` to remove it from the queue.

---

## 5. Encrypted Payload Format

The `encryptedPayload` field in message endpoints is a JSON string with a maximum size of **64 KB**. Two envelope versions are supported.

### v1: NaCl Box (Legacy)

```typescript
{
  v: 1
  alg: "nacl-box"
  senderExchangeKey: string   // Base64, X25519 public key (32 bytes)
  ciphertext: string          // Base64, NaCl box output
  nonce: string               // Base64, 24 bytes (nacl.box.nonceLength)
  timestamp: number           // Unix timestamp
  selfDestruct?: number       // Optional, seconds (0 to 604800 = 7 days)
}
```

### v2: Double Ratchet (Current)

```typescript
{
  v: 2
  alg: "lume-ratchet"
  ciphertext: string          // Base64, NaCl secretbox output
  nonce: string               // Base64, 24 bytes (nacl.secretbox.nonceLength)
  timestamp: number           // Unix timestamp
  header: {
    publicKey: string         // Base64, ratchet public key (32 bytes)
    previousChainLength: number
    messageNumber: number
  }
  x3dh?: {                    // Present only in the first message of a session
    senderIdentityKey: string       // Base64, 32 bytes
    senderEphemeralKey: string      // Base64, 32 bytes
    recipientOneTimePreKey?: string // Base64, 32 bytes (if one was available)
  }
  selfDestruct?: number       // Optional, seconds (0 to 604800 = 7 days)
}
```

### selfDestruct Field

Optional on both versions. If present, must be a finite number between `0` and `604800` (7 days in seconds). Interpretation is client-side -- the server does not enforce message deletion based on this value.

### Validation Rules

- The entire JSON string must not exceed 64 KB (UTF-8 byte length).
- `v` must be `1` or `2` with the corresponding `alg` value.
- All Base64 keys must decode to exactly 32 bytes.
- Nonces must decode to the correct length (24 bytes for both `nacl.box.nonceLength` and `nacl.secretbox.nonceLength`).
- Ciphertext must be non-empty and not exceed 64 KB decoded.
- Payloads that do not match either v1 or v2 format are rejected.

---

## 6. Error Handling

### Standard Error Response

All error responses use the following format:

```typescript
{
  error: string  // Human-readable error description
}
```

HTTP status codes follow standard semantics:

| Status | Meaning |
|---|---|
| 400 | Bad request -- validation failure, malformed input. |
| 401 | Unauthorized -- missing or invalid authentication headers. |
| 403 | Forbidden -- valid auth but insufficient permissions (key mismatch, invalid signature). |
| 404 | Not found -- resource does not exist, or endpoint disabled. |
| 409 | Conflict -- duplicate resource (username taken) or replay detected. |
| 429 | Too many requests -- rate limit exceeded (standard headers `RateLimit-*` included). |
| 500 | Internal server error. |

### Rate Limit Headers

All rate-limited endpoints return standard rate limit headers:

```
RateLimit-Limit: <max>
RateLimit-Remaining: <remaining>
RateLimit-Reset: <seconds until reset>
```

Legacy `X-RateLimit-*` headers are disabled.

### Validation Constants

| Constant | Value |
|---|---|
| Username pattern | `/^[a-zA-Z0-9_]{3,32}$/` |
| UUID-like pattern | `/^[a-fA-F0-9-]{8,128}$/` |
| Base64 key decoded length | 32 bytes |
| Signature decoded length | 64 bytes |
| Max one-time prekeys per upload | 500 |
| Max total prekeys per user | 1000 |
| Max encrypted payload size | 64 KB |
| Max batch acknowledge IDs | 500 |
| Max read receipt message IDs | 100 (unique, no duplicates) |
| Pending message TTL | 30 days (server-side cleanup) |
| Signature validity window | 60 seconds |
| JWT lifetime | 10 minutes |
