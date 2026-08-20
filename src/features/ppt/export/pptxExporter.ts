import PptxGenJS from "pptxgenjs";


const MAX_SLIDES = 100;
const MAX_ELEMENTS_PER_SLIDE = 250;
const MAX_TEXT_LENGTH = 50_000;
const MAX_IMAGE_DATA_LENGTH = 14_000_000;

type HexColor = string;

interface PositionedElement {
  x: number;
  y: number;
  w: number;
  h: number;
  name?: string;
}

export interface PptxTextElement extends PositionedElement {
  kind: "text";
  text: string;
  fontSize?: number;
  fontFace?: string;
  color?: HexColor;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right" | "justify";
}

export interface PptxShapeElement extends PositionedElement {
  kind: "shape";
  shape: "rect" | "roundRect" | "ellipse" | "triangle" | "line" | "chevron";
  fill?: HexColor;
  line?: HexColor;
  transparency?: number;
}

export interface PptxImageElement extends PositionedElement {
  kind: "image";
  /** Pre-fetched, validated PNG/JPEG/WebP. Remote URLs never reach PptxGenJS. */
  data: string;
  alt?: string;
}

export interface PptxTableElement extends PositionedElement {
  kind: "table";
  rows: string[][];
  borderColor?: HexColor;
  headerFill?: HexColor;
}

export interface PptxChartSeries {
  name: string;
  labels: string[];
  values: number[];
}

export interface PptxChartElement extends PositionedElement {
  kind: "chart";
  chartType: "bar" | "line" | "pie" | "doughnut" | "area";
  series: PptxChartSeries[];
  showLegend?: boolean;
}

export interface PptxMediaElement extends PositionedElement {
  kind: "media";
  mediaType: "online";
  /** Only HTTPS YouTube embed links are accepted by this browser-safe exporter. */
  link: string;
  cover?: string;
}

export type PptxElement =
  | PptxTextElement
  | PptxShapeElement
  | PptxImageElement
  | PptxTableElement
  | PptxChartElement
  | PptxMediaElement;

export interface PptxSlideDocument {
  background?: HexColor;
  notes?: string;
  elements: PptxElement[];
}

export interface PptxDocument {
  title: string;
  author?: string;
  subject?: string;
  company?: string;
  language?: string;
  slides: PptxSlideDocument[];
}


export class PptxExportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PptxExportValidationError";
  }
}


function assertHexColor(value: string | undefined, field: string): void {
  if (value !== undefined && !/^[0-9A-F]{6}$/i.test(value)) {
    throw new PptxExportValidationError(`${field} must be a six-digit hex color`);
  }
}


function assertPosition(element: PositionedElement, location: string): void {
  const values = [element.x, element.y, element.w, element.h];
  if (!values.every(Number.isFinite) || element.x < 0 || element.y < 0 || element.w <= 0 || element.h <= 0) {
    throw new PptxExportValidationError(`${location} has an invalid position or size`);
  }
}


function decodedImageHeader(data: string): Uint8Array {
  const comma = data.indexOf(",");
  if (comma < 0 || data.length > MAX_IMAGE_DATA_LENGTH) {
    throw new PptxExportValidationError("image data is malformed or too large");
  }
  try {
    const binary = atob(data.slice(comma + 1, comma + 1 + 24));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new PptxExportValidationError("image data is not valid base64");
  }
}


function assertSafeImageData(data: string): void {
  const match = /^data:image\/(png|jpeg|webp);base64,/i.exec(data);
  if (!match) {
    throw new PptxExportValidationError("images must be PNG, JPEG, or WebP data URLs");
  }
  const header = decodedImageHeader(data);
  const isPng = header.length >= 8
    && header[0] === 0x89
    && header[1] === 0x50
    && header[2] === 0x4e
    && header[3] === 0x47;
  const isJpeg = header.length >= 3
    && header[0] === 0xff
    && header[1] === 0xd8
    && header[2] === 0xff;
  const isWebp = header.length >= 12
    && String.fromCharCode(...header.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...header.slice(8, 12)) === "WEBP";
  if (!isPng && !isJpeg && !isWebp) {
    throw new PptxExportValidationError("image MIME type does not match its binary signature");
  }
}


function assertSafeMediaLink(link: string): void {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new PptxExportValidationError("media link is not a valid URL");
  }
  const allowedHosts = new Set(["www.youtube.com", "youtube.com", "www.youtube-nocookie.com"]);
  if (url.protocol !== "https:" || !allowedHosts.has(url.hostname) || !url.pathname.startsWith("/embed/")) {
    throw new PptxExportValidationError("media link must be an HTTPS YouTube embed URL");
  }
}


