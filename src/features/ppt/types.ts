export type HexColor = `#${string}`;
export type ElementType = "TEXT" | "IMAGE" | "SHAPE" | "TABLE" | "CHART" | "MEDIA" | "GROUP";

export interface CanvasSize {
  width: number;
  height: number;
}

export interface PresentationTheme {
  name: string;
  colors: {
    background: HexColor;
    surface: HexColor;
    text: HexColor;
    mutedText: HexColor;
    accent1: HexColor;
    accent2: HexColor;
  };
  fonts: {
    heading: string;
    body: string;
    mono: string;
  };
}

export type SlideBackground =
  | { type: "SOLID"; color: HexColor }
  | { type: "GRADIENT"; angle: number; stops: Array<{ offset: number; color: HexColor }> }
  | { type: "IMAGE"; assetId: string; opacity: number; fit: "COVER" | "CONTAIN" | "STRETCH" };

export interface ElementGeometry {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  opacity: number;
  isLocked: boolean;
  isHidden: boolean;
}

export interface TextElement extends ElementGeometry {
  type: "TEXT";
  text: string;
  style: {
    fontFamily: string;
    fontSize: number;
    color: HexColor;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    align: "LEFT" | "CENTER" | "RIGHT" | "JUSTIFY";
    verticalAlign: "TOP" | "MIDDLE" | "BOTTOM";
  };
}

export interface ImageElement extends ElementGeometry {
  type: "IMAGE";
  assetId: string;
  alt: string;
  fit: "COVER" | "CONTAIN" | "STRETCH";
}

export interface ShapeElement extends ElementGeometry {
  type: "SHAPE";
  shapeType: "RECT" | "ROUND_RECT" | "ELLIPSE" | "TRIANGLE" | "LINE" | "CHEVRON";
  fill: HexColor;
  stroke: HexColor;
  strokeWidth: number;
}

export interface TableCell {
  text: string;
  fill?: HexColor;
}

export interface TableElement extends ElementGeometry {
  type: "TABLE";
  rows: TableCell[][];
  borderColor: HexColor;
}

export interface ChartSeries {
  name: string;
  values: number[];
  color?: HexColor;
}

export interface ChartElement extends ElementGeometry {
  type: "CHART";
  chartType: "BAR" | "LINE" | "PIE" | "DOUGHNUT" | "AREA";
  categories: string[];
  series: ChartSeries[];
  showLegend: boolean;
}

export interface MediaElement extends ElementGeometry {
  type: "MEDIA";
  mediaType: "AUDIO" | "VIDEO" | "ONLINE";
  assetId?: string;
  url?: string;
  posterAssetId?: string;
}

export interface GroupElement extends ElementGeometry {
  type: "GROUP";
  childElementIds: string[];
}

export type SlideElement =
  | TextElement
  | ImageElement
  | ShapeElement
  | TableElement
  | ChartElement
  | MediaElement
  | GroupElement;

export interface ElementAnimation {
  id: string;
  targetElementId: string;
  category: "ENTRANCE" | "EMPHASIS" | "EXIT" | "MOTION_PATH";
  effect: string;
  trigger: "ON_CLICK" | "WITH_PREVIOUS" | "AFTER_PREVIOUS";
  order: number;
  durationMs: number;
  delayMs: number;
}

export interface SlideTransition {
  effect: "NONE" | "FADE" | "DISSOLVE" | "PUSH" | "WIPE" | "MORPH";
  durationMs: number;
  advanceOnClick: boolean;
  advanceAfterMs?: number;
}

export interface SlideDocument {
  id: string;
  order: number;
  layoutId?: string;
  background: SlideBackground;
  elements: SlideElement[];
  animations: ElementAnimation[];
  transition?: SlideTransition;
  notes?: string;
}

export interface PresentationDocument {
  schemaVersion: 1;
  presentationId: string;
  revision: number;
  title: string;
  aspectRatio: "16:9" | "4:3" | "CUSTOM";
  canvas: CanvasSize;
  theme: PresentationTheme;
  slides: SlideDocument[];
  metadata: {
    templateId?: string;
    language: string;
    createdAt: string;
    updatedAt: string;
  };
}


export class PresentationContractError extends Error {
  readonly code = "PPT_DOCUMENT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "PresentationContractError";
  }
}


type JsonObject = Record<string, unknown>;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;
const BASE_ELEMENT_KEYS = [
  "type",
  "id",
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "zIndex",
  "opacity",
  "isLocked",
  "isHidden",
] as const;


