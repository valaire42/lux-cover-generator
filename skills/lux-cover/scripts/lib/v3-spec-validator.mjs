import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { CoverError, readJson, sha256File, validateTransparentPng } from "./spec-validator.mjs";

const SAFE_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const CONTROL_TEXT = /[\u0000-\u001f\u007f]/;

function fail(code, message) {
  throw new CoverError(code, message);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_V3_SPEC", `${label} must be an object`);
  }
}

function exactKeys(value, allowed, label) {
  object(value, label);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  const missing = allowed.filter((key) => !(key in value));
  if (unknown.length) fail("INVALID_V3_SPEC", `${label} has unknown field(s): ${unknown.join(", ")}`);
  if (missing.length) fail("INVALID_V3_SPEC", `${label} is missing field(s): ${missing.join(", ")}`);
}

function safeId(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    fail("INVALID_V3_SPEC", `${label} must be a lowercase hyphenated identifier`);
  }
}

function text(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail("INVALID_V3_SPEC", `${label} must be non-empty text`);
  }
  if (CONTROL_TEXT.test(value)) fail("INVALID_V3_SPEC", `${label} contains a control character`);
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) fail("INVALID_V3_SPEC", `${label} must be a non-empty array`);
  value.forEach((entry, index) => text(entry, `${label}[${index}]`));
}

function sameValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameSharedCropContract(left, right) {
  if (
    left.basis !== right.basis ||
    left.visible_crops.length !== right.visible_crops.length
  ) {
    return false;
  }
  return left.visible_crops.every((crop, index) => {
    const other = right.visible_crops[index];
    return (
      crop.id === other.id &&
      crop.left === other.left &&
      crop.top === other.top &&
      crop.right === other.right &&
      crop.bottom === other.bottom
    );
  });
}

function validateTitle(title, config) {
  exactKeys(title, ["lines"], "title");
  if (!Array.isArray(title.lines) || title.lines.length < 1 || title.lines.length > config.title.max_lines) {
    fail("INVALID_V3_SPEC", `title.lines must contain 1 to ${config.title.max_lines} lines`);
  }
  let emphasized = false;
  for (const [lineIndex, line] of title.lines.entries()) {
    exactKeys(line, ["segments"], `title.lines[${lineIndex}]`);
    if (!Array.isArray(line.segments) || line.segments.length < 1 || line.segments.length > config.title.max_segments_per_line) {
      fail("INVALID_V3_SPEC", `title.lines[${lineIndex}].segments is out of range`);
    }
    for (const [segmentIndex, segment] of line.segments.entries()) {
      exactKeys(segment, ["text", "emphasis"], `title segment ${lineIndex}:${segmentIndex}`);
      text(segment.text, `title segment ${lineIndex}:${segmentIndex}.text`);
      if (typeof segment.emphasis !== "boolean") fail("INVALID_V3_SPEC", "title emphasis must be boolean");
      emphasized ||= segment.emphasis;
    }
  }
  if (!emphasized) fail("INVALID_V3_SPEC", "title must contain at least one emphasis segment");
}

function validateFlow(flow, config) {
  exactKeys(flow, ["items"], "flow");
  if (!Array.isArray(flow.items) || flow.items.length < 3 || flow.items.length > 4) {
    fail("INVALID_V3_SPEC", "flow.items must contain 3 to 4 items");
  }
  const ids = new Set();
  for (const [index, item] of flow.items.entries()) {
    exactKeys(item, ["id", "icon_id", "meaning"], `flow.items[${index}]`);
    safeId(item.id, `flow.items[${index}].id`);
    safeId(item.icon_id, `flow.items[${index}].icon_id`);
    text(item.meaning, `flow.items[${index}].meaning`);
    if (!config.diagram.icon_ids.includes(item.icon_id)) {
      fail("INVALID_V3_SPEC", `unknown icon_id: ${item.icon_id}`);
    }
    if (ids.has(item.id)) fail("INVALID_V3_SPEC", `duplicate flow id: ${item.id}`);
    ids.add(item.id);
  }
}

