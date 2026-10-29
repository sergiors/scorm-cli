import { writeFileSync } from 'node:fs'
import type { ScoIndex } from '../../sco-index'
import { scormDevMock } from '../../mock'
import { createScormPreviewRuntime } from '../../runtime'
import { browserCodecSource } from '../../state-codec'

/**
 * Executed by `runtime-keep-names.test.ts` through tsx, whose esbuild transform
 * compiles TypeScript with `keepNames`. Running this module from TS source is
 * the only way to observe the serialization the preview runtime is served with:
 * Vitest transpiles the same files without `keepNames`, so importing
 * `browserCodecSource()` there cannot reproduce the failure.
 *
 * Usage: tsx keep-names-probe.ts <result-path>
 */
const resultPath = process.argv[2]
if (!resultPath) {
  throw new Error('Usage: tsx keep-names-probe.ts <result-path>')
}

const scoIndex: ScoIndex = {
  schemaVersion: 1,
  title: 'Keep-names runtime',
  lang: 'en',
  presentation: 'scroll',
  pages: {
    '0': {
      id: 'page:one',
      title: 'One',
      videos: {
        '0': { id: 'video:lesson.mdx:0:1', src: 'https://youtu.be/keepnames', provider: 'youtube' }
      },
      questionnaires: {
        '0': {
          id: 'quiz',
          maxAttempts: 1,
          questions: {
            '0': {
              id: 'q-one',
              type: 'multiple-choice',
              prompt: '',
              correctAnswers: [],
              options: {
                '0': { value: 'alpha', label: 'Alpha' },
                '1': { value: 'beta', label: 'Beta' }
              }
            }
          }
        }
      }
    }
  }
}

const codecSource = browserCodecSource()
const codecBodyStart = codecSource.indexOf('var suspendCodec = (')

writeFileSync(
  resultPath,
  JSON.stringify({
    scoIndex,
    /** The complete embedded codec source, `__name` shim included. */
    codecSource,
    /** The serialized codec body alone; the shim never appears inside it. */
    codecBody: codecBodyStart === -1 ? codecSource : codecSource.slice(codecBodyStart),
    previewRuntime: createScormPreviewRuntime(scoIndex),
    mock: scormDevMock
  })
)