function invalid(path: string, message: string): never {
  throw new PresentationContractError(`${path}: ${message}`);
}


function objectAt(value: unknown, path: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "must be an object");
  }
  return value as JsonObject;
}


function arrayAt(value: unknown, path: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    invalid(path, `must contain ${min}-${max} items`);
  }
  return value;
}


function exactKeys(value: JsonObject, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
  if (unknown.length > 0) {
    invalid(path, `unknown field ${unknown[0]}`);
  }
}


function stringAt(value: unknown, path: string, min = 0, max = 100_000): string {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    invalid(path, `must be a string with length ${min}-${max}`);
  }
  return value;
}


function numberAt(value: unknown, path: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    invalid(path, `must be a finite number between ${min} and ${max}`);
  }
  return value;
}


function integerAt(value: unknown, path: string, min: number, max: number): number {
  const number = numberAt(value, path, min, max);
  if (!Number.isInteger(number)) invalid(path, "must be an integer");
  return number;
}


function booleanAt(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path, "must be a boolean");
  return value;
}


function enumAt<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== "string" || !(values as readonly string[]).includes(value)) {
    invalid(path, `must be one of ${values.join(", ")}`);
  }
  return value as T;
}


function identifierAt(value: unknown, path: string): string {
  const identifier = stringAt(value, path, 1, 128);
  if (!IDENTIFIER.test(identifier)) invalid(path, "is not a valid identifier");
  return identifier;
}


function colorAt(value: unknown, path: string): HexColor {
  const color = stringAt(value, path, 7, 7);
  if (!HEX_COLOR.test(color)) invalid(path, "must be a six-digit hex color");
  return color as HexColor;
}


function optionalIdentifier(value: unknown, path: string): void {
  if (value !== undefined) identifierAt(value, path);
}


function validateCanvas(value: unknown): void {
  const canvas = objectAt(value, "canvas");
  exactKeys(canvas, ["width", "height"], "canvas");
  numberAt(canvas.width, "canvas.width", Number.MIN_VALUE, 100);
  numberAt(canvas.height, "canvas.height", Number.MIN_VALUE, 100);
}


function validateTheme(value: unknown): void {
  const theme = objectAt(value, "theme");
  exactKeys(theme, ["name", "colors", "fonts"], "theme");
  stringAt(theme.name, "theme.name", 1, 128);
  const colors = objectAt(theme.colors, "theme.colors");
  exactKeys(colors, ["background", "surface", "text", "mutedText", "accent1", "accent2"], "theme.colors");
  for (const [key, color] of Object.entries(colors)) colorAt(color, `theme.colors.${key}`);
  const fonts = objectAt(theme.fonts, "theme.fonts");
  exactKeys(fonts, ["heading", "body", "mono"], "theme.fonts");
  for (const [key, font] of Object.entries(fonts)) stringAt(font, `theme.fonts.${key}`, 1, 128);
}


function validateBackground(value: unknown, path: string): void {
  const background = objectAt(value, path);
  const type = enumAt(background.type, ["SOLID", "GRADIENT", "IMAGE"] as const, `${path}.type`);
  if (type === "SOLID") {
    exactKeys(background, ["type", "color"], path);
    colorAt(background.color, `${path}.color`);
  } else if (type === "GRADIENT") {
    exactKeys(background, ["type", "angle", "stops"], path);
    numberAt(background.angle, `${path}.angle`, 0, 360);
    const stops = arrayAt(background.stops, `${path}.stops`, 2, 8);
    let previous = -1;
    stops.forEach((stop, index) => {
      const item = objectAt(stop, `${path}.stops[${index}]`);
      exactKeys(item, ["offset", "color"], `${path}.stops[${index}]`);
      const offset = numberAt(item.offset, `${path}.stops[${index}].offset`, 0, 1);
      if (offset < previous) invalid(path, "gradient stops must be ordered");
      previous = offset;
      colorAt(item.color, `${path}.stops[${index}].color`);
    });
  } else {
    exactKeys(background, ["type", "assetId", "opacity", "fit"], path);
    identifierAt(background.assetId, `${path}.assetId`);
    numberAt(background.opacity, `${path}.opacity`, 0, 1);
    enumAt(background.fit, ["COVER", "CONTAIN", "STRETCH"] as const, `${path}.fit`);
  }
}


