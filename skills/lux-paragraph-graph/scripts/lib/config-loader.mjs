import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { loadRuntimeConfig as loadCoverRuntime } from "../../../lux-cover/scripts/lib/config-loader.mjs";
import { CoverError } from "../../../lux-cover/scripts/lib/spec-validator.mjs";

function fail(message) {
  throw new CoverError("INVALID_GRAPH_CONFIG", message);
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label} must be an object`);
}

function exactKeys(value, allowed, label) {
  object(value, label);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  const missing = allowed.filter((key) => !(key in value));
  if (unknown.length) fail(`${label} has unknown field(s): ${unknown.join(", ")}`);
  if (missing.length) fail(`${label} is missing field(s): ${missing.join(", ")}`);
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    fail(`${label} could not be read as JSON: ${error.message}`);
  }
}

async function readYaml(filePath, label) {
  try {
    return YAML.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    fail(`${label} could not be read as YAML: ${error.message}`);
  }
}

function within(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function validateVocabulary(vocabulary) {
  exactKeys(vocabulary, ["version", "visual_types", "icon_ids", "pose_ids", "symbol_ids"], "visual vocabulary");
  if (vocabulary.version !== 1) fail("visual vocabulary must use version 1");
  object(vocabulary.visual_types, "visual_types");
  const expectedTypes = ["flow", "timeline", "decision-map", "comparison", "concept-diagram"];
  if (
    Object.keys(vocabulary.visual_types).length !== expectedTypes.length ||
    expectedTypes.some((type) => !(type in vocabulary.visual_types))
  ) {
    fail("visual vocabulary must define exactly the five approved visual types");
  }
  for (const [type, entry] of Object.entries(vocabulary.visual_types)) {
    exactKeys(entry, ["roles", "min_elements", "max_elements"], `visual_types.${type}`);
    if (
      !Array.isArray(entry.roles) ||
      entry.roles.length === 0 ||
      !Number.isInteger(entry.min_elements) ||
      !Number.isInteger(entry.max_elements) ||
      entry.min_elements < 1 ||
      entry.max_elements < entry.min_elements
    ) {
      fail(`visual_types.${type} has invalid roles or element limits`);
    }
  }
  for (const field of ["icon_ids", "pose_ids", "symbol_ids"]) {
    if (
      !Array.isArray(vocabulary[field]) ||
      vocabulary[field].length === 0 ||
      new Set(vocabulary[field]).size !== vocabulary[field].length
    ) {
      fail(`${field} must be a non-empty unique list`);
    }
  }
}

export async function loadGraphRuntime(projectRoot, graphRoot) {
  const runtimePath = path.join(graphRoot, "assets", "runtime.json");
  const runtimeConfig = await readJson(runtimePath, "graph runtime config");
  exactKeys(
    runtimeConfig,
    ["version", "shared_visual_skill_root", "profile_overlay_path", "vocabulary_path", "limits"],
    "graph runtime config"
  );
  if (runtimeConfig.version !== 1) fail("graph runtime config must use version 1");
  exactKeys(
    runtimeConfig.limits,
    ["graph_attempt_limit", "max_required_text_entries", "max_secondary_texts_per_element"],
    "graph runtime limits"
  );
  for (const [key, value] of Object.entries(runtimeConfig.limits)) {
    if (!Number.isInteger(value) || value < 1) fail(`runtime limit ${key} must be a positive integer`);
  }

  const sharedRoot = await realpath(path.join(projectRoot, runtimeConfig.shared_visual_skill_root));
  if (!within(sharedRoot, projectRoot)) fail("shared visual skill root escapes the project");
  const shared = await loadCoverRuntime(sharedRoot);
  const overlayPath = await realpath(path.join(graphRoot, runtimeConfig.profile_overlay_path));
  const vocabularyPath = await realpath(path.join(graphRoot, runtimeConfig.vocabulary_path));
  if (!within(overlayPath, graphRoot) || !within(vocabularyPath, graphRoot)) {
    fail("graph profile or vocabulary escapes the graph skill");
  }
  const [profileOverlay, vocabulary] = await Promise.all([
    readYaml(overlayPath, "paragraph profile overlay"),
    readYaml(vocabularyPath, "visual vocabulary")
  ]);
  exactKeys(profileOverlay, ["version", "id", "extends", "composition", "imagegen"], "paragraph profile overlay");
  if (profileOverlay.version !== 1 || profileOverlay.id !== "lux-whiteboard-paragraph") {
    fail("paragraph profile overlay must be lux-whiteboard-paragraph version 1");
  }
  exactKeys(profileOverlay.extends, ["id", "path"], "paragraph profile overlay extends");
  const baseProfilePath = await realpath(path.join(projectRoot, profileOverlay.extends.path));
  const expectedBaseProfile = await realpath(path.join(sharedRoot, shared.config.profile_path));
  if (
    profileOverlay.extends.id !== shared.profile.id ||
    baseProfilePath !== expectedBaseProfile
  ) {
    fail("paragraph profile overlay must extend the configured shared base profile");
  }
  if (
    profileOverlay.composition?.outer_border !== false ||
    profileOverlay.composition?.full_cover_layout !== false ||
    profileOverlay.imagegen?.mode !== "complete-paragraph-graph" ||
    profileOverlay.imagegen?.allow_code_text_overlay !== false ||
    profileOverlay.imagegen?.allow_extra_text !== false
  ) {
    fail("paragraph profile overlay is missing approved composition or imagegen rules");
  }
  validateVocabulary(vocabulary);

  const identityPath = await realpath(path.join(sharedRoot, "assets", shared.ipManifest.identity.file));
  const stylePath = await realpath(path.join(sharedRoot, shared.profile.references.primary));
  if (!within(identityPath, sharedRoot) || !within(stylePath, sharedRoot)) {
    fail("shared identity or style reference escapes the shared skill");
  }
  return {
    runtimeConfig,
    profileOverlay,
    vocabulary,
    shared,
    sharedRoot,
    identityPath,
    stylePath,
    overlayPath,
    vocabularyPath
  };
}
