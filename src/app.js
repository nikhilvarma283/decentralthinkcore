const path = require("path");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const logger = require("./lib/logger");

const healthRouter = require("./api/health");
const v1Router = require("./api/v1");

const app = express();

app.use(helmet({ contentSecurityPolicy: false })); // CSP off for dashboard inline scripts
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.use(
  rateLimit({
    windowMs: 60_000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

// Request logging
app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`, { ip: req.ip });
  next();
});

// Dashboard — serve before 404 handler
app.use(express.static(path.join(__dirname, "public")));

app.use("/health", healthRouter);
app.use("/api/v1", v1Router);

// 404
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Error handler
app.use((err, _req, res, _next) => {
  logger.error(err.message, { stack: err.stack });
  res.status(500).json({ error: "Internal server error" });
});

module.exports = app;