function validateGeometry(element: JsonObject, path: string): void {
  identifierAt(element.id, `${path}.id`);
  const x = numberAt(element.x, `${path}.x`, 0, 1);
  const y = numberAt(element.y, `${path}.y`, 0, 1);
  const width = numberAt(element.width, `${path}.width`, Number.MIN_VALUE, 1);
  const height = numberAt(element.height, `${path}.height`, Number.MIN_VALUE, 1);
  if (x + width > 1 + Number.EPSILON || y + height > 1 + Number.EPSILON) {
    invalid(path, "element geometry must remain inside normalized canvas");
  }
  numberAt(element.rotation, `${path}.rotation`, -360, 360);
  integerAt(element.zIndex, `${path}.zIndex`, 0, 100_000);
  numberAt(element.opacity, `${path}.opacity`, 0, 1);
  booleanAt(element.isLocked, `${path}.isLocked`);
  booleanAt(element.isHidden, `${path}.isHidden`);
}


function validateTextStyle(value: unknown, path: string): void {
  const style = objectAt(value, path);
  exactKeys(style, ["fontFamily", "fontSize", "color", "bold", "italic", "underline", "align", "verticalAlign"], path);
  stringAt(style.fontFamily, `${path}.fontFamily`, 1, 128);
  numberAt(style.fontSize, `${path}.fontSize`, Number.MIN_VALUE, 400);
  colorAt(style.color, `${path}.color`);
  booleanAt(style.bold, `${path}.bold`);
  booleanAt(style.italic, `${path}.italic`);
  booleanAt(style.underline, `${path}.underline`);
  enumAt(style.align, ["LEFT", "CENTER", "RIGHT", "JUSTIFY"] as const, `${path}.align`);
  enumAt(style.verticalAlign, ["TOP", "MIDDLE", "BOTTOM"] as const, `${path}.verticalAlign`);
}


function validateElement(value: unknown, path: string): void {
  const element = objectAt(value, path);
  const type = enumAt(element.type, ["TEXT", "IMAGE", "SHAPE", "TABLE", "CHART", "MEDIA", "GROUP"] as const, `${path}.type`);
  validateGeometry(element, path);
  if (type === "TEXT") {
    exactKeys(element, [...BASE_ELEMENT_KEYS, "text", "style"], path);
    stringAt(element.text, `${path}.text`, 0, 100_000);
    validateTextStyle(element.style, `${path}.style`);
  } else if (type === "IMAGE") {
    exactKeys(element, [...BASE_ELEMENT_KEYS, "assetId", "alt", "fit"], path);
    identifierAt(element.assetId, `${path}.assetId`);
    stringAt(element.alt, `${path}.alt`, 0, 1_000);
    enumAt(element.fit, ["COVER", "CONTAIN", "STRETCH"] as const, `${path}.fit`);
  } else if (type === "SHAPE") {
    exactKeys(element, [...BASE_ELEMENT_KEYS, "shapeType", "fill", "stroke", "strokeWidth"], path);
    enumAt(element.shapeType, ["RECT", "ROUND_RECT", "ELLIPSE", "TRIANGLE", "LINE", "CHEVRON"] as const, `${path}.shapeType`);
    colorAt(element.fill, `${path}.fill`);
    colorAt(element.stroke, `${path}.stroke`);
    numberAt(element.strokeWidth, `${path}.strokeWidth`, 0, 100);
  } else if (type === "TABLE") {
    exactKeys(element, [...BASE_ELEMENT_KEYS, "rows", "borderColor"], path);
    const rows = arrayAt(element.rows, `${path}.rows`, 1, 1_000);
    let columns: number | undefined;
    rows.forEach((row, rowIndex) => {
      const cells = arrayAt(row, `${path}.rows[${rowIndex}]`, 1, 50);
      if (columns !== undefined && cells.length !== columns) invalid(path, "table rows must have equal length");
      columns = cells.length;
      cells.forEach((cell, cellIndex) => {
        const item = objectAt(cell, `${path}.rows[${rowIndex}][${cellIndex}]`);
        exactKeys(item, ["text", "fill"], `${path}.rows[${rowIndex}][${cellIndex}]`);
        stringAt(item.text, `${path}.rows[${rowIndex}][${cellIndex}].text`, 0, 20_000);
        if (item.fill !== undefined) colorAt(item.fill, `${path}.rows[${rowIndex}][${cellIndex}].fill`);
      });
    });
    colorAt(element.borderColor, `${path}.borderColor`);
  } else if (type === "CHART") {
    exactKeys(element, [...BASE_ELEMENT_KEYS, "chartType", "categories", "series", "showLegend"], path);
    enumAt(element.chartType, ["BAR", "LINE", "PIE", "DOUGHNUT", "AREA"] as const, `${path}.chartType`);
    const categories = arrayAt(element.categories, `${path}.categories`, 1, 1_000);
    categories.forEach((category, index) => stringAt(category, `${path}.categories[${index}]`, 0, 10_000));
    const series = arrayAt(element.series, `${path}.series`, 1, 50);
    series.forEach((entry, index) => {
      const item = objectAt(entry, `${path}.series[${index}]`);
      exactKeys(item, ["name", "values", "color"], `${path}.series[${index}]`);
      stringAt(item.name, `${path}.series[${index}].name`, 1, 500);
      const values = arrayAt(item.values, `${path}.series[${index}].values`, 1, 1_000);
      if (values.length !== categories.length) invalid(path, "chart series values must align with categories");
      values.forEach((number, valueIndex) => numberAt(number, `${path}.series[${index}].values[${valueIndex}]`, -Number.MAX_VALUE, Number.MAX_VALUE));
      if (item.color !== undefined) colorAt(item.color, `${path}.series[${index}].color`);
    });
    booleanAt(element.showLegend, `${path}.showLegend`);
  } else if (type === "MEDIA") {
    exactKeys(element, [...BASE_ELEMENT_KEYS, "mediaType", "assetId", "url", "posterAssetId"], path);
    const mediaType = enumAt(element.mediaType, ["AUDIO", "VIDEO", "ONLINE"] as const, `${path}.mediaType`);
    optionalIdentifier(element.assetId, `${path}.assetId`);
    optionalIdentifier(element.posterAssetId, `${path}.posterAssetId`);
    if (mediaType === "ONLINE") {
      const url = stringAt(element.url, `${path}.url`, 1, 2_048);
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        invalid(`${path}.url`, "must be a valid HTTPS URL");
      }
      if (parsed.protocol !== "https:") invalid(`${path}.url`, "must use HTTPS");
      if (element.assetId !== undefined) invalid(path, "online media cannot include assetId");
    } else if (element.assetId === undefined || element.url !== undefined) {
      invalid(path, "audio and video require assetId and no URL");
    }
  } else {
    exactKeys(element, [...BASE_ELEMENT_KEYS, "childElementIds"], path);
    const childIds = arrayAt(element.childElementIds, `${path}.childElementIds`, 1, 250)
      .map((child, index) => identifierAt(child, `${path}.childElementIds[${index}]`));
    if (new Set(childIds).size !== childIds.length) invalid(path, "group child ids must be unique");
    if (childIds.includes(element.id as string)) invalid(path, "a group cannot contain itself");
  }
}


