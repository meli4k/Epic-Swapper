import { createCanvas, loadImage } from "@napi-rs/canvas";

const CATALOG_URL = "https://fortnite-api.com/v2/cosmetics/br";
const COLS = 11;
const CELL = 112;
const NAME_H = 26;
const GAP = 3;
const PAD = 18;
const HEADER = 78;
const FOOTER = 56;

const GROUPS = [
  ["AthenaCharacter", "Skins"],
  ["AthenaBackpack", "Back blings"],
  ["AthenaPickaxe", "Pickaxes"],
  ["AthenaGlider", "Gliders"],
  ["AthenaDance", "Emotes"],
  ["AthenaItemWrap", "Wraps"],
  ["AthenaSkyDiveContrail", "Contrails"],
  ["AthenaLoadingScreen", "Loading screens"],
];

const RARITY_RANK = {
  mythic: 0,
  legendary: 1,
  exotic: 2,
  epic: 3,
  rare: 4,
  uncommon: 5,
  common: 6,
};

const RARITY_COLOR = {
  mythic: ["#f4c56a", "#a86b12"],
  legendary: ["#f0c14b", "#b8860b"],
  exotic: ["#8ee0d4", "#1f7a72"],
  epic: ["#c47bff", "#6b3fa0"],
  rare: ["#4aa3ff", "#1d4e89"],
  uncommon: ["#67d15a", "#2f7d32"],
  common: ["#d0d0d0", "#6e6e6e"],
};

let catalogCache = null;
let catalogAt = 0;

