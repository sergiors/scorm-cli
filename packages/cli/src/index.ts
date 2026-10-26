#!/usr/bin/env node
import { cac } from 'cac'
import { buildPackage } from './build'
import { errorMessage } from './errors'
import { runPreviewCommand } from './preview-command'
import { loadRenderer } from './renderer'
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
  .action((content: string, options: { port?: string | number }) =>
    runPreviewCommand(content, options, loadRenderer)
  )

cli.help()
cli.parse()
