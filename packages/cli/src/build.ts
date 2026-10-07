import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Course, Renderer } from "@scorm-cli/core";
import { collectAssetReferences } from "@scorm-cli/core";
import { parseCourse } from "@scorm-cli/parser";
import { packageScorm } from "@scorm-cli/scorm";

async function loadRendererBuild(): Promise<Renderer["build"]> {
  const rendererPackage = "@scorm-cli/renderer-react";
  const renderer = (await import(rendererPackage)) as {
    buildReactCourse: Renderer["build"];
  };
  if (typeof renderer.buildReactCourse !== "function")
    throw new Error(
      "@scorm-cli/renderer-react does not export buildReactCourse",
    );
  return renderer.buildReactCourse;
}

function courseName(coursePath: string): string {
  const absolute = path.resolve(coursePath);
  const name =
    path.basename(absolute).toLowerCase() === "index.mdx"
      ? path.basename(path.dirname(absolute))
      : path.basename(absolute, path.extname(absolute));
  return name || "course";
}

export async function buildPackage(
  coursePath: string,
  outputPath?: string,
  rendererBuild?: Renderer["build"],
): Promise<string> {
  const course: Course = await parseCourse(coursePath);
  const output = path.resolve(
    outputPath ?? path.join("dist", `${courseName(coursePath)}.zip`),
  );
  const renderer = rendererBuild ?? (await loadRendererBuild());
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "scorm-cli-build-"));
  const renderedDirectory = path.join(tempRoot, "rendered");
  try {
    const courseRoot = (await fs.stat(path.resolve(coursePath))).isDirectory()
      ? path.resolve(coursePath)
      : path.dirname(path.resolve(coursePath));
    const assets = collectAssetReferences(course).map((reference) => ({
      sourcePath: path.resolve(courseRoot, reference),
      targetPath: reference,
    }));
    const renderResult = await renderer(course, {
      outputDirectory: renderedDirectory,
      assets,
    });
    return await packageScorm({
      courseMetadata: course.metadata,
      renderResult,
      outputPath: output,
    });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}
