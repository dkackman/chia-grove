import pino from "pino";

const level = (process.env.LOG_LEVEL ?? "info") as pino.Level;
const token = process.env.AXIOM_TOKEN;
const dataset = process.env.AXIOM_DATASET;

export const log =
  token && dataset
    ? pino(
        { level },
        pino.transport({
          target: "@axiomhq/pino",
          options: { token, dataset },
        })
      )
    : pino({ level });
