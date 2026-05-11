import fs from "node:fs/promises";
import path from "node:path";

import matter from "gray-matter";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { z } from "zod";

import { parsers } from "./parsers";

const metadataSchema = z.object({
  title: z.string(),
});

function parseMdx(source: string) {
  const tree = unified().use(remarkParse).use(remarkMdx).parse(source);

  return tree.children.flatMap((node: any) => {
    const parserKey =
      node.type === "mdxJsxFlowElement"
        ? node.name?.trim()?.toLowerCase() ?? ""
        : node.type;

    const parser = parsers[parserKey];

    if (!parser) {
      return [];
    }

    return parser(node);
  });
}

async function resolveNode(node: any, currentFile: string) {
  // Grid
  if (node.type === "grid") {
    const items = await Promise.all(
      node.items.map(async (item: any) => {
        const resolvedPath = path.resolve(path.dirname(currentFile), item.href);
        const document = await parseFile(resolvedPath);

        return {
          ...item,
          document,
        };
      }),
    );

    return {
      ...node,
      items,
    };
  }

  // Image
  if (node.type === "image") {
    const resolvedSrc = path.resolve(path.dirname(currentFile), node.src);

    return {
      ...node,
      resolvedSrc,
    };
  }

  return node;
}

export async function parseFile(filePath: string) {
  const source = await fs.readFile(filePath, "utf-8");
  const { data, content } = matter(source);
  const metadata = metadataSchema.parse(data);
  const body = parseMdx(content);

  const resolvedBody = await Promise.all(
    body.map((node) => resolveNode(node, filePath)),
  );

  return {
    metadata,
    body: resolvedBody,
  };
}

async function main() {
  const result = await parseFile("./examples/nr10/index.mdx");

  console.log(JSON.stringify(result, null, 2));
}

main();
