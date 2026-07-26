#!/usr/bin/env node
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { createContactSheet } from "../../lux-cover/scripts/lib/contact-sheet.mjs";
import { atomicWrite } from "../../lux-cover/scripts/lib/output-validator.mjs";
import { CoverError, readJson, sha256, sha256File, within } from "../../lux-cover/scripts/lib/common.mjs";
import {
  loadRegisteredGraphMaster,
  renderGraphOutput
} from "./lib/artifact-pipeline.mjs";
import { loadGraphRuntime } from "./lib/config-loader.mjs";
import {
  readApprovedReview,
  readGraphSpec,
  resolveGraphProjectInputs,
  validateAiReview
} from "./lib/spec-validator.mjs";

function parseArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(`usage: render.mjs --spec runs/lux-paragraph-graph/<run-id>/graph-spec.json\n`);
    process.exit(0);
  }
  if (argv.length !== 2 || argv[0] !== "--spec") {
    throw new CoverError(
      "INVALID_ARGUMENTS",
      "usage: render.mjs --spec runs/lux-paragraph-graph/<run-id>/graph-spec.json"
    );
  }
  return argv[1];
}

async function approvedMaster({ group, masterOutput, spec, runtime, projectRoot, runDir }) {
  const registered = await loadRegisteredGraphMaster({
    projectRoot,
    runDir,
    group,
    masterOutput
  });
  const aiReviewPath = path.join(registered.groupDir, "ai-review.json");
  const userReviewPath = path.join(registered.groupDir, "user-review.json");
  const aiReview = await readJson(aiReviewPath, "AI paragraph graph review");
  validateAiReview(aiReview, spec, runtime.shared.ipManifest);
  await readApprovedReview(userReviewPath, {
    checkpoint: "full-graph-review",
    subjectPath: path.relative(projectRoot, registered.masterPath),
    subjectSha256: registered.artifact.master.sha256
  });
  return { ...registered, aiReviewPath, userReviewPath };
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDir, "../../..");
  const graphRoot = path.join(projectRoot, "skills", "lux-paragraph-graph");
  const argument = parseArgs(process.argv.slice(2));
  if (path.isAbsolute(argument)) throw new CoverError("INVALID_PATH", "spec path must be project-relative");
  const specPath = await realpath(path.join(projectRoot, argument));
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
  const masters = new Map();
  for (const group of spec.aspect_groups) {
    const masterOutput = spec.outputs.find((output) => output.id === group.master_output_id);
    masters.set(group.id, await approvedMaster({
      group,
      masterOutput,
      spec,
      runtime,
      projectRoot,
      runDir
    }));
  }

  const entries = [];
  const reports = [];
  const writes = [];
  const references = {
    version: 1,
    run_id: spec.run_id,
    source: spec.source,
    visual_card: spec.visual_card,
    profile: {
      id: runtime.profileOverlay.id,
      path: path.relative(projectRoot, runtime.overlayPath),
      sha256: await sha256File(runtime.overlayPath),
      extends: {
        id: runtime.shared.profile.id,
        path: runtime.profileOverlay.extends.path,
        sha256: await sha256File(
          path.join(runtime.sharedRoot, runtime.shared.config.profile_path)
        )
      }
    },
    identity: {
      id: runtime.shared.ipManifest.identity.id,
      path: path.relative(projectRoot, runtime.identityPath),
      sha256: runtime.shared.ipManifest.identity.sha256
    },
    aspect_groups: [],
    outputs: []
  };
  for (const group of spec.aspect_groups) {
    const master = masters.get(group.id);
    references.aspect_groups.push({
      id: group.id,
      master_output_id: group.master_output_id,
      raw: master.artifact.raw,
      master: master.artifact.master,
      artifact: {
        path: path.relative(projectRoot, master.artifactPath),
        sha256: await sha256File(master.artifactPath)
      },
      ai_review: {
        path: path.relative(projectRoot, master.aiReviewPath),
        sha256: await sha256File(master.aiReviewPath)
      },
      user_review: {
        path: path.relative(projectRoot, master.userReviewPath),
        sha256: await sha256File(master.userReviewPath)
      }
    });
  }
  for (const output of spec.outputs) {
    const master = masters.get(output.aspect_group_id);
    const rendered = await renderGraphOutput(master.masterBuffer, output);
    const metadata = await sharp(rendered.buffer).metadata();
    if (
      metadata.format !== "png" ||
      metadata.width !== output.width ||
      metadata.height !== output.height ||
      rendered.transform.scale_x !== rendered.transform.scale_y ||
      rendered.transform.direct_stretch !== false
    ) {
      throw new CoverError(
        "GRAPH_OUTPUT_VALIDATION_FAILED",
        `${output.id} output metadata or transform is invalid`
      );
    }
    const outputPath = path.join(runDir, "outputs", `${output.id}.png`);
    const artifactPath = path.join(runDir, "artifacts", `${output.id}.json`);
    const artifact = {
      version: 1,
      output_id: output.id,
      aspect_group_id: output.aspect_group_id,
      final: {
        path: path.relative(projectRoot, outputPath),
        width: output.width,
        height: output.height,
        sha256: sha256(rendered.buffer)
      },
      master: {
        path: master.artifact.master.path,
        sha256: master.artifact.master.sha256
      },
      transform: rendered.transform
    };
    const artifactBuffer = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
    writes.push(
      atomicWrite(outputPath, rendered.buffer),
      atomicWrite(artifactPath, artifactBuffer)
    );
    entries.push({ ...output, buffer: rendered.buffer });
    reports.push({
      output_id: output.id,
      aspect_group_id: output.aspect_group_id,
      width: output.width,
      height: output.height,
      sha256: artifact.final.sha256,
      transform: rendered.transform,
      mechanical_status: "passed",
      human_status: "pending"
    });
    references.outputs.push({
      output_id: output.id,
      path: artifact.final.path,
      sha256: artifact.final.sha256,
      artifact: {
        path: path.relative(projectRoot, artifactPath),
        sha256: sha256(artifactBuffer)
      }
    });
  }
  await Promise.all(writes);
  const validation = {
    version: 1,
    status: "mechanically-passed",
    human_status: "pending-final-output-review",
    run_id: spec.run_id,
    outputs: reports
  };
  const contactSheet = await createContactSheet(entries, runtime.shared.config);
  await Promise.all([
    atomicWrite(path.join(runDir, "references.json"), `${JSON.stringify(references, null, 2)}\n`),
    atomicWrite(path.join(runDir, "validation.json"), `${JSON.stringify(validation, null, 2)}\n`),
    atomicWrite(path.join(runDir, "contact-sheet.png"), contactSheet)
  ]);
  process.stdout.write(`${JSON.stringify({
    status: validation.status,
    human_status: validation.human_status,
    run_id: spec.run_id,
    outputs: reports.length
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.code ?? "GRAPH_RENDER_FAILED"}: ${error.message}\n`);
  process.exitCode = 1;
});
