import { z } from "zod";
import { FRAMEWORKS } from "./frameworks";
import { KIND_SCHEMAS } from "./schema/kinds";
import { ProjectSchema } from "./schema/project";
import { StyleSchema } from "./schema/style";
import { TimelineSchema } from "./schema/timeline";

/** JSON Schemas for consumers outside TypeScript (the Python CapCut exporter). */
export function exportSchemas(): Record<string, unknown> {
  // Element props are opaque in the project and timeline schemas: each kind gets its own schema.
  const kinds = Object.fromEntries(
    Object.entries(KIND_SCHEMAS).map(([name, schema]) => [
      `kinds/${name}.schema.json`,
      z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }),
    ]),
  );
  return {
    ...kinds,
    "project.schema.json": z.toJSONSchema(ProjectSchema, { io: "input", unrepresentable: "any" }),
    "style.schema.json": z.toJSONSchema(StyleSchema, { io: "input", unrepresentable: "any" }),
    "timeline.schema.json": z.toJSONSchema(TimelineSchema, { io: "output", unrepresentable: "any" }),
    "frameworks.json": FRAMEWORKS,
  };
}
