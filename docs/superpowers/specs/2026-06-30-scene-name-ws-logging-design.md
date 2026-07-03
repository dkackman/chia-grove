# Scene Name in WebSocket Connect Logging Design

**Date:** 2026-06-30
**Status:** Approved

## Goal

Log which theme (scene) each client is viewing — `grove`, `farm`, `gallery`, `mine`, or `board` — alongside the existing WS connect event, so scene popularity is queryable in Axiom (see [`2026-06-29-axiom-logging-design.md`](2026-06-29-axiom-logging-design.md)).

## Approach

The WebSocket protocol today is one-directional (server → client only via `Hub.publish`), and the active theme is resolved once client-side before the socket ever opens — switching themes reloads the page. Since the scene value can only change at connection time, no new message type or bidirectional protocol is needed: the client appends the scene id as a query param on the `/ws` connection URL, and the server reads it off the upgrade request at connect time.

This is deliberately not validated against an allowlist server-side — it's a log field, not a security boundary. An unrecognized value just logs as-is.

## Data Flow

```
web/src/main.ts: theme = resolveTheme(...)
    -> new GroveFeed(theme.id)
    -> GroveFeed.connect(): ws://host/ws?scene=<theme.id>
    -> server/src/web/server.ts: /ws route reads request.query.scene
    -> logger.info({ clients: hub.size, scene }, "ws: client connected")
    -> Axiom (via existing pino transport)
```

## Files Changed

| File                       | Change                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `web/src/net/feed.ts`      | `GroveFeed` constructor accepts optional `scene?: string`; `connect()` appends `?scene=` to the WS URL when set             |
| `web/src/main.ts`          | `new GroveFeed(theme.id)`                                                                                                   |
| `server/src/web/server.ts` | `/ws` route handler gains a `request` param; reads `scene` off `request.query` and adds it to the existing connect log line |

No changes to `shared/`, no `WireMessage` additions, no protocol version bump.

## Testing

- `server/test` (wherever the `/ws` route or `buildServer` is covered): assert the connect log includes `scene` when the query param is present, and that it's absent/undefined when it's not.
- `web/test/feed` (if `feed.ts` has existing coverage): assert the constructed WS URL includes `?scene=<id>` when a scene is passed, and omits it when not.
