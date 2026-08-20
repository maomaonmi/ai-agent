import path from "node:path";

import {
  type PptxDocument,
  writePptxFile,
} from "../src/features/ppt/export/pptxExporter.ts";


const output = process.argv[2];
if (!output || path.extname(output).toLowerCase() !== ".pptx") {
  throw new Error("Usage: node pptxPipelineSmoke.ts <output.pptx>");
}

const onePixelPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const document: PptxDocument = {
  title: "AI PPT pipeline smoke test",
  author: "AI Agent",
  slides: [
    {
      background: "F7F8FC",
      notes: "This note proves that speaker notes survive the export pipeline.",
      elements: [
        {
          kind: "text",
          name: "Slide title",
          text: "AI PPT export pipeline",
          x: 0.8,
          y: 0.6,
          w: 6.4,
          h: 0.6,
          fontSize: 27,
          bold: true,
          color: "171923",
        },
        {
          kind: "shape",
          name: "Animated card",
          shape: "roundRect",
          x: 0.8,
          y: 1.6,
          w: 3.4,
          h: 1.5,
          fill: "7657FF",
          line: "7657FF",
        },
        {
          kind: "image",
          name: "Source image",
          data: onePixelPng,
          alt: "Validated PNG image",
          x: 4.7,
          y: 1.6,
          w: 1.6,
          h: 1.5,
        },
        {
          kind: "table",
          name: "Research table",
          rows: [["Asset", "Minimum"], ["Web images", "3"], ["AI images", "3"]],
          headerFill: "E8E3FF",
          borderColor: "D8DCE8",
          x: 0.8,
          y: 3.6,
          w: 4.6,
          h: 1.6,
        },
        {
          kind: "chart",
          name: "Asset chart",
          chartType: "bar",
          series: [{ name: "Assets", labels: ["Web", "AI"], values: [3, 3] }],
          x: 6.1,
          y: 3.2,
          w: 5.7,
          h: 2.8,
        },
      ],
    },
  ],
};

await writePptxFile(document, output);
