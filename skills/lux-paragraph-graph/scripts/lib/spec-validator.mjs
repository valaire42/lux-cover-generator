import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { validateTransparentPng } from "../../../lux-cover/scripts/lib/spec-validator.mjs";
import {
  CoverError, exactKeys, fail, object, readJson, safeId,
  sameValues, sha256File, text, within
} from "../../../lux-cover/scripts/lib/common.mjs";

const HEX_64 = /^[a-f0-9]{64}$/;


export function ratiosEqual(left, right) {
  return left.width * right.height === right.width * left.height;
}

export function requiredText(spec) {
  return [
    spec.plan.title,
    ...spec.plan.elements.flatMap((element) => [element.primary_text, ...element.secondary_texts])
  ];
}

function validatePlan(plan, runtime) {
  const { vocabulary, runtimeConfig } = runtime;
  exactKeys(
    plan,
    [
      "visual_type",
      "title",
      "communication_goal",
      "relationship_summary",
      "elements",
      "recommendation_reason",
      "allowed_symbols",
      "active_omissions"
    ],
    "plan"
  );
  const typeConfig = vocabulary.visual_types[plan.visual_type];
  if (!typeConfig) fail("INVALID_GRAPH_SPEC", `unknown visual_type: ${plan.visual_type}`);
  text(plan.title, "plan.title");
  text(plan.communication_goal, "plan.communication_goal");
  text(plan.relationship_summary, "plan.relationship_summary");
  if (
    !Array.isArray(plan.elements) ||
    plan.elements.length < typeConfig.min_elements ||
    plan.elements.length > typeConfig.max_elements
  ) {
    fail(
      "INVALID_GRAPH_SPEC",
      `${plan.visual_type} requires ${typeConfig.min_elements} to ${typeConfig.max_elements} elements`
    );
  }
  const ids = new Set();
  for (const [index, element] of plan.elements.entries()) {
    exactKeys(
      element,
      ["id", "primary_text", "secondary_texts", "icon_id", "role"],
      `plan.elements[${index}]`
    );
    safeId(element.id, `plan.elements[${index}].id`);
    if (ids.has(element.id)) fail("INVALID_GRAPH_SPEC", `duplicate element id: ${element.id}`);
    ids.add(element.id);
    text(element.primary_text, `plan.elements[${index}].primary_text`);
    textArray(element.secondary_texts, `plan.elements[${index}].secondary_texts`, {
      max: runtimeConfig.limits.max_secondary_texts_per_element
    });
    if (!vocabulary.icon_ids.includes(element.icon_id)) {
      fail("INVALID_GRAPH_SPEC", `unknown icon_id: ${element.icon_id}`);
    }
    if (!typeConfig.roles.includes(element.role)) {
      fail("INVALID_GRAPH_SPEC", `${element.role} is invalid for ${plan.visual_type}`);
    }
  }
  const roles = plan.elements.map((element) => element.role);
  if (plan.visual_type === "decision-map") {
    if (roles.filter((role) => role === "recommended").length !== 1) {
      fail("INVALID_GRAPH_SPEC", "decision-map requires exactly one recommended element");
    }
    if (roles.some((role) => !["option", "recommended"].includes(role))) {
      fail("INVALID_GRAPH_SPEC", "decision-map contains an invalid role");
    }
    text(plan.recommendation_reason, "plan.recommendation_reason");
  } else {
    if (plan.recommendation_reason !== null) {
      fail("INVALID_GRAPH_SPEC", `${plan.visual_type} recommendation_reason must be null`);
    }
    if (plan.visual_type === "concept-diagram") {
      if (
        roles.filter((role) => role === "center").length !== 1 ||
        roles.filter((role) => role === "component").length !== roles.length - 1
      ) {
        fail("INVALID_GRAPH_SPEC", "concept-diagram requires one center and all remaining components");
      }
    }
  }
  uniqueStringArray(plan.allowed_symbols, "plan.allowed_symbols", vocabulary.symbol_ids);
  textArray(plan.active_omissions, "plan.active_omissions", { min: 1, max: 12 });
  const displayed = requiredText({ plan });
  if (displayed.length > runtimeConfig.limits.max_required_text_entries) {
    fail("INVALID_GRAPH_SPEC", "required text exceeds the configured entry limit");
  }
  if (new Set(displayed).size !== displayed.length) {
    fail("INVALID_GRAPH_SPEC", "required text entries must be unique");
  }
}

