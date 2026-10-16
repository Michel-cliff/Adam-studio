import { describe, expect, it } from "vitest";
import { exportSchemas } from "../src/jsonschema";

describe("exportSchemas", () => {
  it("exports the project, style and timeline schemas and the frameworks", () => {
    const out = exportSchemas();
    expect(Object.keys(out)).toEqual(expect.arrayContaining(["frameworks.json", "project.schema.json", "style.schema.json", "timeline.schema.json"]));
  });

  it("produces plain JSON Schema objects describing the main fields", () => {
    const out = exportSchemas() as Record<string, { properties?: Record<string, unknown>; required?: string[] }>;
    expect(Object.keys(out["project.schema.json"]!.properties!)).toEqual(expect.arrayContaining(["canvas", "story", "elements", "proposals"]));
    expect(out["timeline.schema.json"]!.required).toEqual(expect.arrayContaining(["clips", "elements", "captions", "audio"]));
    expect(() => JSON.stringify(out)).not.toThrow();
  });
});