function validateAnimation(value: unknown, path: string): void {
  const animation = objectAt(value, path);
  exactKeys(animation, ["id", "targetElementId", "category", "effect", "trigger", "order", "durationMs", "delayMs"], path);
  identifierAt(animation.id, `${path}.id`);
  identifierAt(animation.targetElementId, `${path}.targetElementId`);
  enumAt(animation.category, ["ENTRANCE", "EMPHASIS", "EXIT", "MOTION_PATH"] as const, `${path}.category`);
  const effect = stringAt(animation.effect, `${path}.effect`, 1, 64);
  if (!/^[A-Z][A-Z0-9_]*$/.test(effect)) invalid(`${path}.effect`, "must be an uppercase effect id");
  enumAt(animation.trigger, ["ON_CLICK", "WITH_PREVIOUS", "AFTER_PREVIOUS"] as const, `${path}.trigger`);
  integerAt(animation.order, `${path}.order`, 0, 10_000);
  integerAt(animation.durationMs, `${path}.durationMs`, 1, 60_000);
  integerAt(animation.delayMs, `${path}.delayMs`, 0, 3_600_000);
}


function validateTransition(value: unknown, path: string): void {
  const transition = objectAt(value, path);
  exactKeys(transition, ["effect", "durationMs", "advanceOnClick", "advanceAfterMs"], path);
  enumAt(transition.effect, ["NONE", "FADE", "DISSOLVE", "PUSH", "WIPE", "MORPH"] as const, `${path}.effect`);
  integerAt(transition.durationMs, `${path}.durationMs`, 0, 60_000);
  booleanAt(transition.advanceOnClick, `${path}.advanceOnClick`);
  if (transition.advanceAfterMs !== undefined) integerAt(transition.advanceAfterMs, `${path}.advanceAfterMs`, 0, 3_600_000);
}


