#!/usr/bin/env node
import { cac } from 'cac';
import { buildPackage } from './build';
import { startDevPackage } from './dev';

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

cli
  .command('dev <content>', 'Preview authored content and watch for changes')
  .option('-p, --port <port>', 'Port for the local preview server')
  .example('scorm dev examples/typescript-content')
  .action(async (content: string, options: { port?: string | number }) => {
    try {
      const port =
        options.port === undefined ? undefined : Number(options.port);
      if (
        port !== undefined &&
        (!Number.isInteger(port) || port < 0 || port > 65535)
      ) {
        throw new Error('--port must be an integer between 0 and 65535');
      }
      const session = await startDevPackage(content, { port });
      console.log(`Entry: ${session.entrypoint}`);
      console.log(`Dev server: ${session.url}`);

      const stop = (signal: NodeJS.Signals) => {
        process.off('SIGINT', onSigint);
        process.off('SIGTERM', onSigterm);
        void session
          .close()
          .catch((error) => {
            const message =
              error instanceof Error ? error.message : String(error);
            console.error(`Error closing dev server: ${message}`);
          })
          .finally(() => {
            process.exitCode = signal === 'SIGINT' ? 130 : 143;
          });
      };
      const onSigint = () => stop('SIGINT');
      const onSigterm = () => stop('SIGTERM');
      process.once('SIGINT', onSigint);
      process.once('SIGTERM', onSigterm);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error: ${message}`);
      process.exitCode = 1;
    }
  });

cli.help();
cli.parse();