function validateDimensions(output, label, config) {
  const minimum = config.v3.min_dimension;
  for (const dimension of ["width", "height"]) {
    const value = output[dimension];
    if (!Number.isInteger(value) || value < minimum || value > config.limits.max_dimension) {
      fail("INVALID_V3_SPEC", `${label}.${dimension} is outside configured limits`);
    }
  }
  if (output.width * output.height > config.limits.max_pixels) {
    fail("INVALID_V3_SPEC", `${label} exceeds max pixel count`);
  }
  const ratio = output.width / output.height;
  if (ratio < config.limits.min_aspect_ratio || ratio > config.limits.max_aspect_ratio) {
    fail("INVALID_V3_SPEC", `${label} aspect ratio is unsupported`);
  }
}

function calibrationPath(value, runId, label) {
  if (typeof value !== "string" || path.isAbsolute(value) || path.posix.normalize(value) !== value) {
    fail("INVALID_V3_SPEC", `${label} must be a canonical project-relative calibration_path`);
  }
  const parts = value.split("/");
  if (
    parts.length !== 5 ||
    parts[0] !== "runs" ||
    parts[1] !== runId ||
    parts[2] !== "calibrations" ||
    !SAFE_ID.test(parts[3]) ||
    parts[4] !== "calibration.json"
  ) {
    fail("INVALID_V3_SPEC", `${label} must equal runs/<run-id>/calibrations/<id>/calibration.json`);
  }
}

function validateSharedCrops(crops, label) {
  if (!Array.isArray(crops) || crops.length < 2 || crops.length > 4) {
    fail("INVALID_V3_SPEC", `${label} must contain 2 to 4 crops`);
  }
  const ids = new Set();
  for (const [index, crop] of crops.entries()) {
    const cropLabel = `${label}[${index}]`;
    exactKeys(crop, ["id", "left", "top", "right", "bottom"], cropLabel);
    safeId(crop.id, `${cropLabel}.id`);
    if (ids.has(crop.id)) fail("INVALID_V3_SPEC", `${label} contains duplicate crop id: ${crop.id}`);
    ids.add(crop.id);
    for (const edge of ["left", "top", "right", "bottom"]) {
      if (typeof crop[edge] !== "number" || crop[edge] < 0 || crop[edge] > 1) {
        fail("INVALID_V3_SPEC", `${cropLabel}.${edge} must be between 0 and 1`);
      }
    }
    if (crop.left >= crop.right || crop.top >= crop.bottom) {
      fail("INVALID_V3_SPEC", `${cropLabel} must have positive area`);
    }
  }
  const intersection = {
    left: Math.max(...crops.map((crop) => crop.left)),
    top: Math.max(...crops.map((crop) => crop.top)),
    right: Math.min(...crops.map((crop) => crop.right)),
    bottom: Math.min(...crops.map((crop) => crop.bottom))
  };
  if (intersection.left >= intersection.right || intersection.top >= intersection.bottom) {
    fail("INVALID_V3_SPEC", `${label} must have a positive common intersection`);
  }
}

function validateAdaptation(adaptation, runId, label) {
  object(adaptation, label);
  if (adaptation.mode === "none") {
    exactKeys(adaptation, ["mode"], label);
    return;
  }
  if (adaptation.mode === "evidence-safe-padding") {
    exactKeys(adaptation, ["mode", "calibration_path"], label);
    calibrationPath(adaptation.calibration_path, runId, `${label}.calibration_path`);
    return;
  }
  if (adaptation.mode === "shared-crop-core") {
    exactKeys(adaptation, ["mode", "basis", "visible_crops"], label);
    if (adaptation.basis !== "user-approved-theoretical-crops") {
      fail("INVALID_V3_SPEC", `${label}.basis must identify user-approved theoretical crops`);
    }
    validateSharedCrops(adaptation.visible_crops, `${label}.visible_crops`);
    return;
  }
  fail("INVALID_V3_SPEC", `${label}.mode is unsupported`);
}

