#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { recordGenerationAttempt } from "./lib/attempt-state.mjs";
import { CoverError } from "./lib/common.mjs";

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`usage: guard-cover-attempt.mjs --run <run-id> --issue <aspect-group-id>
`);
    process.exit(0);
  }
  if (argv.length !== 4 || argv[0] !== "--run" || argv[2] !== "--issue") {
    throw new CoverError("GUARD_FAILED", "usage: guard-cover-attempt.mjs --run <run-id> --issue <aspect-group-id>");
  }
  const values = { run: argv[1], issue: argv[3] };
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/.test(values.run) ||
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/.test(values.issue)) {
    throw new CoverError("GUARD_FAILED", "run and issue must be lowercase hyphenated identifiers (min 2 chars)");
  }
  return values;
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDir, "../../..");
  const args = parseArgs(process.argv.slice(2));
  const config = JSON.parse(
    await readFile(path.join(projectRoot, "skills/lux-cover/assets/renderer.json"), "utf8")
  );
  const result = await recordGenerationAttempt({
    filePath: path.join(projectRoot, "runs", args.run, "cover-attempts.json"),
    issueId: args.issue,
    limit: config.limits.cover_attempt_limit
  });
  process.stdout.write(`${JSON.stringify({ kind: "full-cover", ...result })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.code ?? "COVER_ATTEMPT_FAILED"}: ${error.message}\n`);
  process.exitCode = 1;
});
