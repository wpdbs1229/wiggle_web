import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
const require = createRequire(import.meta.url);
const source = dirname(require.resolve("pdfjs-dist/package.json"));
const destination = new URL("../public/pdfjs/", import.meta.url);
await mkdir(destination, { recursive: true });
for (const name of ["build/pdf.worker.min.mjs", "cmaps", "standard_fonts", "wasm", "LICENSE"]) {
  await cp(join(source, name), new URL(name.split("/").at(-1), destination), { recursive: true });
}