export function ratiosEqual(left, right) {
  return left.width * right.height === right.width * left.height;
}

export function titleTextLines(title) {
  return title.lines.map((line) => line.segments.map((segment) => segment.text).join(""));
}

export function validateV3SpecShape(spec, config, platforms, manifest) {
  exactKeys(
    spec,
    ["version", "run_id", "source", "profile_id", "title", "core_concept", "flow", "character", "aspect_groups", "outputs"],
    "spec"
  );
  if (spec.version !== 3) fail("INVALID_V3_SPEC", "spec.version must be 3");
  if (
    manifest.version !== 3 ||
    Object.keys(manifest).length !== 2 ||
    !Object.hasOwn(manifest, "identity")
  ) {
    fail("BLOCKED_CHARACTER_ASSET", "IP manifest must use identity-only version 3");
  }
  safeId(spec.run_id, "run_id");
  exactKeys(spec.source, ["article_path", "article_sha256"], "source");
  if (spec.source.article_path !== `runs/${spec.run_id}/article.md`) {
    fail("INVALID_V3_SPEC", `source.article_path must equal runs/${spec.run_id}/article.md`);
  }
  if (!HEX_64.test(spec.source.article_sha256)) {
    fail("INVALID_V3_SPEC", "source.article_sha256 must be 64 lowercase hex");
  }
  if (spec.profile_id !== "lux-whiteboard") fail("INVALID_V3_SPEC", `unknown profile_id: ${spec.profile_id}`);
  validateTitle(spec.title, config);
  exactKeys(spec.core_concept, ["summary", "metaphor_id"], "core_concept");
  text(spec.core_concept.summary, "core_concept.summary");
  if (!config.diagram.metaphor_ids.includes(spec.core_concept.metaphor_id)) {
    fail("INVALID_V3_SPEC", `unknown metaphor_id: ${spec.core_concept.metaphor_id}`);
  }
  validateFlow(spec.flow, config);
  exactKeys(spec.character, ["identity_id", "pose_id", "pose_intent"], "character");
  if (spec.character.identity_id !== manifest.identity?.id || manifest.identity.reviewed !== true) {
    fail("BLOCKED_CHARACTER_ASSET", "character identity must match the reviewed IP manifest");
  }
  if (
    !Array.isArray(manifest.identity.core_traits) ||
    manifest.identity.core_traits.length === 0 ||
    manifest.identity.core_traits.some((trait) => typeof trait !== "string" || !trait.trim())
  ) {
    fail("BLOCKED_CHARACTER_ASSET", "character identity core_traits are incomplete");
  }
  safeId(spec.character.pose_id, "character.pose_id");
  text(spec.character.pose_intent, "character.pose_intent");
  if (!Array.isArray(spec.outputs) || spec.outputs.length < 1 || spec.outputs.length > config.limits.max_outputs) {
    fail("INVALID_V3_SPEC", `outputs must contain 1 to ${config.limits.max_outputs} entries`);
  }
  const outputIds = new Set();
  for (const [index, output] of spec.outputs.entries()) {
    exactKeys(
      output,
      ["id", "platform_id", "width", "height", "aspect_group_id", "adaptation"],
      `outputs[${index}]`
    );
    safeId(output.id, `outputs[${index}].id`);
    safeId(output.platform_id, `outputs[${index}].platform_id`);
    safeId(output.aspect_group_id, `outputs[${index}].aspect_group_id`);
    if (!platforms.presets[output.platform_id]) {
      fail("INVALID_V3_SPEC", `unknown platform_id: ${output.platform_id}`);
    }
    if (outputIds.has(output.id)) fail("INVALID_V3_SPEC", `duplicate output id: ${output.id}`);
    outputIds.add(output.id);
    validateDimensions(output, `outputs[${index}]`, config);
    validateAdaptation(output.adaptation, spec.run_id, `outputs[${index}].adaptation`);
  }
  if (!Array.isArray(spec.aspect_groups) || spec.aspect_groups.length < 1) {
    fail("INVALID_V3_SPEC", "aspect_groups must contain at least one group");
  }
  const groupIds = new Set();
  for (const [index, group] of spec.aspect_groups.entries()) {
    const groupLabel = `aspect_groups[${index}]`;
    const hasSemanticCore = Object.hasOwn(group, "semantic_core");
    exactKeys(
      group,
      hasSemanticCore ? ["id", "master_output_id", "semantic_core"] : ["id", "master_output_id"],
      groupLabel
    );
    safeId(group.id, `aspect_groups[${index}].id`);
    safeId(group.master_output_id, `aspect_groups[${index}].master_output_id`);
    if (hasSemanticCore) {
      exactKeys(group.semantic_core, ["width", "height"], `${groupLabel}.semantic_core`);
      validateDimensions(group.semantic_core, `${groupLabel}.semantic_core`, config);
    }
    if (groupIds.has(group.id)) fail("INVALID_V3_SPEC", `duplicate aspect group id: ${group.id}`);
    groupIds.add(group.id);
    const outputs = spec.outputs.filter((output) => output.aspect_group_id === group.id);
    const master = outputs.find((output) => output.id === group.master_output_id);
    if (!master) fail("INVALID_V3_SPEC", `${group.id}.master_output_id must reference an output in that group`);
    const sharedOutputs = outputs.filter((output) => output.adaptation.mode === "shared-crop-core");
    if (hasSemanticCore && sharedOutputs.length !== outputs.length) {
      fail("INVALID_V3_SPEC", `${group.id} semantic_core requires every group output to use shared-crop-core`);
    }
    if (
      hasSemanticCore &&
      sharedOutputs.some((output) => !sameSharedCropContract(sharedOutputs[0].adaptation, output.adaptation))
    ) {
      fail("INVALID_V3_SPEC", `${group.id} outputs must share exactly the same crop contract`);
    }
    if (!hasSemanticCore && sharedOutputs.length > 0) {
      fail("INVALID_V3_SPEC", `${group.id} shared-crop-core requires semantic_core dimensions`);
    }
    for (const output of outputs) {
      if (!ratiosEqual(master, output)) {
        fail("INVALID_V3_SPEC", `${group.id} outputs must use exactly the same aspect ratio`);
      }
    }
  }
  for (const output of spec.outputs) {
    if (!groupIds.has(output.aspect_group_id)) {
      fail("INVALID_V3_SPEC", `${output.id} references an unknown aspect_group_id`);
    }
  }
}

