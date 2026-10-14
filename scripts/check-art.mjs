#!/usr/bin/env node
/**
 * 检查插画素材：是否存在、格式、体积、实际尺寸，并列出还缺哪几张。
 * 用法：node scripts/check-art.mjs
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const DIR = path.resolve("debug/assets");

/** [文件名, 目标宽, 目标高, 体积上限 KB] */
const SPECS = [
  ["home-hero.webp", 2400, 1350, 250],
  ["wood-illus.webp", 640, 560, 45],
  ["brick-illus.webp", 640, 560, 45],
  ["sheep-illus.webp", 640, 560, 45],
  ["wheat-illus.webp", 640, 560, 45],
  ["ore-illus.webp", 640, 560, 45],
  ["knight-illus.webp", 640, 560, 45],
  ["victoryPoint-illus.webp", 640, 560, 45],
  ["roadBuilding-illus.webp", 640, 560, 45],
  ["yearOfPlenty-illus.webp", 640, 560, 45],
  ["monopoly-illus.webp", 640, 560, 45],
  ["results-hero.webp", 1600, 800, 120],
  ["board-sea.webp", 2048, 1152, 250],
  ["paper-tile.webp", 256, 256, 40],
  ["wood-frame.webp", 512, 512, 60],
  ["btn-plate.webp", 512, 512, 45],
  ["btn-plate-primary.webp", 512, 512, 45],
  ["btn-plate-yes.webp", 512, 512, 45],
  ["btn-art-solo.webp", 720, 192, 60],
  ["btn-art-online.webp", 1080, 240, 60],
];

function pngSize(buffer) {
  if (buffer.length < 24 || buffer.readUInt32BE(0) !== 0x89504e47) return null;
  return [buffer.readUInt32BE(16), buffer.readUInt32BE(20)];
}

function webpSize(buffer) {
  if (buffer.length < 30 || buffer.toString("ascii", 0, 4) !== "RIFF") return null;
  if (buffer.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    const w = 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16));
    const h = 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16));
    return [w, h];
  }
  if (chunk === "VP8 ") {
    return [buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff];
  }
  if (chunk === "VP8L") {
    const bits = buffer.readUInt32LE(21);
    return [1 + (bits & 0x3fff), 1 + ((bits >> 14) & 0x3fff)];
  }
  return null;
}

function sizeOf(buffer, name) {
  if (name.endsWith(".png")) return pngSize(buffer);
  if (name.endsWith(".webp")) return webpSize(buffer);
  return null;
}

let missing = 0;
let warnings = 0;

console.log("文件                          尺寸            体积      目标           结论");
console.log("-".repeat(88));

for (const [name, wantW, wantH, maxKb] of SPECS) {
  const file = path.join(DIR, name);
  let buffer;
  try {
    buffer = await readFile(file);
  } catch {
    missing += 1;
    console.log(
      `${name.padEnd(30)} ${"—".padEnd(15)} ${"—".padEnd(9)} ${`${wantW}×${wantH}`.padEnd(14)} 缺`,
    );
    continue;
  }
  const kb = Math.round(buffer.length / 1024);
  const size = sizeOf(buffer, name);
  const sizeText = size ? `${size[0]}×${size[1]}` : "无法识别";
  const problems = [];
  if (!size) problems.push("格式非 PNG/WebP");
  if (size && (size[0] !== wantW || size[1] !== wantH)) problems.push(`尺寸应为 ${wantW}×${wantH}`);
  if (kb > maxKb) problems.push(`应压到 ≤ ${maxKb}KB`);
  if (problems.length) warnings += 1;
  console.log(
    `${name.padEnd(30)} ${sizeText.padEnd(15)} ${(kb + "KB").padEnd(9)} ${`${wantW}×${wantH}`.padEnd(14)} ` +
      (problems.length ? problems.join("；") : "通过"),
  );
}

console.log("-".repeat(88));
console.log(`共 ${SPECS.length} 张：通过 ${SPECS.length - missing - warnings}，待改 ${warnings}，未提供 ${missing}`);
if (missing) {
  console.log("未提供的会自动回退到矢量版，页面不会坏；补齐后再跑一次这个脚本即可。");
}
