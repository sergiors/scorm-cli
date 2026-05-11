#!/usr/bin/env node
import { parseFile } from "@scorm-cli/parser";
import { cac } from "cac";
import path from "node:path";

const cli = cac("scorm-cli");

cli
  .command("[file]", "Parse an MDX file")
  .example("scorm-cli examples/nodejs/index.mdx")
  .action(async (file: string) => {
    if (!file) {
      console.error("Error: Please provide a file path");
      console.error("\nUsage: scorm-cli <file.mdx>");
      process.exit(1);
    }

    const resolvedPath = path.resolve(file);

    try {
      const result = await parseFile(resolvedPath);
      console.log(JSON.stringify(result, null, 2));
    } catch (error) {
      console.error(`Error parsing ${file}:`, error);
      process.exit(1);
    }
  });

cli.help();
cli.parse();
