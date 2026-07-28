import sharp from "sharp";
import { CoverError, fail, sha256File } from "../../../lib/common.mjs";

export { CoverError, sha256File };

export async function validateTransparentPng(filePath, config, label = "identity reference") {
  const image = sharp(filePath, { limitInputPixels: config.limits.max_input_pixels });
  const metadata = await image.metadata();
  if (metadata.format !== "png" || metadata.hasAlpha !== true) {
    fail("BLOCKED_CHARACTER_ASSET", `${label} must be a PNG with alpha`);
  }
  const alpha = await image.clone().ensureAlpha().extractChannel(3).stats();
  if (alpha.channels[0].max === 0) {
    fail("BLOCKED_CHARACTER_ASSET", `${label} is fully transparent`);
  }
  const border = Math.max(1, Math.round(Math.min(metadata.width, metadata.height) * 0.02));
  const bands = [
    { left: 0, top: 0, width: metadata.width, height: border },
    { left: 0, top: metadata.height - border, width: metadata.width, height: border },
    { left: 0, top: 0, width: border, height: metadata.height },
    { left: metadata.width - border, top: 0, width: border, height: metadata.height }
  ];
  for (const band of bands) {
    const stats = await sharp(filePath, { limitInputPixels: config.limits.max_input_pixels })
      .ensureAlpha()
      .extract(band)
      .extractChannel(3)
      .stats();
    if (stats.channels[0].mean / 255 > 0.85) {
      fail("BLOCKED_CHARACTER_ASSET", `${label} has a mostly opaque canvas edge`);
    }
  }
  return metadata;
}
