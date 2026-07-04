# shared/

`@grove/shared` — TypeScript event types only. No build step; both server and web import the `.ts` source directly.

Entry point: `shared/src/index.ts`

## Event types

| Type               | When emitted                                                   |
| ------------------ | -------------------------------------------------------------- |
| `BlockEvent`       | Every new block                                                |
| `SproutEvent`      | Every classified coin spend                                    |
| `AmbientEvent`     | Each poll cycle (mempool, netspace)                            |
| `ReorgEvent`       | Chain reorg detected                                           |
| `ContentFlagEvent` | Late SafeSearch verdict for an already-emitted NFT image spend |
| `Hello`            | First message on every connection (protocol version)           |
| `Snapshot`         | Sent after `Hello` on connect (full ring buffer)               |
| `Batch`            | Live streaming: one or more events per frame                   |

`SproutEvent` carries `mediaFilter` stamped inline by the ContentFilter cheap-signals tier before the event reaches the Hub. (The per-signal `signals?: string[]` field was removed in protocol v5 — clients never consumed it.)
