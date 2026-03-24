# LUME Development Rules

## Project Overview
LUME is an E2E-encrypted messenger. Client: Next.js 16 + Zustand. Server: Express + SQLite (better-sqlite3). Crypto: X3DH + Double Ratchet (tweetnacl). Auth: Ed25519 signature-based (no passwords).

## Architecture
- `client/` — Next.js app (App Router), `src/` structure
- `server/` — Express API + WebSocket, `src/` structure
- All validation at boundaries via Zod schemas (`server/src/schemas/`)
- Validation middleware: `server/src/middleware/validate.ts` (validateBody/validateParams)
- Crypto never on server — server is a blind relay for encrypted blobs

## Security Rules (MANDATORY)
1. NEVER log, inspect, or store plaintext message content on the server
2. ALL external input MUST be validated with Zod schemas before use
3. ALL route handlers MUST use `validateBody()` / `validateParams()` middleware
4. NO raw `req.body as X` without prior Zod validation middleware
5. NO `eval()`, `Function()`, or dynamic code execution
6. NO string concatenation in SQL — use parameterized prepared statements only
7. Rate limit ALL public and authenticated endpoints
8. Verify identity_key ownership before any write operation
9. File uploads: validate size, validate MIME, store encrypted blobs only
10. WebSocket: validate every incoming message with Zod before processing

## Code Quality Rules
1. TypeScript strict mode: `strict`, `noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch`
2. No `any` types — use `unknown` and narrow
3. Zod schemas are the single source of truth for request/response shapes
4. Keep route handlers thin: validate -> authorize -> delegate to DB/service -> respond
5. One responsibility per file; schemas, routes, services, DB are separate layers

## Validation Pattern
```typescript
// Correct: Zod middleware validates before handler runs
router.post('/endpoint', requireSignature, validateBody(MySchema), (req, res) => {
  const data = req.body as z.infer<typeof MySchema> // safe: already validated
})
```

## Testing
- Server: `cd server && npx vitest run`
- Client: `cd client && npx vitest run`
- Load tests: `cd server && npx vitest run test/load.test.ts`
- E2E: `cd client && npx playwright test`
- All tests must pass before pushing

## Build & Lint
- Server: `cd server && npx tsc --noEmit` (type check), `npx prettier --check "src/**/*"`
- Client: `cd client && npx next build`, `npx eslint .`
- CI runs 7 jobs: lint + test + build for both client and server, plus Docker build

## Git Workflow
- Branch from `main`, PR required
- Conventional commit messages
- All CI checks must pass before merge