function validateSlide(value: unknown, index: number): void {
  const path = `slides[${index}]`;
  const slide = objectAt(value, path);
  exactKeys(slide, ["id", "order", "layoutId", "background", "elements", "animations", "transition", "notes"], path);
  identifierAt(slide.id, `${path}.id`);
  integerAt(slide.order, `${path}.order`, 0, 10_000);
  optionalIdentifier(slide.layoutId, `${path}.layoutId`);
  validateBackground(slide.background, `${path}.background`);
  const elements = arrayAt(slide.elements, `${path}.elements`, 0, 250);
  elements.forEach((element, elementIndex) => validateElement(element, `${path}.elements[${elementIndex}]`));
  const elementIds = elements.map((element) => (element as JsonObject).id as string);
  if (new Set(elementIds).size !== elementIds.length) invalid(path, "element ids must be unique");
  for (const element of elements) {
    const item = element as JsonObject;
    if (item.type === "GROUP") {
      const missing = (item.childElementIds as string[]).filter((id) => !elementIds.includes(id));
      if (missing.length > 0) invalid(path, `group references missing element ${missing[0]}`);
    }
  }
  const animations = arrayAt(slide.animations, `${path}.animations`, 0, 500);
  animations.forEach((animation, animationIndex) => validateAnimation(animation, `${path}.animations[${animationIndex}]`));
  const animationIds = animations.map((animation) => (animation as JsonObject).id as string);
  if (new Set(animationIds).size !== animationIds.length) invalid(path, "animation ids must be unique");
  for (const animation of animations) {
    const target = (animation as JsonObject).targetElementId as string;
    if (!elementIds.includes(target)) invalid(path, `animation target does not exist: ${target}`);
  }
  if (slide.transition !== undefined) validateTransition(slide.transition, `${path}.transition`);
  if (slide.notes !== undefined) stringAt(slide.notes, `${path}.notes`, 0, 100_000);
}


function validateMetadata(value: unknown): void {
  const metadata = objectAt(value, "metadata");
  exactKeys(metadata, ["templateId", "language", "createdAt", "updatedAt"], "metadata");
  optionalIdentifier(metadata.templateId, "metadata.templateId");
  const language = stringAt(metadata.language, "metadata.language", 2, 35);
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) invalid("metadata.language", "is invalid");
  const createdAt = stringAt(metadata.createdAt, "metadata.createdAt", 1, 100);
  const updatedAt = stringAt(metadata.updatedAt, "metadata.updatedAt", 1, 100);
  const created = Date.parse(createdAt);
  const updated = Date.parse(updatedAt);
  if (!Number.isFinite(created) || !Number.isFinite(updated)) invalid("metadata", "timestamps must be ISO-8601");
  if (updated < created) invalid("metadata.updatedAt", "cannot precede createdAt");
}


export function parsePresentationDocumentV1(value: unknown): PresentationDocument {
  const document = objectAt(value, "document");
  exactKeys(document, ["schemaVersion", "presentationId", "revision", "title", "aspectRatio", "canvas", "theme", "slides", "metadata"], "document");
  if (document.schemaVersion !== 1) invalid("document.schemaVersion", "must equal 1");
  identifierAt(document.presentationId, "document.presentationId");
  integerAt(document.revision, "document.revision", 0, Number.MAX_SAFE_INTEGER);
  stringAt(document.title, "document.title", 1, 500);
  const aspectRatio = enumAt(document.aspectRatio, ["16:9", "4:3", "CUSTOM"] as const, "document.aspectRatio");
  validateCanvas(document.canvas);
  const canvas = document.canvas as JsonObject;
  const ratio = (canvas.width as number) / (canvas.height as number);
  if (aspectRatio === "16:9" && Math.abs(ratio - 16 / 9) > 0.01) invalid("canvas", "does not match 16:9 aspect ratio");
  if (aspectRatio === "4:3" && Math.abs(ratio - 4 / 3) > 0.01) invalid("canvas", "does not match 4:3 aspect ratio");
  validateTheme(document.theme);
  const slides = arrayAt(document.slides, "slides", 1, 200);
  slides.forEach(validateSlide);
  const slideIds = slides.map((slide) => (slide as JsonObject).id as string);
  if (new Set(slideIds).size !== slideIds.length) invalid("slides", "slide ids must be unique");
  slides.forEach((slide, index) => {
    if ((slide as JsonObject).order !== index) invalid(`slides[${index}].order`, "must match array order");
  });
  validateMetadata(document.metadata);
  return value as PresentationDocument;
}
