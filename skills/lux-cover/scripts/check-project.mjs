#!/usr/bin/env node
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadRuntimeConfig } from "./lib/config-loader.mjs";
import { sha256File, validateTransparentPng } from "./lib/spec-validator.mjs";
import { renderFontProbe } from "./lib/text-layer.mjs";
import { loadGraphRuntime } from "../../lux-paragraph-graph/scripts/lib/config-loader.mjs";
import { projectRoot } from "./lib/common.mjs";

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  process.stdout.write("usage: check-project.mjs — 验证项目完整性和脚本语法\n");
  process.exit(0);
}

const required = [
  "package.json",
  "skills/lux-cover/SKILL.md",
  "skills/lux-cover/agents/openai.yaml",
  "skills/lux-cover/assets/renderer.json",
  "skills/lux-cover/assets/fonts.conf",
  "skills/lux-cover/assets/ip/lux.png",
  "skills/lux-cover/assets/ip/manifest.json",
  "skills/lux-cover/references/workflow.md",
  "skills/lux-cover/references/formats.md",
  "skills/lux-cover/references/visual-profiles/lux-whiteboard.yaml",
  "skills/lux-cover/references/platform-presets.yaml",
  "skills/lux-cover/references/prompt-templates/content-plan.md",
  "skills/lux-cover/references/prompt-templates/cover.md",
  "skills/lux-cover/references/quality-rubric.md",
  "skills/lux-cover/scripts/render-v3.mjs",
  "skills/lux-cover/scripts/register-master.mjs",
  "skills/lux-cover/scripts/guard-cover-attempt.mjs",
  "skills/lux-cover/scripts/validate-v3-run.mjs",
  "skills/lux-cover/scripts/lib/attempt-state.mjs",
  "skills/lux-cover/scripts/lib/config-loader.mjs",
  "skills/lux-cover/scripts/lib/contact-sheet.mjs",
  "skills/lux-cover/scripts/lib/output-validator.mjs",
  "skills/lux-cover/scripts/lib/spec-validator.mjs",
  "skills/lux-cover/scripts/lib/text-layer.mjs",
  "skills/lux-cover/scripts/lib/v3-spec-validator.mjs",
  "skills/lux-cover/scripts/lib/master-artifact.mjs",
  "skills/lux-cover/scripts/lib/platform-adapter.mjs",
  "skills/lux-cover/scripts/lib/whiteboard-svg.mjs",
  "skills/lux-paragraph-graph/SKILL.md",
  "skills/lux-paragraph-graph/agents/openai.yaml",
  "skills/lux-paragraph-graph/assets/runtime.json",
  "skills/lux-paragraph-graph/references/workflow.md",
  "skills/lux-paragraph-graph/references/formats.md",
  "skills/lux-paragraph-graph/references/visual-vocabulary.yaml",
  "skills/lux-paragraph-graph/references/visual-profiles/lux-whiteboard-paragraph.yaml",
  "skills/lux-paragraph-graph/references/prompt-templates/visual-plan.md",
  "skills/lux-paragraph-graph/references/prompt-templates/paragraph-graph.md",
  "skills/lux-paragraph-graph/references/quality-rubric.md",
  "skills/lux-paragraph-graph/scripts/guard-graph-attempt.mjs",
  "skills/lux-paragraph-graph/scripts/register-master.mjs",
  "skills/lux-paragraph-graph/scripts/render.mjs",
  "skills/lux-paragraph-graph/scripts/validate-run.mjs",
  "skills/lux-paragraph-graph/scripts/lib/config-loader.mjs",
  "skills/lux-paragraph-graph/scripts/lib/spec-validator.mjs",
  "skills/lux-paragraph-graph/scripts/lib/artifact-pipeline.mjs"
];

const retiredV2 = [
  "skills/lux-cover/assets/characters/manifest.json",
  "skills/lux-cover/assets/characters/presenting.png",
  "skills/lux-cover/assets/ip/poses/presenting/presenting-standard-v1.png",
  "skills/lux-cover/references/prompt-templates/character-pose.md",
  "skills/lux-cover/scripts/guard-asset-attempt.mjs",
  "skills/lux-cover/scripts/render.mjs",
  "skills/lux-cover/scripts/validate-character.mjs",
  "skills/lux-cover/scripts/validate-run.mjs",
  "skills/lux-cover/scripts/lib/crop-preview.mjs",
  "skills/lux-cover/scripts/lib/layout.mjs",
  "skills/lux-cover/scripts/lib/renderer.mjs"
];

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(absolute)));
    else files.push(absolute);
  }
  return files;
}

async function requireFiles() {
  for (const relative of required) {
    const stats = await lstat(path.join(projectRoot, relative));
    if (!stats.isFile()) throw new Error(`required file is missing: ${relative}`);
  }
}

