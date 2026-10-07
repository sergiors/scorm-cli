#!/usr/bin/env node
import { cac } from "cac";
import { buildPackage } from "./build";

const cli = cac("scorm");

cli
  .command("build <course>", "Build a SCORM 1.2 package from a course")
  .option(
    "-o, --output <path>",
    "Output ZIP path (default: dist/<course-name>.zip",
  )
  .example("scorm build examples/typescript-course")
  .action(async (course: string, options: { output?: string }) => {
    try {
      const output = await buildPackage(course, options.output);
      console.log(`SCORM package written to ${output}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    }
  });

cli.help();
cli.parse();
