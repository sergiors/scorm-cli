import { writeFileSync } from 'node:fs'
import type { ScoIndex } from '../../sco-index'
import { scormDevMock } from '../../mock'
import { createScormPreviewRuntime } from '../../runtime'
import { browserCodecSource } from '../../state-codec'

/** Executed through tsx to cover direct-source preview runtime generation. */
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

writeFileSync(
  resultPath,
  JSON.stringify({
    scoIndex,
    /** The complete in-memory esbuild bundle served to the browser. */
    codecSource,
    previewRuntime: createScormPreviewRuntime(scoIndex),
    mock: scormDevMock
  })
)
