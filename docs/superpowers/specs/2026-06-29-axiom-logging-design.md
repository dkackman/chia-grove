# Axiom Structured Logging Design

**Date:** 2026-06-29
**Branch:** feat/safesearch-content-filter
**Status:** Approved

## Goal

Add structured, production-grade logging to the chia-grove server so that blockchain ingestion issues, content filter behavior, client connection events, and errors are all visible and queryable in Axiom.

## Approach

A single pino logger instance (`server/src/logger.ts`) serves the entire server. When `AXIOM_TOKEN` and `AXIOM_DATASET` env vars are present, pino routes records to Axiom via `@axiomhq/pino`. When they are absent (dev, CI), pino writes JSON to stdout — journald captures it and `pino-pretty` works locally. No code path changes between environments.

Fastify receives the same pino instance at construction so HTTP request/response records flow to Axiom automatically. All scattered `console.*` calls are replaced with `log.info/warn/error` importing the singleton. The hub backpressure termination path gets a `log.warn` added.

## Structured Log Fields

| Source | Level | Fields |
|---|---|---|
| Startup | `info` | `{ port, appVersion, safesearch }` |
| Each block | `info` | `{ height, spends, nfts, cats, dids }` |
| Reorg | `warn` | `{ forkHeight }` |
| Poll failure | `warn` | `{ retryMs, err }` |
| Puzzle parse fail | `warn` | `{ coinId, err }` |
| SafeSearch verdict | `info` | `{ launcherId, imageUri, verdict }` |
| SafeSearch failure | `warn` | `{ launcherId, imageUri, err }` |
| Store.get failure | `warn` | `{ launcherId, err }` |
| WS connect | `info` | `{ clients }` |
| WS disconnect | `info` | `{ clients }` |
| Hub termination (backpressure) | `warn` | `{ clients, buffered }` |
| Shutdown signal | `info` | `{ signal }` |
| Store open failure | `error` | `{ path, err }` |

HTTP request/response (method, url, statusCode, responseTime) come automatically from Fastify's pino integration.

## New Environment Variables

| Var | Default | Notes |
|---|---|---|
| `AXIOM_TOKEN` | (unset) | Axiom API ingest token; unset = stdout only |
| `AXIOM_DATASET` | (unset) | Axiom dataset name (e.g. `chia-grove`) |
| `LOG_LEVEL` | `info` | pino log level |

Both Axiom vars must be set together; either alone is treated as unset (stdout fallback).

## Files Changed

| File | Change |
|---|---|
| `server/package.json` | add `@axiomhq/pino` dependency |
| `server/src/logger.ts` | **new** — pino singleton with Axiom transport or stdout fallback |
| `server/src/index.ts` | import logger, replace all `console.*`, pass logger to `buildServer` |
| `server/src/web/server.ts` | accept logger param, wire to Fastify, log WS connect/disconnect |
| `server/src/web/hub.ts` | import logger, add `log.warn` on backpressure termination |
| `server/src/ingest/coinset-poller.ts` | import logger, replace `console.warn` |
| `server/src/content-filter/safesearch-worker.ts` | import logger, replace `console.warn` ×2, add verdict `log.info` |
| `server/src/classify/classify.ts` | import logger, replace `console.warn` |
| `server/.env.example` | add `AXIOM_TOKEN`, `AXIOM_DATASET`, `LOG_LEVEL` |
| `deploy/chia-grove.service` | add `AXIOM_TOKEN` and `AXIOM_DATASET` placeholders |

## Testing

No new tests — logging paths are side-effectful infrastructure, not logic. Existing 339 tests stay green (logger module stubs or uses stdout in test env where Axiom vars are absent).

## Axiom Setup (one-time)

1. In Axiom dashboard: create a dataset named `chia-grove` (or any name)
2. Settings → API Tokens → New Token → ingest permission on the dataset
3. Set `AXIOM_TOKEN` and `AXIOM_DATASET` in `/etc/systemd/system/chia-grove.service.d/override.conf` on the droplet
4. `systemctl daemon-reload && systemctl restart chia-grove`
5. Verify in Axiom: Events tab on the dataset should show records within one poll cycle (~3s)
