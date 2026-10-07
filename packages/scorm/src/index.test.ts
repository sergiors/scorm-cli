import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";
import { createManifest, packageScorm, scormRuntime } from "./index";

let temp: string;
afterEach(async () => { if (temp) await rm(temp, { recursive: true, force: true }); });

describe("SCORM 1.2 package", () => {
  it("escapes metadata and lists a single SCO resource with static files", () => {
    const xml = createManifest({ title: `R&D <Safety> "101"` }, ["index.html", "assets/photo.svg"]);
    expect(xml).toContain("R&amp;D &lt;Safety&gt; &quot;101&quot;");
    expect(xml).toContain('adlcp:scormtype="sco" href="index.html"');
    expect(xml).toContain('<file href="assets/photo.svg"/>');
    expect(xml.match(/<resource /g)).toHaveLength(1);
  });

  it("creates a ZIP with the manifest at root and injects the SCORM bridge", async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), "scorm-test-"));
    const renderDir = path.join(temp, "render");
    await mkdir(path.join(renderDir, "assets"), { recursive: true });
    await writeFile(path.join(renderDir, "index.html"), "<!doctype html><html><head></head><body><script src=\"app.js\"></script></body></html>");
    await writeFile(path.join(renderDir, "app.js"), "window.booted = true;");
    await writeFile(path.join(renderDir, "assets", "photo.svg"), "<svg/>");
    const output = await packageScorm({ courseMetadata: { title: "A course" }, renderResult: { directory: renderDir, entrypoint: "index.html" }, outputPath: path.join(temp, "course.zip") });
    const zip = await JSZip.loadAsync(await readFile(output));
    expect(Object.keys(zip.files)).toContain("imsmanifest.xml");
    expect(Object.keys(zip.files)).toContain("assets/photo.svg");
    expect(await zip.file("imsmanifest.xml")!.async("string")).toContain('href="index.html"');
    const html = await zip.file("index.html")!.async("string");
    expect(html.indexOf("scorm-runtime.js")).toBeLessThan(html.indexOf("app.js"));
    expect(await zip.file("scorm-runtime.js")!.async("string")).toContain("LMSInitialize");
  });

  it("initializes, preserves completion, marks completed, and finishes once", () => {
    const calls: Array<[string, ...string[]]> = [];
    const api = {
      LMSInitialize: (value: string) => { calls.push(["init", value]); return "true"; },
      LMSGetValue: (key: string) => { calls.push(["get", key]); return "incomplete"; },
      LMSSetValue: (key: string, value: string) => { calls.push(["set", key, value]); return "true"; },
      LMSCommit: (value: string) => { calls.push(["commit", value]); return "true"; },
      LMSFinish: (value: string) => { calls.push(["finish", value]); return "true"; },
    };
    const handlers: Record<string, () => void> = {};
    const windowMock: any = { API: api, parent: null, addEventListener: (name: string, cb: () => void) => { handlers[name] = cb; } };
    windowMock.parent = windowMock;
    vm.runInNewContext(scormRuntime, { window: windowMock });
    windowMock.courseRuntime.markCompleted();
    windowMock.courseRuntime.finish();
    handlers.beforeunload();
    expect(calls.filter(([name]) => name === "set")).toContainEqual(["set", "cmi.core.lesson_status", "completed"]);
    expect(calls.filter(([name]) => name === "finish")).toHaveLength(1);
  });
});
