import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ── Error ────────────────────────────────────────────────────────────────

export class CoverError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "CoverError";
    this.code = code;
  }
}

export function fail(code, message) {
  throw new CoverError(code, message);
}

// ── Project root ─────────────────────────────────────────────────────────

/** Root of the lux-cover-generator project, resolved from this module. */
const _scriptDir = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(_scriptDir, "..", "..");

/**
 * Resolve the root of a skill directory from a script's import.meta.url.
 * @param {string} importMetaUrl — `import.meta.url` of the caller
 * @returns {string} absolute path to the skill root
 */
export function resolveSkillRoot(importMetaUrl, skillName) {
  const scriptDir = path.dirname(fileURLToPath(importMetaUrl));
  const root = path.resolve(scriptDir, "..", "..", "..");
  const skillRoot = path.join(root, "skills", skillName);
  return skillRoot;
}

// ── Type guards ──────────────────────────────────────────────────────────

export function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_CONFIG", `${label} must be an object`);
  }
}

export function exactKeys(value, allowed, label) {
  object(value, label);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  const missing = allowed.filter((key) => !(key in value));
  if (unknown.length) fail("INVALID_CONFIG", `${label} has unknown field(s): ${unknown.join(", ")}`);
  if (missing.length) fail("INVALID_CONFIG", `${label} is missing field(s): ${missing.join(", ")}`);
}

// ── Path safety ──────────────────────────────────────────────────────────

export function within(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

// ── Hashing ──────────────────────────────────────────────────────────────

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function sha256File(filePath) {
  return sha256(await readFile(filePath));
}

// ── ID / text validators ─────────────────────────────────────────────────

const SAFE_ID = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])$/;
const CONTROL_TEXT = /[\x00-\x1f\x7f]/;

export function safeId(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    fail("INVALID_SPEC", `${label} must be a lowercase hyphenated identifier`);
  }
}

export function text(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail("INVALID_SPEC", `${label} must be non-empty text`);
  }
  if (CONTROL_TEXT.test(value)) fail("INVALID_SPEC", `${label} contains a control character`);
}

export function stringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0) fail("INVALID_SPEC", `${label} must be a non-empty array`);
  value.forEach((entry, index) => text(entry, `${label}[${index}]`));
}

export function sameValues(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

// ── JSON reader ──────────────────────────────────────────────────────────

export async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    fail("INVALID_SPEC", `${label} could not be read as JSON: ${error.message}`);
  }
}

// ── Run ID generator ─────────────────────────────────────────────────────

/**
 * Generate a valid run ID for use with any skill's --run argument.
 * Format matches the SAFE_ID pattern: lowercase alphanumeric segments separated by hyphens.
 * @returns {string} e.g. "run-1a2b3c-4d5e"
 */
export function generateRunId() {
  const ts = Date.now().toString(36);
  const rand = randomUUID().split("-")[0];
  return `run-${ts}-${rand}`;
}
