#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { loadRuntimeConfig } from "./lib/config-loader.mjs";
import { createContactSheet } from "./lib/contact-sheet.mjs";
import { loadRegisteredMaster } from "./lib/master-artifact.mjs";
import { atomicWrite } from "./lib/output-validator.mjs";
import { loadApprovedCalibration, renderV3Output } from "./lib/platform-adapter.mjs";
import { CoverError, sha256File } from "./lib/spec-validator.mjs";
import {
  readApprovedReview,
  readV3Spec,
  resolveV3ProjectInputs,
  validateAiReview
} from "./lib/v3-spec-validator.mjs";

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== "--spec") {
    throw new CoverError("INVALID_ARGUMENTS", "usage: render-v3.mjs --spec runs/<run-id>/cover-spec.json");
  }
  return argv[1];
}

function within(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function approvedMaster({ group, masterOutput, spec, runtime, projectRoot, runDir }) {
  const registered = await loadRegisteredMaster({ projectRoot, runDir, group, masterOutput });
  let aiReview;
  try {
    aiReview = JSON.parse(await readFile(path.join(registered.groupDir, "ai-review.json"), "utf8"));
  } catch (error) {
    throw new CoverError("WAITING_FOR_USER", `${group.id} AI cover review is required: ${error.message}`);
  }
  validateAiReview(aiReview, spec, runtime.ipManifest);
  await readApprovedReview(path.join(registered.groupDir, "user-review.json"), {
    checkpoint: "full-cover-review",
    subjectPath: path.relative(projectRoot, registered.masterPath),
    subjectSha256: registered.artifact.master.sha256
  });
  return {
    ...registered,
    aiReviewPath: path.join(registered.groupDir, "ai-review.json"),
    userReviewPath: path.join(registered.groupDir, "user-review.json")
  };
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDir, "../../..");
  const skillRoot = path.join(projectRoot, "skills/lux-cover");
  const argument = parseArgs(process.argv.slice(2));
  if (path.isAbsolute(argument)) throw new CoverError("INVALID_PATH", "spec path must be project-relative");
  const specPath = await realpath(path.join(projectRoot, argument));
  const runsRoot = await realpath(path.join(projectRoot, "runs"));
  if (!within(specPath, runsRoot) || path.basename(specPath) !== "cover-spec.json") {
    throw new CoverError("INVALID_PATH", "spec must be runs/<run-id>/cover-spec.json");
  }
  const spec = await readV3Spec(specPath);
  const runtime = await loadRuntimeConfig(skillRoot);
  const { runDir } = await resolveV3ProjectInputs(spec, projectRoot, runtime);
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
  const pendingWrites = [];
  const references = {
    version: 3,
    run_id: spec.run_id,
    article: spec.source,
    profile: {
      id: runtime.profile.id,
      path: path.relative(projectRoot, path.join(skillRoot, runtime.config.profile_path))
    },
    identity: {
      id: runtime.ipManifest.identity.id,
      path: path.relative(projectRoot, path.join(skillRoot, "assets", runtime.ipManifest.identity.file)),
      sha256: runtime.ipManifest.identity.sha256
    },
    aspect_groups: [],
    outputs: []
  };
  for (const group of spec.aspect_groups) {
    const master = masters.get(group.id);
    references.aspect_groups.push({
      id: group.id,
      master_output_id: group.master_output_id,
      semantic_core: group.semantic_core ?? null,
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
    let calibration = null;
    if (output.adaptation.mode === "evidence-safe-padding") {
      calibration = await loadApprovedCalibration({
        calibrationPath: output.adaptation.calibration_path,
        projectRoot,
        runDir,
        output
      });
    }
    const rendered = await renderV3Output({
      masterBuffer: master.masterBuffer,
      output,
      profile: runtime.profile,
      visibleCrop: calibration?.visibleCrop ?? null
    });
    const outputMeta = await sharp(rendered.outputBuffer).metadata();
    if (outputMeta.format !== "png" || outputMeta.width !== output.width || outputMeta.height !== output.height) {
      throw new CoverError("OUTPUT_VALIDATION_FAILED", `${output.id} does not match its final dimensions`);
    }
    if (
      rendered.artifact.transform.scale_x !== rendered.artifact.transform.scale_y ||
      rendered.artifact.transform.direct_stretch !== false
    ) {
      throw new CoverError("OUTPUT_VALIDATION_FAILED", `${output.id} contains a stretched raster transform`);
    }
    const outputPath = path.join(runDir, "outputs", `${output.id}.png`);
    const overlayPath = path.join(runDir, "previews", `${output.id}-crop-overlay.png`);
    const visiblePath = path.join(runDir, "previews", `${output.id}-visible.png`);
    const artifactPath = path.join(runDir, "artifacts", `${output.id}.json`);
    const displayCropPreviews = (rendered.displayPreviews ?? []).map((preview) => {
      const previewPath = path.join(runDir, "previews", `${output.id}-visible-${preview.id}.png`);
      return {
        ...preview,
        path: previewPath,
        relativePath: path.relative(projectRoot, previewPath),
        sha256: sha256(preview.buffer)
      };
    });
    const artifact = {
      ...rendered.artifact,
      platform_id: output.platform_id,
      aspect_group_id: output.aspect_group_id,
      final: {
        path: path.relative(projectRoot, outputPath),
        width: output.width,
        height: output.height,
        sha256: sha256(rendered.outputBuffer)
      },
      master: {
        path: master.artifact.master.path,
        sha256: master.artifact.master.sha256
      },
      calibration: calibration ? {
        path: calibration.calibrationPath,
        sha256: calibration.calibrationSha256
      } : null,
      previews: {
        crop_overlay: {
          path: path.relative(projectRoot, overlayPath),
          sha256: sha256(rendered.overlayBuffer)
        },
        visible: {
          path: path.relative(projectRoot, visiblePath),
          sha256: sha256(rendered.visibleBuffer)
        },
        display_crops: displayCropPreviews.map((preview) => ({
          id: preview.id,
          crop: preview.crop,
          path: preview.relativePath,
          sha256: preview.sha256
        }))
      }
    };
    pendingWrites.push(
      atomicWrite(outputPath, rendered.outputBuffer),
      atomicWrite(overlayPath, rendered.overlayBuffer),
      atomicWrite(visiblePath, rendered.visibleBuffer),
      atomicWrite(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`),
      ...displayCropPreviews.map((preview) => atomicWrite(preview.path, preview.buffer))
    );
    entries.push({ ...output, buffer: rendered.outputBuffer });
    reports.push({
      output_id: output.id,
      platform_id: output.platform_id,
      aspect_group_id: output.aspect_group_id,
      width: output.width,
      height: output.height,
      sha256: artifact.final.sha256,
      adaptation_mode: output.adaptation.mode,
      transform: artifact.transform,
      visible_crop: artifact.visible_crop,
      visible_crops: artifact.visible_crops ?? [],
      inserted_cover: artifact.inserted_cover,
      background_sample: artifact.background_sample ?? null,
      outer_background: artifact.outer_background,
      mechanical_status: "passed",
      human_status: "pending"
    });
    references.outputs.push({
      output_id: output.id,
      path: artifact.final.path,
      sha256: artifact.final.sha256,
      artifact: {
        path: path.relative(projectRoot, artifactPath),
        sha256: sha256(Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`))
      }
    });
  }
  await Promise.all(pendingWrites);
  const validation = {
    version: 3,
    status: "mechanically-passed",
    human_status: "pending-final-output-review",
    run_id: spec.run_id,
    outputs: reports
  };
  const contactSheet = await createContactSheet(entries, runtime.config);
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
  process.stderr.write(`${error.code ?? "V3_RENDER_FAILED"}: ${error.message}\n`);
  process.exitCode = 1;
});
