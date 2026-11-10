import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const target = resolve(root, "public", "ocr");
mkdirSync(resolve(target, "core"), { recursive: true });
mkdirSync(resolve(target, "lang"), { recursive: true });
copyFileSync(resolve(root, "node_modules/tesseract.js/dist/worker.min.js"), resolve(target, "worker.min.js"));
for (const name of ["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"]) {
  copyFileSync(resolve(root, "node_modules/tesseract.js-core", name), resolve(target, "core", name));
}
copyFileSync(resolve(root, "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"), resolve(target, "lang/eng.traineddata.gz"));
copyFileSync(resolve(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"), resolve(target, "pdf.worker.min.mjs"));