function validateCharacter(character, runtime, elementIds) {
  exactKeys(character, ["identity_id", "pose_id", "pose_intent", "target_element_id"], "character");
  if (
    character.identity_id !== runtime.shared.ipManifest.identity.id ||
    runtime.shared.ipManifest.identity.reviewed !== true
  ) {
    fail("BLOCKED_CHARACTER_ASSET", "character identity must match the reviewed shared manifest");
  }
  if (!runtime.vocabulary.pose_ids.includes(character.pose_id)) {
    fail("INVALID_GRAPH_SPEC", `unknown pose_id: ${character.pose_id}`);
  }
  text(character.pose_intent, "character.pose_intent");
  if (
    character.target_element_id !== null &&
    (typeof character.target_element_id !== "string" || !elementIds.has(character.target_element_id))
  ) {
    fail("INVALID_GRAPH_SPEC", "character.target_element_id must be null or reference an element");
  }
}

function validateOutputs(spec, runtime) {
  const limits = runtime.shared.config.limits;
  const minimum = runtime.shared.config.v3.min_dimension;
  if (!Array.isArray(spec.outputs) || spec.outputs.length < 1 || spec.outputs.length > limits.max_outputs) {
    fail("INVALID_GRAPH_SPEC", `outputs must contain 1 to ${limits.max_outputs} entries`);
  }
  const outputIds = new Set();
  for (const [index, output] of spec.outputs.entries()) {
    exactKeys(output, ["id", "width", "height", "aspect_group_id"], `outputs[${index}]`);
    safeId(output.id, `outputs[${index}].id`);
    safeId(output.aspect_group_id, `outputs[${index}].aspect_group_id`);
    if (outputIds.has(output.id)) fail("INVALID_GRAPH_SPEC", `duplicate output id: ${output.id}`);
    outputIds.add(output.id);
    for (const dimension of ["width", "height"]) {
      if (
        !Number.isInteger(output[dimension]) ||
        output[dimension] < minimum ||
        output[dimension] > limits.max_dimension
      ) {
        fail("INVALID_GRAPH_SPEC", `outputs[${index}].${dimension} is outside configured limits`);
      }
    }
    if (output.width * output.height > limits.max_pixels) {
      fail("INVALID_GRAPH_SPEC", `outputs[${index}] exceeds max pixel count`);
    }
    const ratio = output.width / output.height;
    if (ratio < limits.min_aspect_ratio || ratio > limits.max_aspect_ratio) {
      fail("INVALID_GRAPH_SPEC", `outputs[${index}] aspect ratio is unsupported`);
    }
  }
  if (!Array.isArray(spec.aspect_groups) || spec.aspect_groups.length < 1) {
    fail("INVALID_GRAPH_SPEC", "aspect_groups must contain at least one group");
  }
  const groupIds = new Set();
  for (const [index, group] of spec.aspect_groups.entries()) {
    exactKeys(group, ["id", "master_output_id"], `aspect_groups[${index}]`);
    safeId(group.id, `aspect_groups[${index}].id`);
    safeId(group.master_output_id, `aspect_groups[${index}].master_output_id`);
    if (groupIds.has(group.id)) fail("INVALID_GRAPH_SPEC", `duplicate aspect group id: ${group.id}`);
    groupIds.add(group.id);
    const outputs = spec.outputs.filter((output) => output.aspect_group_id === group.id);
    if (outputs.length === 0) fail("INVALID_GRAPH_SPEC", `${group.id} has no outputs`);
    const master = outputs.find((output) => output.id === group.master_output_id);
    if (!master) fail("INVALID_GRAPH_SPEC", `${group.id}.master_output_id must reference an output in the group`);
    for (const output of outputs) {
      if (!ratiosEqual(master, output)) {
        fail("INVALID_GRAPH_SPEC", `${group.id} outputs must use exactly the same aspect ratio`);
      }
    }
  }
  for (const output of spec.outputs) {
    if (!groupIds.has(output.aspect_group_id)) {
      fail("INVALID_GRAPH_SPEC", `${output.id} references an unknown aspect group`);
    }
  }
}