function within(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function readApprovedReview(filePath, expected) {
  let review;
  try {
    review = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      fail("WAITING_FOR_USER", `${expected.checkpoint} review is required`);
    }
    fail("INVALID_REVIEW", `review could not be read: ${error.message}`);
  }
  exactKeys(review, ["version", "checkpoint", "status", "subject", "reviewed_at", "notes"], "review");
  if (review.version !== 1 || review.checkpoint !== expected.checkpoint || review.status !== "approved") {
    fail("WAITING_FOR_USER", `${expected.checkpoint} is not approved`);
  }
  exactKeys(review.subject, ["path", "sha256"], "review.subject");
  if (review.subject.path !== expected.subjectPath || review.subject.sha256 !== expected.subjectSha256) {
    fail("STALE_REVIEW", `${expected.checkpoint} does not match the current artifact`);
  }
  text(review.reviewed_at, "review.reviewed_at");
  text(review.notes, "review.notes");
  return review;
}

export function validateAiReview(review, spec, manifest) {
  exactKeys(
    review,
    ["version", "status", "title_expected", "title_observed", "title_exact", "extra_text", "identity", "pose", "flow", "style", "defects"],
    "ai-review"
  );
  if (review.version !== 1 || review.status !== "passed") fail("WAITING_FOR_USER", "AI cover review has not passed");
  const expectedTitle = titleTextLines(spec.title);
  stringArray(review.title_expected, "ai-review.title_expected");
  stringArray(review.title_observed, "ai-review.title_observed");
  if (
    !sameValues(review.title_expected, expectedTitle) ||
    !sameValues(review.title_observed, expectedTitle) ||
    review.title_exact !== true
  ) {
    fail("WAITING_FOR_USER", "AI review did not read the exact approved title");
  }
  if (!Array.isArray(review.extra_text) || review.extra_text.length !== 0) {
    fail("WAITING_FOR_USER", "AI review found extra text");
  }
  exactKeys(review.identity, ["status", "checked_traits"], "ai-review.identity");
  if (review.identity.status !== "passed" || !Array.isArray(review.identity.checked_traits)) {
    fail("WAITING_FOR_USER", "AI identity review has not passed");
  }
  for (const trait of manifest.identity.core_traits) {
    if (!review.identity.checked_traits.includes(trait)) fail("WAITING_FOR_USER", `AI identity review omitted ${trait}`);
  }
  exactKeys(review.pose, ["status", "pose_id", "intent_observed"], "ai-review.pose");
  if (review.pose.status !== "passed" || review.pose.pose_id !== spec.character.pose_id || review.pose.intent_observed !== true) {
    fail("WAITING_FOR_USER", "AI pose review has not passed");
  }
  exactKeys(review.flow, ["status", "item_ids"], "ai-review.flow");
  if (
    review.flow.status !== "passed" ||
    !sameValues(review.flow.item_ids, spec.flow.items.map((item) => item.id))
  ) {
    fail("WAITING_FOR_USER", "AI flow review has not passed");
  }
  exactKeys(review.style, ["status", "profile_id"], "ai-review.style");
  if (review.style.status !== "passed" || review.style.profile_id !== spec.profile_id) {
    fail("WAITING_FOR_USER", "AI style review has not passed");
  }
  if (!Array.isArray(review.defects) || review.defects.length !== 0) {
    fail("WAITING_FOR_USER", "AI review still reports cover defects");
  }
}