function shade(hex, amount) {
  const value = hex.replace("#", "");
  const full = value.length === 3 ? value.split("").map((part) => part + part).join("") : value;
  const num = Number.parseInt(full, 16);
  const mix = (channel) => Math.max(0, Math.min(255, Math.round(channel + (amount < 0 ? channel * amount : (255 - channel) * amount))));
  const r = mix((num >> 16) & 255);
  const g = mix((num >> 8) & 255);
  const b = mix(num & 255);
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

async function catalog() {
  if (catalogCache && Date.now() - catalogAt < 6 * 60 * 60 * 1000) return catalogCache;
  const response = await fetch(CATALOG_URL, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error("The cosmetics list could not be loaded.");
  const payload = await response.json();
  const map = new Map();
  for (const item of payload.data || []) {
    if (item?.id) map.set(String(item.id).toUpperCase(), item);
  }
  catalogCache = map;
  catalogAt = Date.now();
  return map;
}

function ownedGroups(profile) {
  const items = profile?.profileChanges?.[0]?.profile?.items || {};
  const groups = new Map(GROUPS.map(([, title]) => [title, []]));
  const seen = new Set();
  for (const item of Object.values(items)) {
    const template = String(item?.templateId || "");
    const split = template.indexOf(":");
    if (split < 1) continue;
    const type = template.slice(0, split);
    const title = GROUPS.find(([key]) => key === type)?.[1];
    if (!title) continue;
    const id = template.slice(split + 1).split(":")[0];
    if (!id || /default|random|placeholder|tbd/i.test(id)) continue;
    const key = `${type}:${id.toUpperCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    groups.get(title).push(id);
  }
  return groups;
}

async function pool(list, limit, task) {
  const out = new Array(list.length);
  let next = 0;
  async function worker() {
    while (next < list.length) {
      const index = next;
      next += 1;
      out[index] = await task(list[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, () => worker()));
  return out;
}

async function iconFor(url) {
  if (!url) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!response.ok) return null;
    return await loadImage(Buffer.from(await response.arrayBuffer()));
  } catch {
    return null;
  }
}

function colorsFor(cosmetic) {
  const series = cosmetic?.series?.colors?.find((color) => /^#?[0-9a-f]{6}$/i.test(color));
  if (series) {
    const hex = series.startsWith("#") ? series : `#${series}`;
    return [shade(hex, 0.25), shade(hex, -0.35)];
  }
  const rarity = String(cosmetic?.rarity?.value || "common").toLowerCase();
  return RARITY_COLOR[rarity] || RARITY_COLOR.common;
}

function rankFor(cosmetic) {
  const rarity = String(cosmetic?.rarity?.value || "common").toLowerCase();
  return RARITY_RANK[rarity] ?? 9;
}

function fitText(ctx, text, width) {
  let value = text;
  while (value.length > 1 && ctx.measureText(value).width > width) value = value.slice(0, -1);
  return value.length < text.length ? `${value.slice(0, -1)}…` : value;
}

function drawShirt(ctx, x, y) {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2.4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(12, 3);
  ctx.lineTo(16, 8);
  ctx.lineTo(20, 3);
  ctx.lineTo(31, 10);
  ctx.lineTo(26, 16);
  ctx.lineTo(22, 13);
  ctx.lineTo(22, 32);
  ctx.lineTo(10, 32);
  ctx.lineTo(10, 13);
  ctx.lineTo(6, 16);
  ctx.lineTo(1, 10);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

function renderSheet(title, entries, displayName) {
  const cols = Math.min(COLS, Math.max(entries.length, 1));
  const rows = Math.ceil(entries.length / cols);
  const width = Math.max(PAD * 2 + cols * CELL + (cols - 1) * GAP, 640);
  const height = PAD + HEADER + rows * CELL + (rows - 1) * GAP + FOOTER;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000000";
  ctx.fillRect(0, 0, width, height);

  const series = entries.filter((entry) => entry.series).length;
  drawShirt(ctx, PAD, PAD + 8);
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 42px Segoe UI, Arial";
  ctx.textBaseline = "top";
  const count = String(entries.length);
  ctx.fillText(count, PAD + 42, PAD);
  const countWidth = ctx.measureText(count).width;
  if (series) {
    ctx.font = "600 22px Segoe UI, Arial";
    ctx.fillStyle = "#d7d7d7";
    ctx.fillText(`(${series})`, PAD + 48 + countWidth, PAD + 16);
  }
  ctx.font = "600 28px Segoe UI, Arial";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(title, PAD + 42, PAD + 44);

  entries.forEach((entry, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = PAD + col * (CELL + GAP);
    const y = PAD + HEADER + row * (CELL + GAP);
    const [top, bottom] = entry.colors;
    const gradient = ctx.createLinearGradient(x, y, x, y + CELL);
    gradient.addColorStop(0, top);
    gradient.addColorStop(1, bottom);
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, CELL, CELL);
    if (entry.image) {
      ctx.drawImage(entry.image, x, y, CELL, CELL);
    }
    ctx.fillStyle = "rgba(0, 0, 0, 0.62)";
    ctx.fillRect(x, y + CELL - NAME_H, CELL, NAME_H);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 11px Segoe UI, Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(fitText(ctx, entry.name.toUpperCase(), CELL - 10), x + CELL / 2, y + CELL - NAME_H / 2);
    ctx.textAlign = "left";
  });

  const stamp = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date());
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 18px Segoe UI, Arial";
  ctx.textBaseline = "top";
  ctx.fillText(stamp, PAD, height - FOOTER + 8);
  ctx.font = "600 16px Segoe UI, Arial";
  ctx.fillStyle = "#d0d0d0";
  ctx.fillText(displayName || "Epic account", PAD, height - FOOTER + 32);
  return canvas.toBuffer("image/jpeg", 90);
}

export async function renderLocker(profile, displayName) {
  const groups = ownedGroups(profile);
  const known = await catalog().catch(() => new Map());
  const sheets = [];
  for (const [, title] of GROUPS) {
    const ids = groups.get(title) || [];
    if (!ids.length) continue;
    const prepared = ids.map((id) => {
      const cosmetic = known.get(id.toUpperCase());
      return {
        id,
        name: cosmetic?.name || id,
        series: Boolean(cosmetic?.series),
        colors: colorsFor(cosmetic),
        rank: rankFor(cosmetic),
        imageUrl: cosmetic?.images?.smallIcon || cosmetic?.images?.icon || "",
      };
    });
    prepared.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    const withIcons = await pool(prepared, 12, async (entry) => ({
      ...entry,
      image: await iconFor(entry.imageUrl),
    }));
    sheets.push({
      name: `${title.toLowerCase().replaceAll(" ", "-")}.jpg`,
      file: renderSheet(title, withIcons, displayName),
    });
  }
  return sheets;
}