export function validateGraphSpecShape(spec, runtime) {
  exactKeys(
    spec,
    ["version", "run_id", "source", "visual_card", "profile_id", "plan", "character", "aspect_groups", "outputs"],
    "spec"
  );
  if (spec.version !== 1) fail("INVALID_GRAPH_SPEC", "spec.version must be 1");
  safeId(spec.run_id, "run_id");
  const runPrefix = `runs/lux-paragraph-graph/${spec.run_id}`;
  exactKeys(spec.source, ["path", "sha256"], "source");
  if (spec.source.path !== `${runPrefix}/source.md` || !HEX_64.test(spec.source.sha256)) {
    fail("INVALID_GRAPH_SPEC", "source must reference the canonical source.md with a lowercase SHA-256");
  }
  exactKeys(spec.visual_card, ["path", "sha256"], "visual_card");
  if (
    spec.visual_card.path !== `${runPrefix}/visual-card.md` ||
    !HEX_64.test(spec.visual_card.sha256)
  ) {
    fail("INVALID_GRAPH_SPEC", "visual_card must reference the canonical visual-card.md with a lowercase SHA-256");
  }
  if (spec.profile_id !== runtime.profileOverlay.id) {
    fail("INVALID_GRAPH_SPEC", `unknown profile_id: ${spec.profile_id}`);
  }
  validatePlan(spec.plan, runtime);
  const elementIds = new Set(spec.plan.elements.map((element) => element.id));
  validateCharacter(spec.character, runtime, elementIds);
  validateOutputs(spec, runtime);
}

export async function readApprovedReview(filePath, expected) {
  let review;
  try {
    review = JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") fail("WAITING_FOR_USER", `${expected.checkpoint} review is required`);
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
    [
      "version",
      "status",
      "expected_text",
      "observed_text",
      "text_exact",
      "unexpected_text",
      "allowed_symbols",
      "observed_symbols",
      "unexpected_symbols",
      "identity",
      "pose",
      "structure",
      "style",
      "defects"
    ],
    "ai-review"
  );
  if (review.version !== 1 || review.status !== "passed") {
    fail("WAITING_FOR_USER", "AI graph review has not passed");
  }
  const expected = requiredText(spec);
  textArray(review.expected_text, "ai-review.expected_text", { min: 1 });
  textArray(review.observed_text, "ai-review.observed_text", { min: 1 });
  if (
    !sameValues(review.expected_text, expected) ||
    !sameValues(review.observed_text, expected) ||
    review.text_exact !== true
  ) {
    fail("WAITING_FOR_USER", "AI review did not read the exact required text");
  }
  if (!Array.isArray(review.unexpected_text) || review.unexpected_text.length !== 0) {
    fail("WAITING_FOR_USER", "AI review found unexpected text");
  }
  if (!sameValues(review.allowed_symbols, spec.plan.allowed_symbols)) {
    fail("WAITING_FOR_USER", "AI review allowed_symbols differ from the spec");
  }
  if (
    !Array.isArray(review.observed_symbols) ||
    review.observed_symbols.some((symbol) => !spec.plan.allowed_symbols.includes(symbol)) ||
    !Array.isArray(review.unexpected_symbols) ||
    review.unexpected_symbols.length !== 0
  ) {
    fail("WAITING_FOR_USER", "AI review found unexpected symbols");
  }
  exactKeys(review.identity, ["status", "checked_traits"], "ai-review.identity");
  if (review.identity.status !== "passed" || !Array.isArray(review.identity.checked_traits)) {
    fail("WAITING_FOR_USER", "AI identity review has not passed");
  }
  for (const trait of manifest.identity.core_traits) {
    if (!review.identity.checked_traits.includes(trait)) {
      fail("WAITING_FOR_USER", `AI identity review omitted ${trait}`);
    }
  }
  exactKeys(review.pose, ["status", "pose_id", "intent_observed"], "ai-review.pose");
  if (
    review.pose.status !== "passed" ||
    review.pose.pose_id !== spec.character.pose_id ||
    review.pose.intent_observed !== true
  ) {
    fail("WAITING_FOR_USER", "AI pose review has not passed");
  }
  exactKeys(
    review.structure,
    ["status", "visual_type", "element_ids", "recommended_element_id"],
    "ai-review.structure"
  );
  const recommended = spec.plan.elements.find((element) => element.role === "recommended")?.id ?? null;
  if (
    review.structure.status !== "passed" ||
    review.structure.visual_type !== spec.plan.visual_type ||
    !sameValues(review.structure.element_ids, spec.plan.elements.map((element) => element.id)) ||
    review.structure.recommended_element_id !== recommended
  ) {
    fail("WAITING_FOR_USER", "AI structure review has not passed");
  }
  exactKeys(
    review.style,
    ["status", "profile_id", "paragraph_hierarchy_observed", "no_full_outer_border"],
    "ai-review.style"
  );
  if (
    review.style.status !== "passed" ||
    review.style.profile_id !== spec.profile_id ||
    review.style.paragraph_hierarchy_observed !== true ||
    review.style.no_full_outer_border !== true
  ) {
    fail("WAITING_FOR_USER", "AI paragraph style review has not passed");
  }
  if (!Array.isArray(review.defects) || review.defects.length !== 0) {
    fail("WAITING_FOR_USER", "AI review still reports graph defects");
  }
}

