import { Transform } from "node:stream";

/** A pass-through that aborts (errors) once more than `max` bytes have flowed. */
export function byteCap(max: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      seen += chunk.length;
      if (seen > max) cb(new Error("upstream body exceeded size cap"));
      else cb(null, chunk);
    },
  });
}

/**
 * A pass-through that forwards every chunk unchanged (so client delivery is
 * exactly the streamed path) while accumulating the body up to `cap` bytes for
 * caching. If the body exceeds `cap`, accumulation is abandoned (the buffer is
 * dropped) but forwarding continues. `result()` returns the full body only if the
 * stream ended cleanly within the cap, else null.
 */
export function cachingCollector(cap: number): { stream: Transform; result(): Buffer | null } {
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;
  let ended = false;
  const stream = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      if (!truncated) {
        size += chunk.length;
        if (size > cap) {
          truncated = true;
          chunks.length = 0; // don't hold a partial body
        } else {
          chunks.push(chunk);
        }
      }
      cb(null, chunk);
    },
    flush(cb) {
      ended = true;
      cb();
    },
  });
  return { stream, result: () => (ended && !truncated ? Buffer.concat(chunks) : null) };
}
