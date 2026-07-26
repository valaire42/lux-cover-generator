#!/usr/bin/env node
import { realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRuntimeConfig } from "./lib/config-loader.mjs";
import { registerMasterArtifact } from "./lib/master-artifact.mjs";
import { CoverError } from "./lib/spec-validator.mjs";
import { readV3Spec, resolveV3ProjectInputs } from "./lib/v3-spec-validator.mjs";

function parseArgs(argv) {
  if (
    argv.length !== 6 ||
    argv[0] !== "--spec" ||
    argv[2] !== "--aspect-group" ||
    argv[4] !== "--source"
  ) {
    throw new CoverError(
      "INVALID_ARGUMENTS",
      "usage: register-master.mjs --spec runs/<run-id>/cover-spec.json --aspect-group <id> --source <image-gen-artifact>"
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
  const skillRoot = path.join(projectRoot, "skills/lux-cover");
  const args = parseArgs(process.argv.slice(2));
  if (path.isAbsolute(args.spec)) throw new CoverError("INVALID_PATH", "spec path must be project-relative");
  const specPath = await realpath(path.join(projectRoot, args.spec));
  const runsRoot = await realpath(path.join(projectRoot, "runs"));
  if (!within(specPath, runsRoot) || path.basename(specPath) !== "cover-spec.json") {
    throw new CoverError("INVALID_PATH", "spec must be runs/<run-id>/cover-spec.json");
  }
  const spec = await readV3Spec(specPath);
  const runtime = await loadRuntimeConfig(skillRoot);
  const { runDir } = await resolveV3ProjectInputs(spec, projectRoot, runtime);
  const group = spec.aspect_groups.find((entry) => entry.id === args.group);
  if (!group) throw new CoverError("INVALID_V3_SPEC", `unknown aspect group: ${args.group}`);
  const masterOutput = spec.outputs.find((output) => output.id === group.master_output_id);
  const sourcePath = await realpath(path.isAbsolute(args.source) ? args.source : path.join(projectRoot, args.source));
  const result = await registerMasterArtifact({
    sourcePath,
    projectRoot,
    skillRoot,
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
  process.stderr.write(`${error.code ?? "MASTER_REGISTRATION_FAILED"}: ${error.message}\n`);
  process.exitCode = 1;
});
