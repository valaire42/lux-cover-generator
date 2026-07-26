import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { backgroundSvg } from "./whiteboard-svg.mjs";
import { CoverError, sha256File } from "./spec-validator.mjs";
import { ratiosEqual, readApprovedReview } from "./v3-spec-validator.mjs";

function fail(code, message) {
  throw new CoverError(code, message);
}

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_CALIBRATION", `${label} must be an object`);
  }
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  const missing = allowed.filter((key) => !(key in value));
  if (unknown.length) fail("INVALID_CALIBRATION", `${label} has unknown field(s): ${unknown.join(", ")}`);
  if (missing.length) fail("INVALID_CALIBRATION", `${label} is missing field(s): ${missing.join(", ")}`);
}

function within(candidate, parent) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function validateNormalizedCrop(crop) {
  exactKeys(crop, ["left", "top", "right", "bottom"], "visible_crop");
  for (const key of ["left", "top", "right", "bottom"]) {
    if (typeof crop[key] !== "number" || crop[key] < 0 || crop[key] > 1) {
      fail("INVALID_CALIBRATION", `visible_crop.${key} must be between 0 and 1`);
    }
  }
  if (crop.left >= crop.right || crop.top >= crop.bottom) {
    fail("INVALID_CALIBRATION", "visible_crop must have positive width and height");
  }
}

export function normalizedCropToPixels(crop, width, height) {
  validateNormalizedCrop(crop);
  const left = Math.round(crop.left * width);
  const top = Math.round(crop.top * height);
  const right = Math.round(crop.right * width);
  const bottom = Math.round(crop.bottom * height);
  const result = { x: left, y: top, width: right - left, height: bottom - top };
  if (
    result.width < 1 ||
    result.height < 1 ||
    result.x < 0 ||
    result.y < 0 ||
    result.x + result.width > width ||
    result.y + result.height > height
  ) {
    fail("INVALID_CALIBRATION", "visible_crop resolves outside the output");
  }
  return result;
}

export async function loadApprovedCalibration({ calibrationPath, projectRoot, runDir, output }) {
  const absolute = await realpath(path.join(projectRoot, calibrationPath));
  const calibrationRoot = path.join(runDir, "calibrations");
  if (!within(absolute, calibrationRoot) || path.basename(absolute) !== "calibration.json") {
    fail("INVALID_PATH", "calibration_path escapes the current run calibration directory");
  }
  let calibration;
  try {
    calibration = JSON.parse(await readFile(absolute, "utf8"));
  } catch (error) {
    fail("INVALID_CALIBRATION", `calibration could not be read: ${error.message}`);
  }
  exactKeys(
    calibration,
    ["version", "id", "platform_id", "surface_id", "source", "sample_upload", "visible_crop", "basis", "notes"],
    "calibration"
  );
  if (calibration.version !== 1) fail("INVALID_CALIBRATION", "calibration.version must be 1");
  if (calibration.platform_id !== output.platform_id) {
    fail("INVALID_CALIBRATION", "calibration platform does not match output");
  }
  if (typeof calibration.id !== "string" || path.basename(path.dirname(absolute)) !== calibration.id) {
    fail("INVALID_CALIBRATION", "calibration id must match its directory");
  }
  if (typeof calibration.surface_id !== "string" || !calibration.surface_id.trim()) {
    fail("INVALID_CALIBRATION", "calibration surface_id is required");
  }
  exactKeys(calibration.sample_upload, ["width", "height"], "calibration.sample_upload");
  if (
    !Number.isInteger(calibration.sample_upload.width) ||
    !Number.isInteger(calibration.sample_upload.height) ||
    !ratiosEqual(calibration.sample_upload, output)
  ) {
    fail("INVALID_CALIBRATION", "calibration sample_upload must have exactly the output aspect ratio");
  }
  validateNormalizedCrop(calibration.visible_crop);
  if (calibration.basis !== "visual-analysis-of-user-platform-screenshot") {
    fail("INVALID_CALIBRATION", "calibration basis must identify user screenshot analysis");
  }
  if (typeof calibration.notes !== "string" || !calibration.notes.trim()) {
    fail("INVALID_CALIBRATION", "calibration notes are required");
  }
  exactKeys(calibration.source, ["path", "sha256", "width", "height"], "calibration.source");
  const sourcePath = await realpath(path.join(projectRoot, calibration.source.path));
  if (!within(sourcePath, path.dirname(absolute)) || path.basename(sourcePath) !== "source.png") {
    fail("INVALID_PATH", "calibration source must be the canonical source.png");
  }
  if (await sha256File(sourcePath) !== calibration.source.sha256) {
    fail("INVALID_CALIBRATION", "calibration source hash does not match");
  }
  const sourceMeta = await sharp(sourcePath).metadata();
  if (
    sourceMeta.format !== "png" ||
    sourceMeta.width !== calibration.source.width ||
    sourceMeta.height !== calibration.source.height
  ) {
    fail("INVALID_CALIBRATION", "calibration source metadata does not match");
  }
  const calibrationSha256 = await sha256File(absolute);
  await readApprovedReview(path.join(path.dirname(absolute), "review.json"), {
    checkpoint: "platform-calibration-review",
    subjectPath: path.relative(projectRoot, absolute),
    subjectSha256: calibrationSha256
  });
  return {
    calibration,
    calibrationPath: path.relative(projectRoot, absolute),
    calibrationSha256,
    visibleCrop: normalizedCropToPixels(calibration.visible_crop, output.width, output.height)
  };
}

