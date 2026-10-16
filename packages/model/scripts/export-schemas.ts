import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { exportSchemas } from "../src/jsonschema";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "schema");
mkdirSync(outDir, { recursive: true });
for (const [name, value] of Object.entries(exportSchemas())) {
  writeFileSync(join(outDir, name), `${JSON.stringify(value, null, 2)}\n`);
  console.log(`wrote schema/${name}`);
}
