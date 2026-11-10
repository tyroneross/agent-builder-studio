#!/usr/bin/env node
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);

function loadPptxGen() {
  const candidates = [
    "pptxgenjs",
    process.env.CODEX_RUNTIME_NODE_MODULES
      ? path.join(process.env.CODEX_RUNTIME_NODE_MODULES, "pptxgenjs")
      : null,
  ].filter(Boolean);

  const errors = [];
  for (const candidate of candidates) {
    try {
      const mod = require(candidate);
      return mod.default || mod;
    } catch (error) {
      errors.push(`${candidate}: ${error.message}`);
    }
  }
  throw new Error(`Unable to load pptxgenjs. Tried: ${errors.join("; ")}`);
}

function requireArg(index, name) {
  const value = process.argv[index];
  if (!value) throw new Error(`Missing ${name}`);
  return path.resolve(value);
}

const specPath = requireArg(2, "deck spec JSON path");
const outputPath = requireArg(3, "output PPTX path");
const spec = JSON.parse(readFileSync(specPath, "utf8"));
const PptxGenJS = loadPptxGen();
const pptx = new PptxGenJS();

pptx.layout = "LAYOUT_WIDE";
pptx.author = "Agent Builder";
pptx.company = "Agent Builder";
pptx.subject = spec.title || "Agent Builder deck";
pptx.title = spec.title || "Agent Builder deck";
pptx.lang = "en-US";
pptx.theme = {
  headFontFace: "Aptos Display",
  bodyFontFace: "Aptos",
  lang: "en-US",
};
pptx.defineSlideMaster({
  title: "AGENT_BUILDER",
  background: { color: "F8FAFC" },
  objects: [
    { line: { x: 0.55, y: 6.95, w: 12.25, h: 0, line: { color: "D1D5DB", pt: 0.6 } } },
    {
      text: {
        text: "Agent Builder local artifact run",
        options: { x: 0.6, y: 7.03, w: 4.8, h: 0.18, fontSize: 7.5, color: "64748B" },
      },
    },
  ],
});

const slides = Array.isArray(spec.slides) ? spec.slides : [];
if (!slides.length) throw new Error("Deck spec must include at least one slide");

slides.forEach((item, index) => {
  const slide = pptx.addSlide("AGENT_BUILDER");
  slide.background = { color: index === 0 ? "111827" : "F8FAFC" };

  const isCover = index === 0;
  const titleColor = isCover ? "F9FAFB" : "111827";
  const bodyColor = isCover ? "E5E7EB" : "374151";
  const accentColor = isCover ? "38BDF8" : "2563EB";

  slide.addShape(pptx.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: isCover ? 7.5 : 0.28,
    fill: { color: isCover ? "111827" : accentColor, transparency: isCover ? 0 : 0 },
    line: { color: isCover ? "111827" : accentColor, transparency: 100 },
  });

  if (isCover) {
    slide.addShape(pptx.ShapeType.rect, {
      x: 0.72,
      y: 1.0,
      w: 0.12,
      h: 4.85,
      fill: { color: accentColor },
      line: { color: accentColor, transparency: 100 },
    });
    slide.addText(item.title || spec.title, {
      x: 1.05,
      y: 1.02,
      w: 10.9,
      h: 1.35,
      fontFace: "Aptos Display",
      fontSize: 44,
      bold: true,
      color: titleColor,
      margin: 0,
      breakLine: false,
      fit: "shrink",
    });
    slide.addText((item.bullets || []).slice(0, 3).join("\n"), {
      x: 1.08,
      y: 2.68,
      w: 9.5,
      h: 1.6,
      fontFace: "Aptos",
      fontSize: 20,
      color: bodyColor,
      breakLine: false,
      fit: "shrink",
    });
    slide.addText("Repo constrained | local models | real files", {
      x: 1.08,
      y: 5.62,
      w: 5.8,
      h: 0.32,
      fontFace: "Aptos",
      fontSize: 12,
      color: "93C5FD",
      margin: 0,
    });
    return;
  }

  slide.addText(item.title || `Slide ${index + 1}`, {
    x: 0.65,
    y: 0.62,
    w: 11.7,
    h: 0.58,
    fontFace: "Aptos Display",
    fontSize: 26,
    bold: true,
    color: titleColor,
    margin: 0,
    fit: "shrink",
  });

  const bullets = (item.bullets || []).slice(0, 5);
  bullets.forEach((bullet, bulletIndex) => {
    const y = 1.62 + bulletIndex * 0.82;
    slide.addShape(pptx.ShapeType.roundRect, {
      x: 0.72,
      y,
      w: 0.32,
      h: 0.32,
      rectRadius: 0.06,
      fill: { color: bulletIndex % 2 === 0 ? accentColor : "16A34A" },
      line: { color: "FFFFFF", transparency: 100 },
    });
    slide.addText(String(bullet), {
      x: 1.22,
      y: y - 0.04,
      w: 10.75,
      h: 0.42,
      fontFace: "Aptos",
      fontSize: 16.2,
      color: bodyColor,
      fit: "shrink",
      margin: 0,
      breakLine: false,
    });
  });

  slide.addShape(pptx.ShapeType.rect, {
    x: 9.85,
    y: 5.55,
    w: 2.55,
    h: 0.54,
    fill: { color: "ECFEFF" },
    line: { color: "BAE6FD", pt: 0.8 },
  });
  slide.addText(`Run ${String(index).padStart(2, "0")}`, {
    x: 10.08,
    y: 5.72,
    w: 2.1,
    h: 0.16,
    fontFace: "Aptos",
    fontSize: 9,
    bold: true,
    color: "0369A1",
    align: "center",
    margin: 0,
  });
});

mkdirSync(path.dirname(outputPath), { recursive: true });
await pptx.writeFile({ fileName: outputPath });
if (!existsSync(outputPath)) throw new Error(`PPTX was not written: ${outputPath}`);
