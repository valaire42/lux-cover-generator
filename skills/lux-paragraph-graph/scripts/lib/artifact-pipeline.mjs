import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { atomicWrite } from "../../../lux-cover/scripts/lib/output-validator.mjs";
import {
  CoverError,
  sha256File
} from "../../../lux-cover/scripts/lib/spec-validator.mjs";
import { ratiosEqual, readApprovedReview } from "./spec-validator.mjs";

function fail(code, message) {
  throw new CoverError(code, message);
}

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_GRAPH_ARTIFACT", `${label} must be an object`);
  }
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  const missing = allowed.filter((key) => !(key in value));
  if (unknown.length) fail("INVALID_GRAPH_ARTIFACT", `${label} has unknown field(s): ${unknown.join(", ")}`);
  if (missing.length) fail("INVALID_GRAPH_ARTIFACT", `${label} is missing field(s): ${missing.join(", ")}`);
}

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function within(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function validateAttemptState(runDir, groupId, limit) {
  let state;
  try {
    state = JSON.parse(await readFile(path.join(runDir, "graph-attempts.json"), "utf8"));
  } catch (error) {
    fail("GRAPH_ATTEMPT_REQUIRED", `graph attempt guard must run before image generation: ${error.message}`);
  }
  const entry = state.issues?.[groupId];
  if (
    state.version !== 1 ||
    !entry ||
    !Number.isInteger(entry.attempts) ||
    entry.attempts < 1 ||
    entry.attempts > limit
  ) {
    fail("GRAPH_ATTEMPT_REQUIRED", `${groupId} has no valid guarded generation attempt`);
  }
  return entry.attempts;
}

async function validateReferences({ referencesPath, projectRoot, runDir, runtime }) {
  let references;
  try {
    references = JSON.parse(await readFile(referencesPath, "utf8"));
  } catch (error) {
    fail("INVALID_GRAPH_ARTIFACT", `references.json could not be read: ${error.message}`);
  }
  exactKeys(references, ["version", "generator", "references"], "references");
  if (
    references.version !== 1 ||
    references.generator !== "built-in-image_gen" ||
    !Array.isArray(references.references) ||
    references.references.length < 2
  ) {
    fail("INVALID_GRAPH_ARTIFACT", "references must identify built-in image_gen and at least two inputs");
  }
  const roles = new Set();
  for (const [index, reference] of references.references.entries()) {
    exactKeys(reference, ["role", "path", "sha256"], `references[${index}]`);
    if (roles.has(reference.role)) {
      fail("INVALID_GRAPH_ARTIFACT", `duplicate reference role: ${reference.role}`);
    }
    roles.add(reference.role);
    if (typeof reference.path !== "string" || path.isAbsolute(reference.path)) {
      fail("INVALID_PATH", `references[${index}].path must be project-relative`);
    }
    const absolute = await realpath(path.join(projectRoot, reference.path));
    if (!within(absolute, projectRoot) || await sha256File(absolute) !== reference.sha256) {
      fail("INVALID_GRAPH_ARTIFACT", `reference path or hash is invalid: ${reference.role}`);
    }
  }
  const identity = references.references.find((entry) => entry.role === "mandatory-identity-reference");
  const style = references.references.find((entry) => entry.role === "primary-style-authority");
  const expectedIdentity = path.relative(projectRoot, runtime.identityPath);
  const expectedStyle = path.relative(projectRoot, runtime.stylePath);
  if (
    identity?.path !== expectedIdentity ||
    identity.sha256 !== runtime.shared.ipManifest.identity.sha256
  ) {
    fail("INVALID_GRAPH_ARTIFACT", "mandatory identity reference does not match the shared IP asset");
  }
  if (
    style?.path !== expectedStyle ||
    style.sha256 !== await sha256File(runtime.stylePath)
  ) {
    fail("INVALID_GRAPH_ARTIFACT", "primary style reference does not match the shared visual profile");
  }
  const approved = references.references.find(
    (entry) => entry.role === "approved-paragraph-master-reference"
  );
  if (approved) {
    const masterPath = await realpath(path.join(projectRoot, approved.path));
    const parts = path.relative(runDir, masterPath).split(path.sep);
    if (
      parts.length !== 3 ||
      parts[0] !== "aspect-groups" ||
      parts[2] !== "master.png" ||
      parts.some((part) => part === "..")
    ) {
      fail("INVALID_GRAPH_ARTIFACT", "approved paragraph master must belong to the current run");
    }
    await readApprovedReview(path.join(path.dirname(masterPath), "user-review.json"), {
      checkpoint: "full-graph-review",
      subjectPath: approved.path,
      subjectSha256: approved.sha256
    });
  }
  return { sha256: await sha256File(referencesPath) };
}

export async function registerGraphMaster({
  sourcePath,
  projectRoot,
  runDir,
  group,
  masterOutput,
  runtime
}) {
  const groupDir = path.join(runDir, "aspect-groups", group.id);
  const promptPath = path.join(groupDir, "prompt.md");
  const referencesPath = path.join(groupDir, "references.json");
  const prompt = await readFile(promptPath, "utf8").catch(() => "");
  if (!prompt.trim()) fail("INVALID_GRAPH_ARTIFACT", `${group.id}/prompt.md is required`);
  const references = await validateReferences({
    referencesPath,
    projectRoot,
    runDir,
    runtime
  });
  const attempt = await validateAttemptState(
    runDir,
    group.id,
    runtime.runtimeConfig.limits.graph_attempt_limit
  );
  const source = await readFile(sourcePath);
  const rawImage = sharp(source, {
    limitInputPixels: runtime.shared.config.limits.max_input_pixels
  });
  const rawMeta = await rawImage.metadata();
  if (rawMeta.format !== "png" || !rawMeta.width || !rawMeta.height) {
    fail("INVALID_GRAPH_ARTIFACT", "image_gen artifact must be a valid PNG");
  }
  const rawRatio = rawMeta.width / rawMeta.height;
  const targetRatio = masterOutput.width / masterOutput.height;
  const ratioError = Math.abs(rawRatio - targetRatio) / targetRatio;
  if (ratioError > runtime.shared.config.v3.max_raw_ratio_relative_error) {
    fail("INVALID_GRAPH_ARTIFACT", `raw image aspect ratio drift ${ratioError.toFixed(4)} exceeds the limit`);
  }
  const master = await sharp(source, {
    limitInputPixels: runtime.shared.config.limits.max_input_pixels
  })
    .resize({
      width: masterOutput.width,
      height: masterOutput.height,
      fit: "cover",
      position: "centre"
    })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
  const scale = Math.max(masterOutput.width / rawMeta.width, masterOutput.height / rawMeta.height);
  const scaledWidth = rawMeta.width * scale;
  const scaledHeight = rawMeta.height * scale;
  const rawSha256 = sha256Buffer(source);
  const masterSha256 = sha256Buffer(master);
  const rawRelative = path.relative(projectRoot, path.join(groupDir, "raw.png"));
  const masterRelative = path.relative(projectRoot, path.join(groupDir, "master.png"));
  const attemptDir = path.join(groupDir, "attempts", `attempt-${attempt}`);
  try {
    await lstat(attemptDir);
    fail("GRAPH_MASTER_ATTEMPT_EXISTS", `${group.id} attempt-${attempt} is already registered`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const artifact = {
    version: 1,
    group_id: group.id,
    master_output_id: masterOutput.id,
    attempt,
    generator: "built-in-image_gen",
    source_artifact: {
      path: path.isAbsolute(sourcePath) ? sourcePath : path.relative(projectRoot, sourcePath),
      sha256: rawSha256
    },
    prompt: {
      path: path.relative(projectRoot, promptPath),
      sha256: await sha256File(promptPath)
    },
    references: {
      path: path.relative(projectRoot, referencesPath),
      sha256: references.sha256
    },
    raw: {
      path: rawRelative,
      width: rawMeta.width,
      height: rawMeta.height,
      sha256: rawSha256
    },
    master: {
      path: masterRelative,
      width: masterOutput.width,
      height: masterOutput.height,
      sha256: masterSha256
    },
    normalization: {
      method: "aspect-preserving-cover-centre",
      scale_x: scale,
      scale_y: scale,
      crop: {
        left: Math.max(0, (scaledWidth - masterOutput.width) / 2),
        top: Math.max(0, (scaledHeight - masterOutput.height) / 2),
        width: masterOutput.width,
        height: masterOutput.height
      },
      direct_stretch: false
    }
  };
  const snapshot = structuredClone(artifact);
  snapshot.prompt.path = path.relative(projectRoot, path.join(attemptDir, "prompt.md"));
  snapshot.references.path = path.relative(projectRoot, path.join(attemptDir, "references.json"));
  snapshot.raw.path = path.relative(projectRoot, path.join(attemptDir, "raw.png"));
  snapshot.master.path = path.relative(projectRoot, path.join(attemptDir, "master.png"));
  await Promise.all([
    atomicWrite(path.join(attemptDir, "prompt.md"), prompt),
    atomicWrite(path.join(attemptDir, "references.json"), await readFile(referencesPath)),
    atomicWrite(path.join(attemptDir, "raw.png"), source),
    atomicWrite(path.join(attemptDir, "master.png"), master),
    atomicWrite(path.join(attemptDir, "artifact.json"), `${JSON.stringify(snapshot, null, 2)}\n`),
    atomicWrite(path.join(groupDir, "raw.png"), source),
    atomicWrite(path.join(groupDir, "master.png"), master),
    atomicWrite(path.join(groupDir, "artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`)
  ]);
  return { artifact, masterBuffer: master };
}

export async function loadRegisteredGraphMaster({ projectRoot, runDir, group, masterOutput }) {
  const groupDir = await realpath(path.join(runDir, "aspect-groups", group.id));
  let artifact;
  try {
    artifact = JSON.parse(await readFile(path.join(groupDir, "artifact.json"), "utf8"));
  } catch (error) {
    fail("INVALID_GRAPH_ARTIFACT", `${group.id} artifact could not be read: ${error.message}`);
  }
  if (
    artifact.version !== 1 ||
    artifact.group_id !== group.id ||
    artifact.master_output_id !== masterOutput.id ||
    artifact.generator !== "built-in-image_gen"
  ) {
    fail("INVALID_GRAPH_ARTIFACT", `${group.id} artifact is not wired to the current spec`);
  }
  const rawPath = await realpath(path.join(projectRoot, artifact.raw.path));
  const masterPath = await realpath(path.join(projectRoot, artifact.master.path));
  if (!within(rawPath, groupDir) || !within(masterPath, groupDir)) {
    fail("INVALID_PATH", `${group.id} raw or master escapes its group`);
  }
  if (
    await sha256File(rawPath) !== artifact.raw.sha256 ||
    await sha256File(masterPath) !== artifact.master.sha256
  ) {
    fail("INVALID_GRAPH_ARTIFACT", `${group.id} raw or master hash changed`);
  }
  const metadata = await sharp(masterPath).metadata();
  if (
    metadata.format !== "png" ||
    metadata.width !== masterOutput.width ||
    metadata.height !== masterOutput.height ||
    artifact.normalization.scale_x !== artifact.normalization.scale_y ||
    artifact.normalization.direct_stretch !== false
  ) {
    fail("INVALID_GRAPH_ARTIFACT", `${group.id} master metadata or transform is invalid`);
  }
  return {
    groupDir,
    artifact,
    artifactPath: path.join(groupDir, "artifact.json"),
    masterPath,
    masterBuffer: await readFile(masterPath)
  };
}

export async function renderGraphOutput(masterBuffer, output) {
  const metadata = await sharp(masterBuffer).metadata();
  if (
    metadata.format !== "png" ||
    !metadata.width ||
    !metadata.height ||
    !ratiosEqual(metadata, output)
  ) {
    fail("GRAPH_OUTPUT_VALIDATION_FAILED", `${output.id} ratio differs from its approved master`);
  }
  const rendered = await sharp(masterBuffer)
    .resize({ width: output.width, height: output.height, fit: "inside" })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer({ resolveWithObject: true });
  if (rendered.info.width !== output.width || rendered.info.height !== output.height) {
    fail("GRAPH_OUTPUT_VALIDATION_FAILED", `${output.id} did not fill its exact target size`);
  }
  const scale = output.width / metadata.width;
  return {
    buffer: rendered.data,
    transform: {
      scale_x: scale,
      scale_y: scale,
      direct_stretch: false
    }
  };
}
