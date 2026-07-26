#!/usr/bin/env node
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  CoverError,
  readJson,
  sha256File
} from "../../lux-cover/scripts/lib/spec-validator.mjs";
import { loadRegisteredGraphMaster } from "./lib/artifact-pipeline.mjs";
import { loadGraphRuntime } from "./lib/config-loader.mjs";
import {
  readApprovedReview,
  readGraphSpec,
  resolveGraphProjectInputs,
  validateAiReview
} from "./lib/spec-validator.mjs";

const SAFE_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/;

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`usage: validate-run.mjs --run <run-id>
`);
    process.exit(0);
  }
  if (argv.length !== 2 || argv[0] !== "--run" || !SAFE_ID.test(argv[1])) {
    throw new CoverError("INVALID_ARGUMENTS", "usage: validate-run.mjs --run <run-id>");
  }
  return argv[1];
}

async function validateMasterReviews({
  group,
  masterOutput,
  spec,
  runtime,
  projectRoot,
  runDir
}) {
  const master = await loadRegisteredGraphMaster({
    projectRoot,
    runDir,
    group,
    masterOutput
  });
  const aiReview = await readJson(
    path.join(master.groupDir, "ai-review.json"),
    "AI paragraph graph review"
  );
  validateAiReview(aiReview, spec, runtime.shared.ipManifest);
  await readApprovedReview(path.join(master.groupDir, "user-review.json"), {
    checkpoint: "full-graph-review",
    subjectPath: path.relative(projectRoot, master.masterPath),
    subjectSha256: master.artifact.master.sha256
  });
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDir, "../../..");
  const graphRoot = path.join(projectRoot, "skills", "lux-paragraph-graph");
  const runId = parseArgs(process.argv.slice(2));
  const runDir = await realpath(
    path.join(projectRoot, "runs", "lux-paragraph-graph", runId)
  );
  const spec = await readGraphSpec(path.join(runDir, "graph-spec.json"));
  const runtime = await loadGraphRuntime(projectRoot, graphRoot);
  await resolveGraphProjectInputs(spec, projectRoot, runtime);
  const [validation, references] = await Promise.all([
    readJson(path.join(runDir, "validation.json"), "paragraph graph validation"),
    readJson(path.join(runDir, "references.json"), "paragraph graph references")
  ]);
  if (
    validation.version !== 1 ||
    validation.status !== "mechanically-passed" ||
    validation.run_id !== runId ||
    references.version !== 1 ||
    references.run_id !== runId
  ) {
    throw new CoverError(
      "GRAPH_RUN_VALIDATION_FAILED",
      "validation or references are not wired to the run"
    );
  }
  for (const group of spec.aspect_groups) {
    const masterOutput = spec.outputs.find((output) => output.id === group.master_output_id);
    await validateMasterReviews({
      group,
      masterOutput,
      spec,
      runtime,
      projectRoot,
      runDir
    });
  }
  for (const output of spec.outputs) {
    const report = validation.outputs.find((entry) => entry.output_id === output.id);
    const reference = references.outputs.find((entry) => entry.output_id === output.id);
    const outputPath = path.join(runDir, "outputs", `${output.id}.png`);
    const artifactPath = path.join(runDir, "artifacts", `${output.id}.json`);
    if (!report || !reference) {
      throw new CoverError("GRAPH_RUN_VALIDATION_FAILED", `${output.id} report is missing`);
    }
    if (
      await sha256File(outputPath) !== report.sha256 ||
      await sha256File(outputPath) !== reference.sha256 ||
      await sha256File(artifactPath) !== reference.artifact.sha256
    ) {
      throw new CoverError("GRAPH_RUN_VALIDATION_FAILED", `${output.id} hash changed`);
    }
    const [metadata, artifact] = await Promise.all([
      sharp(outputPath).metadata(),
      readJson(artifactPath, `${output.id} artifact`)
    ]);
    if (
      metadata.format !== "png" ||
      metadata.width !== output.width ||
      metadata.height !== output.height ||
      artifact.output_id !== output.id ||
      artifact.aspect_group_id !== output.aspect_group_id ||
      artifact.final.sha256 !== report.sha256 ||
      artifact.transform.scale_x !== artifact.transform.scale_y ||
      artifact.transform.direct_stretch !== false
    ) {
      throw new CoverError(
        "GRAPH_RUN_VALIDATION_FAILED",
        `${output.id} metadata, artifact, or transform is invalid`
      );
    }
  }
  await readFile(path.join(runDir, "contact-sheet.png"));
  let humanStatus = "pending-final-output-review";
  const referencesPath = path.join(runDir, "references.json");
  try {
    await readApprovedReview(path.join(runDir, "reviews", "final-output.json"), {
      checkpoint: "final-output-review",
      subjectPath: path.relative(projectRoot, referencesPath),
      subjectSha256: await sha256File(referencesPath)
    });
    humanStatus = "accepted";
  } catch (error) {
    if (error.code !== "WAITING_FOR_USER") throw error;
  }
  process.stdout.write(`${JSON.stringify({
    status: "mechanically-passed",
    human_status: humanStatus,
    run_id: runId,
    outputs: spec.outputs.length
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.code ?? "GRAPH_RUN_VALIDATION_FAILED"}: ${error.message}\n`);
  process.exitCode = 1;
});
