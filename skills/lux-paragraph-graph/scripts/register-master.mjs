#!/usr/bin/env node
import { realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CoverError } from "../../lux-cover/scripts/lib/spec-validator.mjs";
import { registerGraphMaster } from "./lib/artifact-pipeline.mjs";
import { loadGraphRuntime } from "./lib/config-loader.mjs";
import { readGraphSpec, resolveGraphProjectInputs } from "./lib/spec-validator.mjs";

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`usage: register-master.mjs --spec runs/lux-paragraph-graph/<run-id>/graph-spec.json --aspect-group <id> --source <artifact>
`);
    process.exit(0);
  }
  if (
    argv.length !== 6 ||
    argv[0] !== "--spec" ||
    argv[2] !== "--aspect-group" ||
    argv[4] !== "--source"
  ) {
    throw new CoverError(
      "INVALID_ARGUMENTS",
      "usage: register-master.mjs --spec runs/lux-paragraph-graph/<run-id>/graph-spec.json --aspect-group <id> --source <image-gen-artifact>"
    );
  }
  return { spec: argv[1], group: argv[3], source: argv[5] };
}

function within(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDir, "../../..");
  const graphRoot = path.join(projectRoot, "skills", "lux-paragraph-graph");
  const args = parseArgs(process.argv.slice(2));
  if (path.isAbsolute(args.spec)) throw new CoverError("INVALID_PATH", "spec path must be project-relative");
  const specPath = await realpath(path.join(projectRoot, args.spec));
  const runsRoot = await realpath(path.join(projectRoot, "runs", "lux-paragraph-graph"));
  if (!within(specPath, runsRoot) || path.basename(specPath) !== "graph-spec.json") {
    throw new CoverError(
      "INVALID_PATH",
      "spec must be runs/lux-paragraph-graph/<run-id>/graph-spec.json"
    );
  }
  const spec = await readGraphSpec(specPath);
  const runtime = await loadGraphRuntime(projectRoot, graphRoot);
  const { runDir } = await resolveGraphProjectInputs(spec, projectRoot, runtime);
  const group = spec.aspect_groups.find((entry) => entry.id === args.group);
  if (!group) throw new CoverError("INVALID_GRAPH_SPEC", `unknown aspect group: ${args.group}`);
  const masterOutput = spec.outputs.find((output) => output.id === group.master_output_id);
  const sourcePath = await realpath(
    path.isAbsolute(args.source) ? args.source : path.join(projectRoot, args.source)
  );
  const result = await registerGraphMaster({
    sourcePath,
    projectRoot,
    runDir,
    group,
    masterOutput,
    runtime
  });
  process.stdout.write(`${JSON.stringify({
    status: "master-registered",
    group_id: group.id,
    attempt: result.artifact.attempt,
    master: result.artifact.master
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.code ?? "GRAPH_MASTER_REGISTRATION_FAILED"}: ${error.message}\n`);
  process.exitCode = 1;
});
