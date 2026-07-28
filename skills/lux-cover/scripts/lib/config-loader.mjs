import { access, readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { CoverError, object, readJson, fail } from "../../../lib/common.mjs";

async function readYaml(filePath, label) {
  try {
    return YAML.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    fail("INVALID_CONFIG", `${label} could not be read as YAML: ${error.message}`);
  }
}

async function resolveFont(config) {
  object(config.font, "font config");
  if (!Array.isArray(config.font.candidates) || config.font.candidates.length === 0) {
    throw new CoverError("INVALID_CONFIG", "font config must provide candidates");
  }
  for (const [index, candidate] of config.font.candidates.entries()) {
    object(candidate, `font candidate ${index}`);
    if (
      typeof candidate.family !== "string" ||
      !candidate.family.trim() ||
      typeof candidate.file !== "string" ||
      !candidate.file.trim()
    ) {
      throw new CoverError("INVALID_CONFIG", `font candidate ${index} is incomplete`);
    }
  }
  const overrideFile = process.env.LUX_FONT_FILE?.trim();
  if (overrideFile) {
    try {
      await access(overrideFile);
    } catch {
      throw new CoverError("BLOCKED_FONT", `LUX_FONT_FILE does not exist: ${overrideFile}`);
    }
    return {
      ...config,
      font: {
        ...config.font,
        family: process.env.LUX_FONT_FAMILY?.trim() || "sans-serif",
        file: overrideFile
      }
    };
  }
  for (const candidate of config.font.candidates) {
    try {
      await access(candidate.file);
      return { ...config, font: { ...config.font, ...candidate } };
    } catch {
      // Try the next configured platform font.
    }
  }
  throw new CoverError(
    "BLOCKED_FONT",
    `no configured Chinese font exists; set LUX_FONT_FILE and optional LUX_FONT_FAMILY`
  );
}

function validateConfig(config, profile, platforms, manifest) {
  if (config.version !== 3) throw new CoverError("INVALID_CONFIG", "renderer config must use version 3");
  if ("layouts" in config || "asset_attempt_limit" in config.limits) {
    throw new CoverError("INVALID_CONFIG", "renderer config still contains retired V2 fields");
  }
  object(profile.colors, "profile colors");
  if (profile.id !== "lux-whiteboard" || profile.version !== 1) {
    throw new CoverError("INVALID_CONFIG", "visual profile must be lux-whiteboard version 1");
  }
  if (!Array.isArray(profile.allowed_colors) || profile.allowed_colors.length < 4) {
    throw new CoverError("INVALID_CONFIG", "visual profile allowed_colors is incomplete");
  }
  object(platforms.presets, "platform presets");
  if (platforms.version !== 1) {
    throw new CoverError("INVALID_CONFIG", "platform presets must use version 1");
  }
  for (const [id, preset] of Object.entries(platforms.presets)) {
    if ("safe_area" in preset || "preview_crop" in preset) {
      throw new CoverError("INVALID_CONFIG", `${id} contains a retired inferred safe area`);
    }
  }
  const manifestKeys = Object.keys(manifest);
  if (
    manifest.version !== 3 ||
    manifest.identity?.id !== "lux" ||
    manifestKeys.length !== 2 ||
    !manifestKeys.includes("version") ||
    !manifestKeys.includes("identity")
  ) {
    throw new CoverError("INVALID_CONFIG", "IP manifest must use identity-only version 3");
  }
}

export async function loadRuntimeConfig(skillRoot) {
  const configPath = path.join(skillRoot, "assets/renderer.json");
  const config = await resolveFont(await readJson(configPath, "renderer config"));
  const [profile, platforms, ipManifest] = await Promise.all([
    readYaml(path.join(skillRoot, config.profile_path), "visual profile"),
    readYaml(path.join(skillRoot, config.platform_presets_path), "platform presets"),
    readJson(path.join(skillRoot, config.ip_manifest_path), "IP manifest")
  ]);
  validateConfig(config, profile, platforms, ipManifest);
  return { config, profile, platforms, ipManifest };
}
