#!/usr/bin/env node
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { loadRuntimeConfig } from "./lib/config-loader.mjs";
import { loadRegisteredMaster } from "./lib/master-artifact.mjs";
import { CoverError, readJson, sha256File } from "./lib/spec-validator.mjs";
import {
  readApprovedReview,
  readV3Spec,
  resolveV3ProjectInputs,
  validateAiReview
} from "./lib/v3-spec-validator.mjs";

function parseArgs(argv) {
  if (argv.length !== 2 || argv[0] !== "--run") {
    throw new CoverError("INVALID_ARGUMENTS", "usage: validate-v3-run.mjs --run <run-id>");
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(argv[1])) {
    throw new CoverError("INVALID_PATH", "run id is invalid");
  }
  return argv[1];
}

async function validateMasterReviews({ group, masterOutput, spec, runtime, projectRoot, runDir }) {
  const master = await loadRegisteredMaster({ projectRoot, runDir, group, masterOutput });
  const aiReview = await readJson(path.join(master.groupDir, "ai-review.json"), "AI cover review");
  validateAiReview(aiReview, spec, runtime.ipManifest);
  await readApprovedReview(path.join(master.groupDir, "user-review.json"), {
    checkpoint: "full-cover-review",
    subjectPath: path.relative(projectRoot, master.masterPath),
    subjectSha256: master.artifact.master.sha256
  });
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(scriptDir, "../../..");
  const skillRoot = path.join(projectRoot, "skills/lux-cover");
  const runId = parseArgs(process.argv.slice(2));
  const runDir = await realpath(path.join(projectRoot, "runs", runId));
  const spec = await readV3Spec(path.join(runDir, "cover-spec.json"));
  const runtime = await loadRuntimeConfig(skillRoot);
  await resolveV3ProjectInputs(spec, projectRoot, runtime);
  const [validation, references] = await Promise.all([
    readJson(path.join(runDir, "validation.json"), "V3 validation"),
    readJson(path.join(runDir, "references.json"), "V3 references")
  ]);
  if (
    validation.version !== 3 ||
    validation.status !== "mechanically-passed" ||
    validation.run_id !== runId ||
    references.version !== 3 ||
    references.run_id !== runId
  ) {
    throw new CoverError("RUN_VALIDATION_FAILED", "V3 validation or references are not wired to the run");
  }
  for (const group of spec.aspect_groups) {
    const masterOutput = spec.outputs.find((output) => output.id === group.master_output_id);
    await validateMasterReviews({ group, masterOutput, spec, runtime, projectRoot, runDir });
  }
  for (const output of spec.outputs) {
    const report = validation.outputs.find((entry) => entry.output_id === output.id);
    const reference = references.outputs.find((entry) => entry.output_id === output.id);
    const outputPath = path.join(runDir, "outputs", `${output.id}.png`);
    const artifactPath = path.join(runDir, "artifacts", `${output.id}.json`);
    const overlayPath = path.join(runDir, "previews", `${output.id}-crop-overlay.png`);
    const visiblePath = path.join(runDir, "previews", `${output.id}-visible.png`);
    if (!report || !reference || await sha256File(outputPath) !== report.sha256) {
      throw new CoverError("RUN_VALIDATION_FAILED", `${output.id} output hash changed`);
    }
    if (
      await sha256File(outputPath) !== reference.sha256 ||
      await sha256File(artifactPath) !== reference.artifact.sha256
    ) {
      throw new CoverError("RUN_VALIDATION_FAILED", `${output.id} reference hash changed`);
    }
    const [outputMeta, overlayMeta, visibleMeta, artifact] = await Promise.all([
      sharp(outputPath).metadata(),
      sharp(overlayPath).metadata(),
      sharp(visiblePath).metadata(),
      readJson(artifactPath, `${output.id} artifact`)
    ]);
    if (
      outputMeta.width !== output.width ||
      outputMeta.height !== output.height ||
      overlayMeta.width !== output.width ||
      overlayMeta.height !== output.height
    ) {
      throw new CoverError("RUN_VALIDATION_FAILED", `${output.id} output or overlay dimensions changed`);
    }
    if (
      visibleMeta.width !== artifact.visible_crop.width ||
      visibleMeta.height !== artifact.visible_crop.height ||
      artifact.output_id !== output.id ||
      artifact.aspect_group_id !== output.aspect_group_id ||
      artifact.transform.scale_x !== artifact.transform.scale_y ||
      artifact.transform.direct_stretch !== false
    ) {
      throw new CoverError("RUN_VALIDATION_FAILED", `${output.id} artifact or visible preview is invalid`);
    }
    if (
      await sha256File(overlayPath) !== artifact.previews.crop_overlay.sha256 ||
      await sha256File(visiblePath) !== artifact.previews.visible.sha256
    ) {
      throw new CoverError("RUN_VALIDATION_FAILED", `${output.id} preview hash changed`);
    }
    const displayPreviews = artifact.previews.display_crops ?? [];
    if (output.adaptation.mode === "shared-crop-core") {
      if (
        artifact.adaptation_mode !== "shared-crop-core" ||
        artifact.crop_basis !== "user-approved-theoretical-crops" ||
        !Array.isArray(artifact.visible_crops) ||
        artifact.visible_crops.length !== output.adaptation.visible_crops.length ||
        displayPreviews.length !== output.adaptation.visible_crops.length ||
        !artifact.background_sample ||
        typeof artifact.background_sample.ink_ratio !== "number" ||
        typeof artifact.background_sample.max_ink_ratio !== "number" ||
        artifact.background_sample.ink_ratio > artifact.background_sample.max_ink_ratio ||
        artifact.outer_background?.style !== "source-matched-paper-only" ||
        artifact.outer_background?.outer_border !== false ||
        artifact.outer_background?.decorations !== false ||
        artifact.outer_background?.semantic_content !== false
      ) {
        throw new CoverError("RUN_VALIDATION_FAILED", `${output.id} shared crop artifact is incomplete`);
      }
      for (const preview of displayPreviews) {
        const expectedPreviewPath = path.join(runDir, "previews", `${output.id}-visible-${preview.id}.png`);
        if (preview.path !== path.relative(projectRoot, expectedPreviewPath)) {
          throw new CoverError("RUN_VALIDATION_FAILED", `${output.id} display crop preview path is invalid`);
        }
        const previewPath = expectedPreviewPath;
        const previewMeta = await sharp(previewPath).metadata();
        const crop = preview.crop;
        if (
          previewMeta.width !== crop.width ||
          previewMeta.height !== crop.height ||
          await sha256File(previewPath) !== preview.sha256 ||
          artifact.inserted_cover.x < crop.x ||
          artifact.inserted_cover.y < crop.y ||
          artifact.inserted_cover.x + artifact.inserted_cover.width > crop.x + crop.width ||
          artifact.inserted_cover.y + artifact.inserted_cover.height > crop.y + crop.height
        ) {
          throw new CoverError("RUN_VALIDATION_FAILED", `${output.id} display crop preview ${preview.id} is invalid`);
        }
      }
    } else if (displayPreviews.length !== 0) {
      throw new CoverError("RUN_VALIDATION_FAILED", `${output.id} has unexpected display crop previews`);
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
  process.stderr.write(`${error.code ?? "RUN_VALIDATION_FAILED"}: ${error.message}\n`);
  process.exitCode = 1;
});