async function rejectRetiredV2() {
  for (const relative of retiredV2) {
    try {
      await lstat(path.join(projectRoot, relative));
      throw new Error(`retired V2 file must not exist: ${relative}`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

async function checkJavaScript() {
  const roots = [
    path.join(projectRoot, "skills/lux-cover/scripts"),
    path.join(projectRoot, "skills/lux-paragraph-graph/scripts")
  ];
  const files = (await Promise.all(roots.map(walk))).flat().filter((file) => file.endsWith(".mjs"));
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`syntax check failed for ${file}: ${result.stderr}`);
    const lines = (await readFile(file, "utf8")).split("\n").length;
    if (lines > 500) throw new Error(`${path.relative(projectRoot, file)} exceeds 500 lines`);
  }
}

async function checkJsonAndFont() {
  const skillRoot = path.join(projectRoot, "skills/lux-cover");
  const graphRoot = path.join(projectRoot, "skills/lux-paragraph-graph");
  const { config, profile, ipManifest } = await loadRuntimeConfig(skillRoot);
  const graphRuntime = await loadGraphRuntime(projectRoot, graphRoot);
  JSON.parse(await readFile(path.join(projectRoot, "package.json"), "utf8"));
  if (
    config.limits.cover_attempt_limit !== 2 ||
    config.v3?.generator !== "built-in-image_gen" ||
    config.v3?.min_dimension !== 256 ||
    config.v3?.safe_padding_background !== "paper-only"
  ) {
    throw new Error("renderer config is missing the approved V3 limits");
  }
  if (
    profile.imagegen?.mode !== "complete-cover" ||
    profile.imagegen?.allow_code_title_overlay !== false ||
    profile.safe_padding?.background !== "paper-only" ||
    profile.safe_padding?.outer_border !== false ||
    profile.safe_padding?.decorations !== false ||
    profile.safe_padding?.semantic_content !== false ||
    profile.shared_crop_core?.background !== "source-matched-paper-only" ||
    profile.shared_crop_core?.sample_height_ratio !== 0.125 ||
    profile.shared_crop_core?.min_luminance !== 180 ||
    profile.shared_crop_core?.max_channel_spread !== 45 ||
    profile.shared_crop_core?.max_ink_ratio !== 0.01
  ) {
    throw new Error("visual profile is missing the approved V3 imagegen or safe-padding rules");
  }
  await lstat(config.font.file);
  await renderFontProbe(config);
  const identityPath = path.join(skillRoot, "assets", ipManifest.identity.file);
  if (await sha256File(identityPath) !== ipManifest.identity.sha256) {
    throw new Error("identity reference hash does not match manifest");
  }
  await validateTransparentPng(identityPath, config, "identity reference");
  if (profile.colors.paper === "#0870D8" || profile.allowed_colors.includes("#0870D8")) {
    throw new Error("whiteboard profile contains the retired enterprise-blue background");
  }
  if (
    graphRuntime.runtimeConfig.limits.graph_attempt_limit !== 2 ||
    graphRuntime.profileOverlay.composition.character_width_min !== 0.18 ||
    graphRuntime.profileOverlay.composition.character_width_max !== 0.24
  ) {
    throw new Error("paragraph graph runtime is missing the approved attempt or character limits");
  }
}

async function checkSymlink(relative, expectedTarget) {
  const absolute = path.join(projectRoot, relative);
  const stats = await lstat(absolute);
  if (!stats.isSymbolicLink()) throw new Error(`${relative} must be a symlink`);
  const target = await readlink(absolute);
  const resolved = path.resolve(path.dirname(absolute), target);
  if (resolved !== path.join(projectRoot, expectedTarget)) {
    throw new Error(`${relative} points to the wrong source: ${target}`);
  }
}

async function checkPlaceholders() {
  const files = (
    await Promise.all([
      walk(path.join(projectRoot, "skills/lux-cover")),
      walk(path.join(projectRoot, "skills/lux-paragraph-graph"))
    ])
  ).flat();
  const forbidden = [
    ["[TO", "DO:"].join(""),
    ["Complete and ", "informative"].join(""),
    ["Structuring This ", "Skill"].join(""),
    ["Replace with the first ", "main section"].join("")
  ];
  for (const file of files) {
    if (!(await lstat(file)).isFile()) continue;
    const content = await readFile(file).catch(() => null);
    if (!content) continue;
    const text = content.toString("utf8");
    for (const marker of forbidden) {
      if (text.includes(marker)) throw new Error(`${path.relative(projectRoot, file)} contains ${marker}`);
    }
  }
}

await requireFiles();
await rejectRetiredV2();
await checkJavaScript();
await checkJsonAndFont();
await checkSymlink(".agents/skills/lux-cover", "skills/lux-cover");
await checkSymlink(".claude/skills/lux-cover", "skills/lux-cover");
await checkSymlink(
  ".agents/skills/lux-paragraph-graph",
  "skills/lux-paragraph-graph"
);
await checkSymlink(
  ".claude/skills/lux-paragraph-graph",
  "skills/lux-paragraph-graph"
);
await checkPlaceholders();
process.stdout.write("PROJECT_CHECK_PASS\n");
