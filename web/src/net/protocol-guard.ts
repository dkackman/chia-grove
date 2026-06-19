export type ProtocolAction = "reload" | "clear" | "none";

/**
 * Decide what a client should do when the server announces its protocol
 * version. Pure so it is unit-testable in the node test environment; feed.ts
 * supplies the sessionStorage/location side effects.
 *
 * - versions match  -> "clear" the once-per-session reload guard
 * - mismatch, fresh -> "reload" once to pick up a matching bundle
 * - mismatch, already reloaded -> "none" (prevents a reload loop on a stale cache)
 */
export function protocolAction(
  serverProtocol: number,
  clientProtocol: number,
  alreadyReloaded: boolean
): ProtocolAction {
  if (serverProtocol === clientProtocol) return "clear";
  return alreadyReloaded ? "none" : "reload";
}
