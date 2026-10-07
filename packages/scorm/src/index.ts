import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import JSZip from "jszip";
import type { RenderResult } from "@scorm-cli/core";
import { scormRuntime } from "./runtime";

export interface PackageScormOptions {
  courseMetadata: { title: string; description?: string };
  renderResult: RenderResult;
  outputPath: string;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function identifier(value: string): string {
  const safe = value.normalize("NFKD").replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  return safe || "scorm-course";
}

export function createManifest(metadata: PackageScormOptions["courseMetadata"], files: string[]): string {
  const id = xmlEscape(identifier(metadata.title));
  const fileEntries = [...new Set(files)].sort().map((file) => `      <file href="${xmlEscape(file)}"/>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${id}" version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 imscp_rootv1p1p2.xsd http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG-${id}">
    <organization identifier="ORG-${id}">
      <title>${xmlEscape(metadata.title)}</title>
      <item identifier="ITEM-${id}" identifierref="RES-${id}"><title>${xmlEscape(metadata.title)}</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-${id}" type="webcontent" adlcp:scormtype="sco" href="index.html">
${fileEntries}
    </resource>
  </resources>
</manifest>`;
}

async function walkFiles(directory: string, current = directory): Promise<string[]> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) result.push(...await walkFiles(directory, absolute));
    else if (entry.isFile()) result.push(path.relative(directory, absolute).split(path.sep).join("/"));
  }
  return result;
}

async function injectRuntime(entrypoint: string): Promise<void> {
  const html = await fs.readFile(entrypoint, "utf8");
  const tag = '<script src="scorm-runtime.js"></script>';
  const headEnd = html.search(/<\/head\s*>/i);
  const script = html.search(/<script\b/i);
  const insertAt = script >= 0 && (headEnd < 0 || script < headEnd) ? script : headEnd;
  const updated = insertAt >= 0
    ? `${html.slice(0, insertAt)}${tag}\n  ${html.slice(insertAt)}`
    : `${tag}\n${html}`;
  await fs.writeFile(entrypoint, updated, "utf8");
}

/** Stage a rendered web app as a single SCORM 1.2 SCO and write a ZIP archive. */
export async function packageScorm(options: PackageScormOptions): Promise<string> {
  const sourceDirectory = path.resolve(options.renderResult.directory);
  const sourceEntrypoint = path.resolve(sourceDirectory, options.renderResult.entrypoint);
  const relativeEntrypoint = path.relative(sourceDirectory, sourceEntrypoint);
  if (relativeEntrypoint.startsWith("..") || path.isAbsolute(relativeEntrypoint)) throw new Error("renderer entrypoint must be inside its output directory");
  const out = path.resolve(options.outputPath);
  const parent = path.dirname(out);
  await fs.mkdir(parent, { recursive: true });
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), "scorm-cli-stage-"));
  try {
    await fs.cp(sourceDirectory, stage, { recursive: true });
    const stageEntrypoint = path.join(stage, relativeEntrypoint);
    if (path.basename(stageEntrypoint) !== "index.html") throw new Error("renderer entrypoint must be named index.html");
    if (path.dirname(relativeEntrypoint) !== ".") throw new Error("renderer entrypoint must be at the root of its output directory");
    const rendererFiles = await walkFiles(stage);
    if (rendererFiles.includes("imsmanifest.xml") || rendererFiles.includes("scorm-runtime.js")) {
      throw new Error("renderer output uses a reserved SCORM package filename");
    }
    await fs.writeFile(path.join(stage, "scorm-runtime.js"), scormRuntime, "utf8");
    await injectRuntime(path.join(stage, "index.html"));
    const files = await walkFiles(stage);
    await fs.writeFile(path.join(stage, "imsmanifest.xml"), createManifest(options.courseMetadata, files), "utf8");
    const zip = new JSZip();
    for (const file of [...files, "imsmanifest.xml"].sort()) {
      zip.file(file, await fs.readFile(path.join(stage, file)), { date: new Date("2000-01-01T00:00:00Z"), createFolders: false });
    }
    const data = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 }, platform: "UNIX" });
    await fs.writeFile(out, data);
    return out;
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

export { scormRuntime };
