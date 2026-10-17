import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { TSX } from "@adam-studio/web/server/paths";
import { makeSynthetic } from "../../render/tests/e2e/synthetic";

describe("MCP server over stdio", () => {
  it("lists its tools, reads, refuses a bad write and shows a still", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adam mcp proto-"));
    makeSynthetic(dir, { withProposal: true });
    const client = new Client({ name: "test", version: "0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [TSX, join(import.meta.dirname, "..", "src", "server.ts")], stderr: "inherit" }));
    try {
      const names = (await client.listTools()).tools.map((t) => t.name).sort();
      expect(names).toEqual(["add_rushes", "apply_patch", "close_step", "create_project", "decide", "get_project", "get_reference", "get_transcript",
        "apply_series", "list_projects", "list_series", "propose", "run", "save_series", "set_value", "still", "undo", "update_item",
        "search_assets", "look_at", "import_asset", "pinterest_boards", "pinterest_sync", "insights", "first_pass"].sort());
      const summary = await client.callTool({ name: "get_project", arguments: { project: dir } });
      expect((summary.content as { text: string }[])[0]!.text).toContain('"durationMs"');
      const bad = await client.callTool({ name: "set_value", arguments: { project: dir, pointer: "/canvas/fps", value: "fast" } });
      expect(bad.isError).toBe(true);
      const kinds = await client.callTool({ name: "get_reference", arguments: { topic: "kinds" } });
      expect((kinds.content as { text: string }[])[0]!.text).toContain("image");
      const still = await client.callTool({ name: "still", arguments: { project: dir, atMs: [2300], variant: "p1:A" } });
      const image = (still.content as { type: string; data?: string; mimeType?: string }[]).find((c) => c.type === "image");
      expect(still.isError, JSON.stringify(still.content).slice(0, 500)).toBeFalsy();
      expect(image?.mimeType).toBe("image/jpeg");
      expect(image!.data!.length).toBeGreaterThan(1000);
    } finally {
      await client.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300000);
});
