import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureWritableDir } from "./db.js";

describe("ensureWritableDir", () => {
  it("creates a missing directory", () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sm-")), "nested", "data");
    ensureWritableDir(dir);
    expect(fs.existsSync(dir)).toBe(true);
  });

  it("explains how to fix an unusable directory", () => {
    // A path under an existing regular file can never be created.
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sm-")), "file");
    fs.writeFileSync(file, "");
    expect(() => ensureWritableDir(path.join(file, "data"))).toThrow(/not writable.*chown/);
  });
});