export async function resolveV3ProjectInputs(spec, projectRoot, runtime) {
  const { config, platforms, ipManifest } = runtime;
  validateV3SpecShape(spec, config, platforms, ipManifest);
  const runsRoot = await realpath(path.join(projectRoot, "runs"));
  const runDir = await realpath(path.join(runsRoot, spec.run_id));
  const articlePath = await realpath(path.join(projectRoot, spec.source.article_path));
  if (!within(articlePath, runDir)) fail("INVALID_PATH", "article_path escapes the run directory");
  if (await sha256File(articlePath) !== spec.source.article_sha256) {
    fail("INVALID_V3_SPEC", "article SHA-256 does not match");
  }
  for (const name of ["content-plan-prompt.md", "content-card.md"]) {
    const content = await readFile(path.join(runDir, name), "utf8").catch(() => "");
    if (!content.trim()) fail("BLOCKED_INPUT", `${name} is required`);
  }
  const contentCardPath = path.join(runDir, "content-card.md");
  await readApprovedReview(path.join(runDir, "reviews", "content-card.json"), {
    checkpoint: "content-card-review",
    subjectPath: path.relative(projectRoot, contentCardPath),
    subjectSha256: await sha256File(contentCardPath)
  });
  const assetsRoot = await realpath(path.join(projectRoot, "skills/lux-cover/assets"));
  const identityPath = await realpath(path.join(assetsRoot, ipManifest.identity.file));
  if (!within(identityPath, path.join(assetsRoot, "ip"))) fail("INVALID_PATH", "identity asset escapes assets/ip");
  if (await sha256File(identityPath) !== ipManifest.identity.sha256) {
    fail("BLOCKED_CHARACTER_ASSET", "identity reference SHA-256 does not match");
  }
  await validateTransparentPng(identityPath, config, "identity reference");
  return { runDir, articlePath, identityPath };
}

export async function readV3Spec(specPath) {
  const spec = await readJson(specPath, "V3 cover spec");
  if (spec.version !== 3) fail("INVALID_V3_SPEC", "V3 command requires spec.version 3");
  return spec;
}
