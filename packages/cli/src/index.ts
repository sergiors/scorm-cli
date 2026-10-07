#!/usr/bin/env node
import { cac } from 'cac';
import { buildPackage } from './build';

const cli = cac('scorm');

cli
  .command('build <content>', 'Build a SCORM 1.2 package from authored content')
  .option(
    '-o, --output <path>',
    'Output ZIP path (default: dist/<content-name>.zip)',
  )
  .example('scorm build examples/typescript-content')
  .action(async (content: string, options: { output?: string }) => {
    try {
      const output = await buildPackage(content, options.output);
      console.log(`SCORM package written to ${output}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    }
  });

cli.help();
cli.parse();