function validateDocument(document: PptxDocument): void {
  if (!document.title.trim() || document.title.length > 500) {
    throw new PptxExportValidationError("presentation title is required and must be at most 500 characters");
  }
  if (document.slides.length < 1 || document.slides.length > MAX_SLIDES) {
    throw new PptxExportValidationError(`presentation must contain 1-${MAX_SLIDES} slides`);
  }

  document.slides.forEach((slide, slideIndex) => {
    assertHexColor(slide.background, `slide ${slideIndex + 1} background`);
    if (slide.notes && slide.notes.length > MAX_TEXT_LENGTH) {
      throw new PptxExportValidationError(`slide ${slideIndex + 1} notes are too long`);
    }
    if (slide.elements.length > MAX_ELEMENTS_PER_SLIDE) {
      throw new PptxExportValidationError(`slide ${slideIndex + 1} contains too many elements`);
    }

    slide.elements.forEach((element, elementIndex) => {
      const location = `slide ${slideIndex + 1} element ${elementIndex + 1}`;
      assertPosition(element, location);
      if (element.kind === "text") {
        if (element.text.length > MAX_TEXT_LENGTH) {
          throw new PptxExportValidationError(`${location} text is too long`);
        }
        assertHexColor(element.color, `${location} color`);
      } else if (element.kind === "shape") {
        assertHexColor(element.fill, `${location} fill`);
        assertHexColor(element.line, `${location} line`);
      } else if (element.kind === "image") {
        assertSafeImageData(element.data);
      } else if (element.kind === "table") {
        if (element.rows.length === 0 || element.rows.length > 1_000 || element.rows.some((row) => row.length === 0 || row.length > 50)) {
          throw new PptxExportValidationError(`${location} table dimensions are invalid`);
        }
        assertHexColor(element.borderColor, `${location} border color`);
        assertHexColor(element.headerFill, `${location} header fill`);
      } else if (element.kind === "chart") {
        if (element.series.length === 0 || element.series.length > 50) {
          throw new PptxExportValidationError(`${location} chart series are invalid`);
        }
        for (const series of element.series) {
          if (series.labels.length !== series.values.length || series.labels.length === 0 || series.labels.length > 1_000) {
            throw new PptxExportValidationError(`${location} chart labels and values must align`);
          }
          if (!series.values.every(Number.isFinite)) {
            throw new PptxExportValidationError(`${location} chart values must be finite numbers`);
          }
        }
      } else if (element.kind === "media") {
        assertSafeMediaLink(element.link);
      }
    });
  });
}


export function buildPptxPresentation(document: PptxDocument): PptxGenJS {
  validateDocument(document);
  const presentation = new PptxGenJS();
  presentation.layout = "LAYOUT_WIDE";
  presentation.title = document.title;
  presentation.author = document.author ?? "AI Agent";
  presentation.subject = document.subject ?? "AI-generated presentation";
  presentation.company = document.company ?? "";

  for (const slideDocument of document.slides) {
    const slide = presentation.addSlide();
    if (slideDocument.background) {
      slide.background = { color: slideDocument.background };
    }
    if (slideDocument.notes) {
      slide.addNotes(slideDocument.notes);
    }

    for (const element of slideDocument.elements) {
      const position = {
        x: element.x,
        y: element.y,
        w: element.w,
        h: element.h,
        objectName: element.name,
      };
      switch (element.kind) {
        case "text":
          slide.addText(element.text, {
            ...position,
            fontSize: element.fontSize,
            fontFace: element.fontFace,
            color: element.color,
            bold: element.bold,
            italic: element.italic,
            align: element.align,
            lang: document.language ?? "zh-CN",
            margin: 0,
          });
          break;
        case "shape":
          slide.addShape(presentation.ShapeType[element.shape], {
            ...position,
            fill: element.fill
              ? { color: element.fill, transparency: element.transparency }
              : undefined,
            line: element.line ? { color: element.line } : undefined,
          });
          break;
        case "image":
          slide.addImage({ ...position, data: element.data, altText: element.alt });
          break;
        case "table":
          slide.addTable(element.rows.map((row, rowIndex) => row.map((text) => ({
            text,
            options: rowIndex === 0 && element.headerFill
              ? { fill: { color: element.headerFill } }
              : undefined,
          }))), {
            ...position,
            border: element.borderColor
              ? { type: "solid", color: element.borderColor, pt: 1 }
              : undefined,
            fill: { color: "FFFFFF" },
            color: "1A1D26",
            margin: 0.08,
            rowH: element.h / element.rows.length,
          });
          break;
        case "chart":
          slide.addChart(presentation.ChartType[element.chartType], element.series, {
            ...position,
            showLegend: element.showLegend ?? true,
            showTitle: false,
            showValue: false,
          });
          break;
        case "media":
          slide.addMedia({
            ...position,
            type: element.mediaType,
            link: element.link,
            cover: element.cover,
          });
          break;
      }
    }
  }

  return presentation;
}


export async function writePptxFile(document: PptxDocument, fileName: string): Promise<string> {
  const presentation = buildPptxPresentation(document);
  return presentation.writeFile({ fileName, compression: true });
}


export async function exportPptxBlob(document: PptxDocument): Promise<Blob> {
  const presentation = buildPptxPresentation(document);
  const output = await presentation.write({ outputType: "blob", compression: true });
  if (!(output instanceof Blob)) {
    throw new Error("PptxGenJS did not return a browser Blob");
  }
  return output;
}
