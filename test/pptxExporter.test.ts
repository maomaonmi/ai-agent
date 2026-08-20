import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import JSZip from "jszip";

import {
  type PptxDocument,
  writePptxFile,
} from "../src/features/ppt/export/pptxExporter.ts";


const ONE_PIXEL_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";


test("exports every editor element family to a valid pptx package", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "ppt-exporter-"));
  const output = path.join(directory, "all-elements.pptx");
  const document: PptxDocument = {
    title: "AI PPT export proof",
    author: "AI Agent",
    slides: [
      {
        background: "F7F8FC",
        notes: "Speaker note for the generated slide.",
        elements: [
          {
            kind: "text",
            text: "Agent-built presentation",
            x: 0.7,
            y: 0.5,
            w: 5.8,
            h: 0.5,
            fontSize: 24,
            bold: true,
          },
          {
            kind: "shape",
            shape: "roundRect",
            x: 0.7,
            y: 1.3,
            w: 2.2,
            h: 1.0,
            fill: "7657FF",
          },
          {
            kind: "image",
            data: ONE_PIXEL_PNG,
            x: 3.2,
            y: 1.3,
            w: 1.4,
            h: 1.0,
          },
          {
            kind: "table",
            rows: [["Stage", "Status"], ["Research", "Done"]],
            x: 0.7,
            y: 2.7,
            w: 4.1,
            h: 1.2,
          },
          {
            kind: "chart",
            chartType: "bar",
            series: [{ name: "Sources", labels: ["Web", "AI"], values: [3, 3] }],
            x: 5.1,
            y: 1.3,
            w: 3.7,
            h: 2.7,
          },
          {
            kind: "media",
            mediaType: "online",
            link: "https://www.youtube.com/embed/dQw4w9WgXcQ",
            x: 9.1,
            y: 1.3,
            w: 3.2,
            h: 2.0,
          },
        ],
      },
    ],
  };

  try {
    await writePptxFile(document, output);
    const archive = await JSZip.loadAsync(await readFile(output));
    assert.ok(archive.file("ppt/slides/slide1.xml"));
    assert.ok(archive.file("ppt/charts/chart1.xml"));
    assert.ok(archive.file("ppt/notesSlides/notesSlide1.xml"));
    assert.ok(Object.keys(archive.files).some((name) => /^ppt\/media\/.*\.png$/i.test(name)));
    assert.ok(archive.file("ppt/slides/_rels/slide1.xml.rels"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
