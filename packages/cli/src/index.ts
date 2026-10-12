#!/usr/bin/env node
import { cac } from 'cac'
import { buildPackage } from './build'
import { startDevPackage } from './dev'
import { errorMessage } from './errors'
import { parseScormVersion } from './scorm-version'

const cli = cac('scorm-cli')

cli
  .command('build <content>', 'Build a SCORM package from authored content')
  .option('-o, --output <path>', 'Output ZIP path (default: dist/<content-name>.zip)')
  .option('--scorm <version>', 'SCORM version: 1.2 (default) or 2004')
  .example('scorm build examples/typescript-content')
  .action(async (content: string, options: { output?: string; scorm?: string | number }) => {
    try {
      const scormVersion = parseScormVersion(options.scorm)
      const output = await buildPackage(content, options.output, undefined, scormVersion)
      console.log(`SCORM package written to ${output}`)
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`)
      process.exitCode = 1
    }
  })

cli
  .command('preview <content>', 'Preview authored content and watch for changes')
  .option('-p, --port <port>', 'Port for the local preview server')
  .example('scorm preview examples/typescript-content')
  .action(async (content: string, options: { port?: string | number }) => {
    try {
      const port = options.port === undefined ? undefined : Number(options.port)
      if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
        throw new Error('--port must be an integer between 0 and 65535')
      }
      const session = await startDevPackage(content, { port })
      console.log(`Entry: ${session.entrypoint}`)
      console.log(`Preview server: ${session.url}`)

      const stop = (signal: NodeJS.Signals) => {
        process.off('SIGINT', onSigint)
        process.off('SIGTERM', onSigterm)
        void session
          .close()
          .catch((error) => {
            console.error(`Error closing preview server: ${errorMessage(error)}`)
          })
          .finally(() => {
            process.exitCode = signal === 'SIGINT' ? 130 : 143
          })
      }
      const onSigint = () => stop('SIGINT')
      const onSigterm = () => stop('SIGTERM')
      process.once('SIGINT', onSigint)
      process.once('SIGTERM', onSigterm)
    } catch (error) {
      console.error(`Error: ${errorMessage(error)}`)
      process.exitCode = 1
    }
  })

cli.help()
cli.parse()
