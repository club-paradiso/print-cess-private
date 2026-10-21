import { parseWorkerConfig } from "./config";
import { defaultDeps, runWorker } from "./worker";

function main(): void {
  let config;
  try {
    config = parseWorkerConfig(process.env);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        ts: new Date().toISOString(),
        event: "fatal",
        message: error instanceof Error ? error.message : "invalid configuration",
      })}\n`,
    );
    process.exit(1);
    return;
  }

  const controller = new AbortController();
  const stop = (): void => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  runWorker(config, defaultDeps(), controller.signal)
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

main();