export async function resolveGraphProjectInputs(spec, projectRoot, runtime) {
  validateGraphSpecShape(spec, runtime);
  const runsRoot = await realpath(path.join(projectRoot, "runs", "lux-paragraph-graph"));
  const runDir = await realpath(path.join(runsRoot, spec.run_id));
  const sourcePath = await realpath(path.join(projectRoot, spec.source.path));
  const visualCardPath = await realpath(path.join(projectRoot, spec.visual_card.path));
  if (!within(sourcePath, runDir) || !within(visualCardPath, runDir)) {
    fail("INVALID_PATH", "source or Visual Card escapes the current run");
  }
  if (
    await sha256File(sourcePath) !== spec.source.sha256 ||
    await sha256File(visualCardPath) !== spec.visual_card.sha256
  ) {
    fail("INVALID_GRAPH_SPEC", "source or Visual Card SHA-256 does not match");
  }
  for (const [filePath, label] of [
    [sourcePath, "source.md"],
    [visualCardPath, "visual-card.md"],
    [path.join(runDir, "visual-plan-prompt.md"), "visual-plan-prompt.md"]
  ]) {
    const content = await readFile(filePath, "utf8").catch(() => "");
    if (!content.trim()) fail("BLOCKED_INPUT", `${label} is required`);
  }
  await readApprovedReview(path.join(runDir, "reviews", "visual-card.json"), {
    checkpoint: "visual-card-review",
    subjectPath: spec.visual_card.path,
    subjectSha256: spec.visual_card.sha256
  });
  const identity = runtime.shared.ipManifest.identity;
  if (
    identity.reviewed !== true ||
    !HEX_64.test(identity.sha256) ||
    await sha256File(runtime.identityPath) !== identity.sha256
  ) {
    fail("BLOCKED_CHARACTER_ASSET", "shared identity reference is not reviewed or hash-pinned");
  }
  if (
    !Array.isArray(identity.core_traits) ||
    identity.core_traits.length === 0 ||
    identity.core_traits.some((trait) => typeof trait !== "string" || !trait.trim())
  ) {
    fail("BLOCKED_CHARACTER_ASSET", "shared identity traits are incomplete");
  }
  await validateTransparentPng(runtime.identityPath, runtime.shared.config, "identity reference");
  await readFile(runtime.stylePath);
  return { runDir, sourcePath, visualCardPath };
}

export async function readGraphSpec(specPath) {
  const spec = await readJson(specPath, "paragraph graph spec");
  if (spec.version !== 1) fail("INVALID_GRAPH_SPEC", "paragraph graph command requires spec.version 1");
  return spec;
}
