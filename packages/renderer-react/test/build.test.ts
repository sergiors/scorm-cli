import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildReactCourse, reactRenderer } from "../src";
import type { RenderResult } from "../src";
import { sampleCourse } from "./fixtures";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>`;

let workDir: string;
let outputDirectory: string;
let entrypoint: RenderResult;
let indexHtml: string;
let appJs: string;

beforeAll(async () => {
  workDir = await mkdtemp(path.join(os.tmpdir(), "renderer-react-"));
  outputDirectory = path.join(workDir, "out");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path.join(outputDirectory, "stale.txt"), "should be removed");
  await writeFile(path.join(workDir, "thumb.svg"), SVG);

  entrypoint = await buildReactCourse(sampleCourse, {
    outputDirectory,
    assets: [
      {
        sourcePath: path.join(workDir, "thumb.svg"),
        targetPath: "assets/thumb.svg",
      },
    ],
  });

  indexHtml = await readFile(
    path.join(outputDirectory, "index.html"),
    "utf-8",
  );
  appJs = await readFile(
    path.join(outputDirectory, "assets", "app.js"),
    "utf-8",
  );
}, 120_000);

afterAll(async () => {
  if (workDir) {
    await rm(workDir, { recursive: true, force: true });
  }
});

describe("buildReactCourse", () => {
  it("returns the output directory and index.html entrypoint", () => {
    expect(entrypoint.directory).toBe(path.resolve(outputDirectory));
    expect(entrypoint.entrypoint).toBe("index.html");
  });

  it("generates a self-contained index.html", () => {
    expect(indexHtml).toContain('<div id="root">');
    expect(indexHtml).toContain("./assets/app.js");
    expect(indexHtml).toContain('rel="stylesheet"');
    expect(indexHtml).toContain('href="./assets/');
    expect(indexHtml).toContain("<title>Rendering Fundamentals</title>");
    // Relative base so the output works from the file system or any subpath.
    expect(indexHtml).not.toContain('src="/assets');
  });

  it("clears stale files from the output directory", async () => {
    await expect(
      readFile(path.join(outputDirectory, "stale.txt"), "utf-8"),
    ).rejects.toThrow();
  });

  it("embeds deterministic course data in the bundle", () => {
    expect(appJs).toContain("Introduction");
    expect(appJs).toContain("Rendering Fundamentals");
    // No runtime JSON fetch is used to load the course.
    expect(appJs).not.toContain("virtual:course-data");
  });

  it("emits a compiled stylesheet", async () => {
    const assets = await readdir(path.join(outputDirectory, "assets"));
    const cssFile = assets.find((name) => name.endsWith(".css"));
    expect(cssFile).toBeDefined();
    const css = await readFile(
      path.join(outputDirectory, "assets", cssFile as string),
      "utf-8",
    );
    expect(css.length).toBeGreaterThan(0);
  });

  it("copies provided assets to their target paths", async () => {
    const copied = await readFile(
      path.join(outputDirectory, "assets", "thumb.svg"),
      "utf-8",
    );
    expect(copied).toBe(SVG);
  });

  it("rejects an asset target that escapes the output directory", async () => {
    await expect(
      buildReactCourse(sampleCourse, {
        outputDirectory,
        assets: [
          { sourcePath: path.join(workDir, "thumb.svg"), targetPath: "../evil" },
        ],
      }),
    ).rejects.toThrow(/escapes the output directory/);
  });

  it("requires an output directory", async () => {
    await expect(
      buildReactCourse(sampleCourse, { outputDirectory: "" }),
    ).rejects.toThrow(/outputDirectory/);
  });
});

describe("reactRenderer", () => {
  it("exposes buildReactCourse through the renderer contract", () => {
    expect(reactRenderer.build).toBe(buildReactCourse);
  });
});