function cropOverlaySvg(width, height, crop, color) {
  const right = crop.x + crop.width;
  const bottom = crop.y + crop.height;
  return Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <path d="M0 0H${width}V${height}H0z M${crop.x} ${crop.y}V${bottom}H${right}V${crop.y}z"
      fill="#1D1A17" fill-opacity="0.42" fill-rule="evenodd"/>
    <rect x="${crop.x}" y="${crop.y}" width="${crop.width}" height="${crop.height}"
      fill="none" stroke="${color}" stroke-width="5" stroke-dasharray="18 12"/>
  </svg>`);
}

function displayCropsToPixels(crops, width, height) {
  return crops.map((crop) => ({
    id: crop.id,
    ...normalizedCropToPixels({
      left: crop.left,
      top: crop.top,
      right: crop.right,
      bottom: crop.bottom
    }, width, height)
  }));
}

function intersectCrops(crops) {
  const intersection = {
    x: Math.max(...crops.map((crop) => crop.x)),
    y: Math.max(...crops.map((crop) => crop.y)),
    right: Math.min(...crops.map((crop) => crop.x + crop.width)),
    bottom: Math.min(...crops.map((crop) => crop.y + crop.height))
  };
  const result = {
    x: intersection.x,
    y: intersection.y,
    width: intersection.right - intersection.x,
    height: intersection.bottom - intersection.y
  };
  if (result.width < 1 || result.height < 1) {
    fail("OUTPUT_VALIDATION_FAILED", "shared crop regions have no common pixel intersection");
  }
  return result;
}

async function sourceMatchedPaper(masterBuffer, masterMeta, output, profile) {
  const settings = profile.shared_crop_core;
  if (
    !settings ||
    settings.background !== "source-matched-paper-only" ||
    typeof settings.sample_height_ratio !== "number" ||
    typeof settings.min_luminance !== "number" ||
    typeof settings.max_channel_spread !== "number" ||
    typeof settings.max_ink_ratio !== "number"
  ) {
    fail("OUTPUT_VALIDATION_FAILED", "shared crop paper settings are incomplete");
  }
  const sampleHeight = Math.max(1, Math.round(masterMeta.height * settings.sample_height_ratio));
  const sampleCrop = { left: 0, top: 0, width: masterMeta.width, height: sampleHeight };
  const sample = await sharp(masterBuffer).extract(sampleCrop).png().toBuffer();
  const raw = await sharp(sample).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let inkPixels = 0;
  const totalPixels = raw.info.width * raw.info.height;
  for (let offset = 0; offset < raw.data.length; offset += raw.info.channels) {
    const r = raw.data[offset];
    const g = raw.data[offset + 1];
    const b = raw.data[offset + 2];
    const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    if (luminance < settings.min_luminance || spread > settings.max_channel_spread) {
      inkPixels += 1;
    }
  }
  const inkRatio = inkPixels / totalPixels;
  if (inkRatio > settings.max_ink_ratio) {
    fail(
      "OUTPUT_VALIDATION_FAILED",
      `shared crop background sample is not paper-only: ink ratio ${inkRatio.toFixed(4)} exceeds ${settings.max_ink_ratio}`
    );
  }
  const tile = await sharp(sample)
    .resize({ width: output.width })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer({ resolveWithObject: true });
  const mirrored = await sharp(tile.data)
    .flip()
    .flop()
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
  const strips = [];
  for (let top = 0, index = 0; top < output.height; top += tile.info.height, index += 1) {
    const remaining = output.height - top;
    const source = index % 2 === 0 ? tile.data : mirrored;
    const input = remaining < tile.info.height
      ? await sharp(source).extract({ left: 0, top: 0, width: output.width, height: remaining }).png().toBuffer()
      : source;
    strips.push({ input, left: 0, top });
  }
  const background = await sharp({
    create: {
      width: output.width,
      height: output.height,
      channels: 4,
      background: profile.colors.paper
    }
  }).composite(strips).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
  return {
    background,
    sample: {
      crop: { x: 0, y: 0, width: masterMeta.width, height: sampleHeight },
      sha256: sha256(sample),
      ink_ratio: inkRatio,
      max_ink_ratio: settings.max_ink_ratio
    }
  };
}

async function renderSharedCropCore({ masterBuffer, masterMeta, output, profile }) {
  const crops = displayCropsToPixels(output.adaptation.visible_crops, output.width, output.height);
  const common = intersectCrops(crops);
  const fitted = await sharp(masterBuffer)
    .resize({ width: common.width, height: common.height, fit: "inside" })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer({ resolveWithObject: true });
  const inserted = {
    x: common.x + Math.round((common.width - fitted.info.width) / 2),
    y: common.y + Math.round((common.height - fitted.info.height) / 2),
    width: fitted.info.width,
    height: fitted.info.height
  };
  for (const crop of crops) {
    if (
      inserted.x < crop.x ||
      inserted.y < crop.y ||
      inserted.x + inserted.width > crop.x + crop.width ||
      inserted.y + inserted.height > crop.y + crop.height
    ) {
      fail("OUTPUT_VALIDATION_FAILED", `${output.id} semantic core leaves display crop ${crop.id}`);
    }
  }
  const paper = await sourceMatchedPaper(masterBuffer, masterMeta, output, profile);
  const outputBuffer = await sharp(paper.background)
    .composite([{ input: fitted.data, left: inserted.x, top: inserted.y }])
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
  const overlayBuffer = await sharp(outputBuffer)
    .composite([{ input: cropOverlaySvg(output.width, output.height, common, profile.colors.coral), left: 0, top: 0 }])
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
  const visibleBuffer = await sharp(outputBuffer).extract({
    left: common.x,
    top: common.y,
    width: common.width,
    height: common.height
  })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
  const displayPreviews = await Promise.all(crops.map(async (crop) => ({
    id: crop.id,
    crop,
    buffer: await sharp(outputBuffer).extract({
      left: crop.x,
      top: crop.y,
      width: crop.width,
      height: crop.height
    }).png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer()
  })));
  const scale = Math.min(common.width / masterMeta.width, common.height / masterMeta.height);
  return {
    outputBuffer,
    overlayBuffer,
    visibleBuffer,
    displayPreviews,
    artifact: {
      version: 3,
      output_id: output.id,
      adaptation_mode: "shared-crop-core",
      crop_basis: output.adaptation.basis,
      visible_crop: common,
      visible_crops: crops,
      inserted_cover: inserted,
      transform: { scale_x: scale, scale_y: scale, direct_stretch: false },
      background_sample: paper.sample,
      outer_background: {
        style: "source-matched-paper-only",
        outer_border: false,
        decorations: false,
        semantic_content: false
      }
    }
  };
}

async function exactSameRatioResize(masterBuffer, metadata, output) {
  if (!ratiosEqual(metadata, output)) {
    fail("OUTPUT_VALIDATION_FAILED", `${output.id} ratio differs from its approved master`);
  }
  const resized = await sharp(masterBuffer)
    .resize({ width: output.width, height: output.height, fit: "inside" })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer({ resolveWithObject: true });
  if (resized.info.width !== output.width || resized.info.height !== output.height) {
    fail("OUTPUT_VALIDATION_FAILED", `${output.id} exact same-ratio resize did not fill the target`);
  }
  return resized.data;
}

export async function renderV3Output({ masterBuffer, output, profile, visibleCrop = null }) {
  const masterMeta = await sharp(masterBuffer).metadata();
  if (masterMeta.format !== "png" || !masterMeta.width || !masterMeta.height) {
    fail("OUTPUT_VALIDATION_FAILED", `${output.id} master must be a valid PNG`);
  }
  if (output.adaptation.mode === "shared-crop-core") {
    return renderSharedCropCore({ masterBuffer, masterMeta, output, profile });
  }
  const baseBuffer = await exactSameRatioResize(masterBuffer, masterMeta, output);
  const baseScale = output.width / masterMeta.width;
  if (output.adaptation.mode === "none") {
    return {
      outputBuffer: baseBuffer,
      overlayBuffer: baseBuffer,
      visibleBuffer: baseBuffer,
      artifact: {
        version: 3,
        output_id: output.id,
        adaptation_mode: "none",
        visible_crop: { x: 0, y: 0, width: output.width, height: output.height },
        inserted_cover: { x: 0, y: 0, width: output.width, height: output.height },
        transform: { scale_x: baseScale, scale_y: baseScale, direct_stretch: false },
        outer_background: null
      }
    };
  }
  if (output.adaptation.mode !== "evidence-safe-padding" || !visibleCrop) {
    fail("INVALID_CALIBRATION", `${output.id} requires an approved visible crop`);
  }
  const insetScale = Math.min(visibleCrop.width / output.width, visibleCrop.height / output.height);
  const fitted = await sharp(baseBuffer)
    .resize({ width: visibleCrop.width, height: visibleCrop.height, fit: "inside" })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer({ resolveWithObject: true });
  const inserted = {
    x: visibleCrop.x + Math.round((visibleCrop.width - fitted.info.width) / 2),
    y: visibleCrop.y + Math.round((visibleCrop.height - fitted.info.height) / 2),
    width: fitted.info.width,
    height: fitted.info.height
  };
  if (
    inserted.x < visibleCrop.x ||
    inserted.y < visibleCrop.y ||
    inserted.x + inserted.width > visibleCrop.x + visibleCrop.width ||
    inserted.y + inserted.height > visibleCrop.y + visibleCrop.height
  ) {
    fail("OUTPUT_VALIDATION_FAILED", `${output.id} inserted cover leaves the visible crop`);
  }
  const outputBuffer = await sharp(backgroundSvg(output.width, output.height, profile))
    .composite([{ input: fitted.data, left: inserted.x, top: inserted.y }])
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
  const overlayBuffer = await sharp(outputBuffer)
    .composite([{
      input: cropOverlaySvg(output.width, output.height, visibleCrop, profile.colors.coral),
      left: 0,
      top: 0
    }])
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
  const visibleBuffer = await sharp(outputBuffer)
    .extract({
      left: visibleCrop.x,
      top: visibleCrop.y,
      width: visibleCrop.width,
      height: visibleCrop.height
    })
    .png({ compressionLevel: 9, adaptiveFiltering: false })
    .toBuffer();
  const totalScale = baseScale * insetScale;
  return {
    outputBuffer,
    overlayBuffer,
    visibleBuffer,
    artifact: {
      version: 3,
      output_id: output.id,
      adaptation_mode: "evidence-safe-padding",
      visible_crop: visibleCrop,
      inserted_cover: inserted,
      transform: { scale_x: totalScale, scale_y: totalScale, direct_stretch: false },
      outer_background: {
        style: "profile-paper-only",
        outer_border: false,
        decorations: false,
        semantic_content: false
      }
    }
  };
}
