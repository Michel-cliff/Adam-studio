import { z } from "zod";
import { FRAMEWORKS } from "./frameworks";
import { ProjectSchema } from "./schema/project";
import { StyleSchema } from "./schema/style";
import { TimelineSchema } from "./schema/timeline";

/** JSON Schemas for consumers outside TypeScript (the Python CapCut exporter). */
export function exportSchemas(): Record<string, unknown> {
  return {
    "project.schema.json": z.toJSONSchema(ProjectSchema, { io: "input", unrepresentable: "any" }),
    "style.schema.json": z.toJSONSchema(StyleSchema, { io: "input", unrepresentable: "any" }),
    "timeline.schema.json": z.toJSONSchema(TimelineSchema, { io: "output", unrepresentable: "any" }),
    "frameworks.json": FRAMEWORKS,
  };
}
