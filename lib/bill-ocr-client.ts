"use client";

import type { ScannedBill } from "./bills";
import { parseBillText } from "./bill-text";

type Progress = (message: string) => void;
type Reading = { text: string; confidence: number };
let workerPromise: ReturnType<typeof import("tesseract.js")["createWorker"]> | null = null;

async function ocr(canvas: HTMLCanvasElement, progress: Progress, degrees = 0): Promise<Reading> {
  progress("Loading the on-device text reader…");
  const { createWorker } = await import("tesseract.js");
  if (!workerPromise) workerPromise = createWorker("eng", 1, {
    workerPath: "/ocr/worker.min.js",
    corePath: "/ocr/core",
    langPath: "/ocr/lang",
    cacheMethod: "write",
  });
  let worker;
  try { worker = await workerPromise; }
  catch (error) { workerPromise = null; throw error; }
  progress(degrees ? `Reading the bill at ${degrees}°…` : "Reading text on this device…");
  const result = await worker.recognize(canvas);
  return { text: result.data.text, confidence: result.data.confidence };
}

function rotatedCanvas(source: HTMLCanvasElement, degrees: 90 | 180 | 270) {
  const canvas = document.createElement("canvas");
  const sideways = degrees !== 180;
  canvas.width = sideways ? source.height : source.width;
  canvas.height = sideways ? source.width : source.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot rotate the bill image.");
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(degrees * Math.PI / 180);
  context.drawImage(source, -source.width / 2, -source.height / 2);
  return canvas;
}

function readingScore(reading: Reading) {
  const bill = parseBillText(reading.text);
  const wordCount = reading.text.match(/[a-z]{3,}/gi)?.length || 0;
  return (bill.total > 0 ? 100 : 0) + reading.confidence + Math.min(wordCount, 20);
}

async function ocrWithOrientation(canvas: HTMLCanvasElement, progress: Progress) {
  let best = await ocr(canvas, progress);
  if (parseBillText(best.text).total > 0 && best.confidence >= 50) return best.text;

  for (const degrees of [90, 270, 180] as const) {
    const candidate = await ocr(rotatedCanvas(canvas, degrees), progress, degrees);
    if (readingScore(candidate) > readingScore(best)) best = candidate;
    if (parseBillText(best.text).total > 0 && best.confidence >= 50) break;
  }
  return best.text;
}

function scaledCanvas(width: number, height: number, maxEdge = 1800) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  return canvas;
}

async function imageText(file: File, progress: Progress) {
  progress("Preparing the photo…");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = scaledCanvas(bitmap.width, bitmap.height);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await ocrWithOrientation(canvas, progress);
  } finally { bitmap.close(); }
}

async function pdfText(file: File, progress: Progress) {
  progress("Opening the PDF…");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = "/ocr/pdf.worker.min.mjs";
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const document = await task.promise;
  try {
    const texts: string[] = [];
    const pages = Math.min(document.numPages, 3);
    for (let index = 1; index <= pages; index++) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      const selectableText = content.items.map(item => "str" in item ? `${item.str}${item.hasEOL ? "\n" : " "}` : "").join("").trim();
      if (selectableText.length > 40) { texts.push(selectableText); continue; }
      progress(`Reading PDF page ${index} of ${pages} on this device…`);
      const viewport = page.getViewport({ scale: 1.7 });
      const canvas = scaledCanvas(viewport.width, viewport.height);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser cannot read the PDF image.");
      await page.render({ canvasContext: context, canvas, viewport: page.getViewport({ scale: canvas.width / page.getViewport({ scale: 1 }).width }) }).promise;
      texts.push(await ocrWithOrientation(canvas, progress));
    }
    return texts.join("\n");
  } finally { await task.destroy(); }
}

export async function scanBillOnDevice(file: File, progress: Progress = () => {}): Promise<ScannedBill> {
  if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type)) throw new Error("Choose a JPG, PNG, WebP, or PDF bill.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Choose a file smaller than 5 MB.");
  const text = file.type === "application/pdf" ? await pdfText(file, progress) : await imageText(file, progress);
  if (!text.trim()) throw new Error("No text found. Try a clearer photo or enter the details yourself.");
  progress("Checking the bill details…");
  return parseBillText(text);
}
