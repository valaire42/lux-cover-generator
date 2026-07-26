import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { CoverError } from "./spec-validator.mjs";

export function escapePango(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function ensureFontEnvironment(config) {
  process.env.FONTCONFIG_FILE = fileURLToPath(
    new URL(`../../assets/${config.font.fontconfig_file}`, import.meta.url)
  );
}

async function renderMarkup(markup, config, fontSize) {
  ensureFontEnvironment(config);
  return sharp({
    text: {
      text: markup,
      font: `${config.font.family} ${fontSize}`,
      fontfile: config.font.file,
      rgba: true,
      dpi: 72,
      wrap: "none",
      align: "left"
    }
  }).png().toBuffer({ resolveWithObject: true });
}

export async function renderFontProbe(config) {
  const rendered = await renderMarkup(
    `<span foreground="#1D1A17" weight="bold">${escapePango(config.font.probe)}</span>`,
    config,
    48
  );
  if (rendered.info.width < 1 || rendered.info.height < 1) {
    throw new CoverError("BLOCKED_FONT", "Chinese font probe produced an empty image");
  }
  return rendered.data;
}
