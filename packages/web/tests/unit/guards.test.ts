import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hostAllowed, inside, originAllowed, safeName } from "../../server/guards";

describe("guards", () => {
  it("accepts only the panel's own host", () => {
    expect(hostAllowed("127.0.0.1:4317", 4317)).toBe(true);
    expect(hostAllowed("localhost:4317", 4317)).toBe(true);
    expect(hostAllowed("evil.com:4317", 4317)).toBe(false);
    expect(hostAllowed("127.0.0.1:80", 4317)).toBe(false);
    expect(hostAllowed(undefined, 4317)).toBe(false);
  });

  it("refuses state changes from other origins", () => {
    expect(originAllowed("GET", "http://evil.com", 4317)).toBe(true);
    expect(originAllowed("POST", undefined, 4317)).toBe(true);
    expect(originAllowed("POST", "http://127.0.0.1:4317", 4317)).toBe(true);
    expect(originAllowed("POST", "http://localhost:4317", 4317)).toBe(true);
    expect(originAllowed("POST", "http://evil.com", 4317)).toBe(false);
    expect(originAllowed("PUT", "null", 4317)).toBe(false);
  });

  it("takes plain folder names only", () => {
    expect(safeName("projet démo")).toBe(true);
    expect(safeName("1015")).toBe(true);
    for (const bad of ["", ".", "..", "a/b", "a\\b", "c:", " x", "x ", "a*b"]) expect(safeName(bad), bad).toBe(false);
  });

  it("keeps paths inside their root", () => {
    const root = resolve("/tmp/p");
    expect(inside(root, "renders/a.mp4")).toBe(join(root, "renders", "a.mp4"));
    expect(inside(root, "../x")).toBeNull();
    expect(inside(root, "renders/../../x")).toBeNull();
    expect(inside(root, "")).toBeNull();
    expect(inside(root, resolve("/etc/passwd"))).toBeNull();
  });
});
