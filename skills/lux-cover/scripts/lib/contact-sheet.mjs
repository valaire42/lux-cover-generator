import sharp from "sharp";
import { ensureFontEnvironment, escapePango } from "./text-layer.mjs";

const TILE_WIDTH = 720;
const PREVIEW_WIDTH = 640;
const PREVIEW_HEIGHT = 360;
const LABEL_HEIGHT = 64;
const TILE_HEIGHT = 464;

async function makeLabel(entry, config) {
  ensureFontEnvironment(config);
  return sharp({
    text: {
      text: `<span foreground="#1D1A17" weight="bold">${escapePango(`${entry.id} · ${entry.width} × ${entry.height}`)}</span>`,
      font: `${config.font.family} 34`,
      fontfile: config.font.file,
      rgba: true,
      dpi: 72,
      width: PREVIEW_WIDTH,
      align: "center",
      wrap: "none"
    }
  })
    .png()
    .toBuffer({ resolveWithObject: true });
}

async function makeTile(entry, config) {
  const preview = await sharp(entry.buffer)
    .resize({ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT, fit: "inside" })
    .png()
    .toBuffer({ resolveWithObject: true });
  const label = await makeLabel(entry, config);
  return sharp({
    create: {
      width: TILE_WIDTH,
      height: TILE_HEIGHT,
      channels: 4,
      background: "#F6F0E5"
    }
  })
    .composite([
      {
        input: label.data,
        left: Math.round((TILE_WIDTH - label.info.width) / 2),
        top: Math.round((LABEL_HEIGHT - label.info.height) / 2) + 12
      },
      {
        input: preview.data,
        left: Math.round((TILE_WIDTH - preview.info.width) / 2),
        top: LABEL_HEIGHT + Math.round((PREVIEW_HEIGHT - preview.info.height) / 2) + 20
      }
    ])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function createContactSheet(entries, config) {
  if (!Array.isArray(entries) || entries.length < 1) {
    throw new Error("contact sheet requires at least one valid output");
  }
  const tiles = [];
  for (const entry of entries) tiles.push(await makeTile(entry, config));
  if (tiles.length === 1) return tiles[0];
  return sharp(tiles, {
    join: { across: 1, shim: 20, background: "#D8CBB7" }
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
}
