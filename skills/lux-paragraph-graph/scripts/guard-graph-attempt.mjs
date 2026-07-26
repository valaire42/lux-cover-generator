#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordGenerationAttempt } from "../../lux-cover/scripts/lib/attempt-state.mjs";
import { loadGraphRuntime } from "./lib/config-loader.mjs";

const SAFE_ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

function parseArgs(argv) {
  if (argv.length !== 4 || argv[0] !== "--run" || argv[2] !== "--issue") {
    throw new Error("usage: guard-graph-attempt.mjs --run <run-id> --issue <aspect-group-id>");
  }
  if (!SAFE_ID.test(argv[1]) || !SAFE_ID.test(argv[3])) {
    throw new Error("run and issue must be lowercase hyphenated identifiers");
  }
  return { run: argv[1], issue: argv[3] };
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDir, "../../..");
  const graphRoot = path.join(projectRoot, "skills", "lux-paragraph-graph");
  const args = parseArgs(process.argv.slice(2));
  const runtime = await loadGraphRuntime(projectRoot, graphRoot);
  const result = await recordGenerationAttempt({
    filePath: path.join(
      projectRoot,
      "runs",
      "lux-paragraph-graph",
      args.run,
      "graph-attempts.json"
    ),
    issueId: args.issue,
    limit: runtime.runtimeConfig.limits.graph_attempt_limit
  });
  process.stdout.write(`${JSON.stringify({ kind: "paragraph-graph", ...result })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.code ?? "GRAPH_ATTEMPT_FAILED"}: ${error.message}\n`);
  process.exitCode = 1;
});
