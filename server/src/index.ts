import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createServer } from "http";
import { WebSocketServer } from "ws";

import authRoutes from "./routes/auth";
import messageRoutes from "./routes/messages";
import { initWebSocket, getConnectionStats } from "./websocket/handler";
import database from "./db/database";
import { buildOriginAllowlist, isOriginAllowed } from "./utils/originAllowlist";

if (
  !process.env.WS_JWT_SECRET ||
  Buffer.byteLength(process.env.WS_JWT_SECRET) < 32
) {
  console.error(
    "FATAL ERROR: WS_JWT_SECRET is missing or too short (must be >= 32 bytes).",
  );
  process.exit(1);
}

const app = express();
app.disable("x-powered-by");

const TRUST_PROXY =
  process.env.TRUST_PROXY === "1" || process.env.TRUST_PROXY === "true";
if (TRUST_PROXY) {
  app.set("trust proxy", 1);
}

const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || "0.0.0.0";
const JSON_LIMIT = process.env.JSON_LIMIT || "256kb";
const WS_MAX_PAYLOAD_BYTES = Number(
  process.env.WS_MAX_PAYLOAD_BYTES || 64 * 1024,
);
const IS_PROD = process.env.NODE_ENV === "production";
const ORIGIN_ALLOWLIST = buildOriginAllowlist(
  process.env.CLIENT_ORIGIN || "http://localhost:3000",
);
const CLIENT_ORIGINS = ORIGIN_ALLOWLIST.raw;

const corsOptions = {
  origin: (
    origin: string | undefined,
    callback: (err: Error | null, allow?: boolean) => void,
  ) => {
    if (!origin) return callback(null, true);
    if (isOriginAllowed(origin, ORIGIN_ALLOWLIST)) {
      return callback(null, true);
    }
    return callback(new Error("Origin not allowed"));
  },
  credentials: true,
};

// === Middleware =============================================================

app.use(
  helmet({
    contentSecurityPolicy: false, // API only; front-end handled separately
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
);

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));

// Require Origin in production for state-changing requests.
app.use((req, res, next) => {
  if (!IS_PROD) return next();
  const origin = req.headers.origin;
  const method = req.method.toUpperCase();
  if (
    !origin &&
    method !== "GET" &&
    method !== "HEAD" &&
    method !== "OPTIONS"
  ) {
    res.status(403).json({ error: "Origin required" });
    return;
  }
  next();
});

// Explicit CORS error handler -> 403
app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (
      err &&
      typeof err === "object" &&
      "message" in err &&
      (err as { message: string }).message === "Origin not allowed"
    ) {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }
    next(err);
  },
);

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

app.use(
  express.json({
    limit: JSON_LIMIT,
    verify: (req, _res, buf) => {
      (req as express.Request & { rawBody?: string }).rawBody =
        buf.toString("utf8");
    },
  }),
);

app.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (err instanceof SyntaxError && "message" in err) {
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }
    next(err);
  },
);

if (process.env.LOG_HTTP === "1") {
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    });
    next();
  });
}

// === Routes =================================================================

app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);

app.get("/api/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/metrics", (_req, res) => {
  // Block in production to prevent information disclosure
  if (process.env.NODE_ENV === "production") {
    res.status(404).json({ error: "Not found" });
    return;
  }

  const stats = getConnectionStats();
  const mem = process.memoryUsage();
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptimeSec: Math.floor(process.uptime()),
    ws: stats,
    memory: {
      rss: mem.rss,
      heapTotal: mem.heapTotal,
      heapUsed: mem.heapUsed,
      external: mem.external,
    },
  });
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (err.message !== "Origin not allowed") {
      console.error("Unhandled error:", err);
    }
    res.status(500).json({ error: "Internal server error" });
  },
);

// === Server Startup =========================================================

const server = createServer(app);

const wss = new WebSocketServer({
  server,
  path: "/ws",
  perMessageDeflate: false,
  maxPayload: Number.isFinite(WS_MAX_PAYLOAD_BYTES)
    ? WS_MAX_PAYLOAD_BYTES
    : 64 * 1024,
});
initWebSocket(wss);

server.listen(PORT, HOST, () => {
  console.log(
    `LUME API listening on http://${HOST}:${PORT} (ws path /ws) | Allowed origins: ${CLIENT_ORIGINS.join(", ") || "none"}`,
  );
});

// Periodic cleanup: purge pending messages older than 30 days
const STALE_MSG_MAX_AGE_SEC = 30 * 24 * 60 * 60; // 30 days
const STALE_MSG_CLEANUP_INTERVAL = 60 * 60 * 1000; // every hour

const staleCleanupTimer = setInterval(() => {
  const purged = database.purgeStaleMessages(STALE_MSG_MAX_AGE_SEC);
  if (purged > 0) {
    console.log(`Purged ${purged} stale pending message(s)`);
  }
}, STALE_MSG_CLEANUP_INTERVAL);
staleCleanupTimer.unref();

// Graceful shutdown
const SHUTDOWN_TIMEOUT_MS = 5000;

const shutdown = (signal: string) => {
  console.log(`${signal} received, shutting down...`);

  // Force exit if graceful shutdown takes too long
  const forceTimer = setTimeout(() => {
    console.error("Graceful shutdown timed out, forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forceTimer.unref();

  server.close(() => {
    database.close();
    console.log("Server closed");
    process.exit(0);
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  shutdown("uncaughtException");
});
