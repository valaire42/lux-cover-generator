import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { atomicWrite } from "./output-validator.mjs";
import { CoverError, sha256File } from "./spec-validator.mjs";
import { readApprovedReview } from "./v3-spec-validator.mjs";

function fail(code, message) {
  throw new CoverError(code, message);
}

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_MASTER_ARTIFACT", `${label} must be an object`);
  }
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  const missing = allowed.filter((key) => !(key in value));
  if (unknown.length) fail("INVALID_MASTER_ARTIFACT", `${label} has unknown field(s): ${unknown.join(", ")}`);
  if (missing.length) fail("INVALID_MASTER_ARTIFACT", `${label} is missing field(s): ${missing.join(", ")}`);
}

function sha256Buffer(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function within(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function masterDimensions(group, masterOutput) {
  return group.semantic_core ?? masterOutput;
}

async function validateAttemptState(runDir, groupId, limit) {
  let state;
  try {
    state = JSON.parse(await readFile(path.join(runDir, "cover-attempts.json"), "utf8"));
  } catch (error) {
    fail("COVER_ATTEMPT_REQUIRED", `cover attempt guard must run before image generation: ${error.message}`);
  }
  const entry = state.issues?.[groupId];
  if (
    state.version !== 1 ||
    !entry ||
    !Number.isInteger(entry.attempts) ||
    entry.attempts < 1 ||
    entry.attempts > limit
  ) {
    fail("COVER_ATTEMPT_REQUIRED", `${groupId} has no valid guarded generation attempt`);
  }
  return entry.attempts;
}

async function validateReferences({ referencesPath, projectRoot, skillRoot, profile, manifest }) {
  let references;
  try {
    references = JSON.parse(await readFile(referencesPath, "utf8"));
  } catch (error) {
    fail("INVALID_MASTER_ARTIFACT", `references.json could not be read: ${error.message}`);
  }
  exactKeys(references, ["version", "generator", "references"], "references");
  if (
    references.version !== 1 ||
    references.generator !== "built-in-image_gen" ||
    !Array.isArray(references.references) ||
    references.references.length < 2
  ) {
    fail("INVALID_MASTER_ARTIFACT", "references must identify built-in image_gen and at least two inputs");
  }
  const seen = new Set();
  for (const [index, reference] of references.references.entries()) {
    exactKeys(reference, ["role", "path", "sha256"], `references[${index}]`);
    if (seen.has(reference.role)) fail("INVALID_MASTER_ARTIFACT", `duplicate reference role: ${reference.role}`);
    seen.add(reference.role);
    if (typeof reference.path !== "string" || path.isAbsolute(reference.path)) {
      fail("INVALID_PATH", `references[${index}].path must be project-relative`);
    }
    const absolute = await realpath(path.join(projectRoot, reference.path));
    if (!within(absolute, projectRoot) || await sha256File(absolute) !== reference.sha256) {
      fail("INVALID_MASTER_ARTIFACT", `reference hash or path is invalid: ${reference.role}`);
    }
  }
  const identity = references.references.find((entry) => entry.role === "mandatory-identity-reference");
  const style = references.references.find((entry) => entry.role === "primary-style-authority");
  const expectedIdentity = path.relative(projectRoot, path.join(skillRoot, "assets", manifest.identity.file));
  const expectedStyle = path.relative(projectRoot, path.join(skillRoot, profile.references.primary));
  if (identity?.path !== expectedIdentity || identity.sha256 !== manifest.identity.sha256) {
    fail("INVALID_MASTER_ARTIFACT", "mandatory identity reference does not match the formal IP asset");
  }
  if (style?.path !== expectedStyle || style.sha256 !== await sha256File(path.join(projectRoot, expectedStyle))) {
    fail("INVALID_MASTER_ARTIFACT", "primary style reference does not match the visual profile");
  }
  const approvedMaster = references.references.find((entry) => entry.role === "approved-master-cover-reference");
  if (approvedMaster) {
    const masterPath = await realpath(path.join(projectRoot, approvedMaster.path));
    const parts = path.relative(path.join(projectRoot, "runs"), masterPath).split(path.sep);
    if (
      parts.length !== 4 ||
      parts[1] !== "aspect-groups" ||
      parts[3] !== "master.png" ||
      parts.some((part) => part === "..")
    ) {
      fail("INVALID_MASTER_ARTIFACT", "approved master reference must use a canonical V3 aspect-group master path");
    }
    await readApprovedReview(path.join(path.dirname(masterPath), "user-review.json"), {
      checkpoint: "full-cover-review",
      subjectPath: approvedMaster.path,
      subjectSha256: approvedMaster.sha256
    });
  }
  return { references, sha256: await sha256File(referencesPath) };
}

export async function registerMasterArtifact({
  sourcePath,
  projectRoot,
  skillRoot,
  runDir,
  group,
  masterOutput,
  runtime
}) {
  const { config, profile, ipManifest } = runtime;
  const groupDir = path.join(runDir, "aspect-groups", group.id);
  const promptPath = path.join(groupDir, "prompt.md");
  const referencesPath = path.join(groupDir, "references.json");
  const prompt = await readFile(promptPath, "utf8").catch(() => "");
  if (!prompt.trim()) fail("INVALID_MASTER_ARTIFACT", `${group.id}/prompt.md is required`);
  const references = await validateReferences({
    referencesPath,
    projectRoot,
    skillRoot,
    profile,
    manifest: ipManifest
  });
  const attempt = await validateAttemptState(runDir, group.id, config.limits.cover_attempt_limit);
  const source = await readFile(sourcePath);
  const rawImage = sharp(source, { limitInputPixels: config.limits.max_input_pixels });
  const rawMeta = await rawImage.metadata();
  if (rawMeta.format !== "png" || !rawMeta.width || !rawMeta.height) {
    fail("INVALID_MASTER_ARTIFACT", "image_gen artifact must be a valid PNG");
  }
  const target = masterDimensions(group, masterOutput);
  const rawRatio = rawMeta.width / rawMeta.height;
  const targetRatio = target.width / target.height;
  const ratioError = Math.abs(rawRatio - targetRatio) / targetRatio;
  if (ratioError > config.v3.max_raw_ratio_relative_error) {
    fail("INVALID_MASTER_ARTIFACT", `raw image aspect ratio drift ${ratioError.toFixed(4)} exceeds configured limit`);
  }
  const master = await sharp(source, { limitInputPixels: config.limits.max_input_pixels })
    .resize({
      width: target.width,
      height: target.height,
      fit: "cover",
      position: "centre"
    })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
  const scale = Math.max(target.width / rawMeta.width, target.height / rawMeta.height);
  const scaledWidth = rawMeta.width * scale;
  const scaledHeight = rawMeta.height * scale;
  const rawSha256 = await sha256Buffer(source);
  const masterSha256 = await sha256Buffer(master);
  const rawRelative = path.relative(projectRoot, path.join(groupDir, "raw.png"));
  const masterRelative = path.relative(projectRoot, path.join(groupDir, "master.png"));
  const attemptDir = path.join(groupDir, "attempts", `attempt-${attempt}`);
  try {
    await lstat(attemptDir);
    fail("MASTER_ATTEMPT_EXISTS", `${group.id} attempt-${attempt} is already registered`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const artifact = {
    version: 3,
    group_id: group.id,
    master_output_id: masterOutput.id,
    master_kind: group.semantic_core ? "semantic-core" : "output-cover",
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
      width: target.width,
      height: target.height,
      sha256: masterSha256
    },
    normalization: {
      method: "aspect-preserving-cover-centre",
      scale_x: scale,
      scale_y: scale,
      crop: {
        left: Math.max(0, (scaledWidth - target.width) / 2),
        top: Math.max(0, (scaledHeight - target.height) / 2),
        width: target.width,
        height: target.height
      },
      direct_stretch: false
    }
  };
  const attemptArtifact = structuredClone(artifact);
  attemptArtifact.prompt.path = path.relative(projectRoot, path.join(attemptDir, "prompt.md"));
  attemptArtifact.references.path = path.relative(projectRoot, path.join(attemptDir, "references.json"));
  attemptArtifact.raw.path = path.relative(projectRoot, path.join(attemptDir, "raw.png"));
  attemptArtifact.master.path = path.relative(projectRoot, path.join(attemptDir, "master.png"));
  await Promise.all([
    atomicWrite(path.join(attemptDir, "prompt.md"), prompt),
    atomicWrite(path.join(attemptDir, "references.json"), await readFile(referencesPath)),
    atomicWrite(path.join(attemptDir, "raw.png"), source),
    atomicWrite(path.join(attemptDir, "master.png"), master),
    atomicWrite(path.join(attemptDir, "artifact.json"), `${JSON.stringify(attemptArtifact, null, 2)}\n`),
    atomicWrite(path.join(groupDir, "raw.png"), source),
    atomicWrite(path.join(groupDir, "master.png"), master),
    atomicWrite(path.join(groupDir, "artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`)
  ]);
  return { artifact, masterBuffer: master };
}

export async function loadRegisteredMaster({ projectRoot, runDir, group, masterOutput }) {
  const groupDir = path.join(runDir, "aspect-groups", group.id);
  let artifact;
  try {
    artifact = JSON.parse(await readFile(path.join(groupDir, "artifact.json"), "utf8"));
  } catch (error) {
    fail("INVALID_MASTER_ARTIFACT", `${group.id} artifact could not be read: ${error.message}`);
  }
  if (
    artifact.version !== 3 ||
    artifact.group_id !== group.id ||
    artifact.master_output_id !== masterOutput.id ||
    artifact.generator !== "built-in-image_gen"
  ) {
    fail("INVALID_MASTER_ARTIFACT", `${group.id} artifact is not wired to the current spec`);
  }
  const rawPath = await realpath(path.join(projectRoot, artifact.raw.path));
  const masterPath = await realpath(path.join(projectRoot, artifact.master.path));
  if (!within(rawPath, groupDir) || !within(masterPath, groupDir)) {
    fail("INVALID_PATH", `${group.id} master artifact escapes its group directory`);
  }
  if (
    await sha256File(rawPath) !== artifact.raw.sha256 ||
    await sha256File(masterPath) !== artifact.master.sha256
  ) {
    fail("INVALID_MASTER_ARTIFACT", `${group.id} raw or master hash changed`);
  }
  const masterMeta = await sharp(masterPath).metadata();
  const target = masterDimensions(group, masterOutput);
  const artifactKind = artifact.master_kind ?? "output-cover";
  if (
    masterMeta.format !== "png" ||
    masterMeta.width !== target.width ||
    masterMeta.height !== target.height ||
    artifact.master.width !== target.width ||
    artifact.master.height !== target.height ||
    artifactKind !== (group.semantic_core ? "semantic-core" : "output-cover") ||
    artifact.normalization.scale_x !== artifact.normalization.scale_y ||
    artifact.normalization.direct_stretch !== false
  ) {
    fail("INVALID_MASTER_ARTIFACT", `${group.id} master metadata or transform is invalid`);
  }
  return {
    groupDir,
    artifact,
    artifactPath: path.join(groupDir, "artifact.json"),
    masterPath,
    masterBuffer: await readFile(masterPath)
  };
}
