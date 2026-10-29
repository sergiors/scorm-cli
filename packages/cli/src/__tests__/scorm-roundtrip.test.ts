import vm from 'node:vm'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AnswerValue, ContentPackage, PlayerState, QuestionnaireNode } from '@scorm-cli/core'
import { parsePackage } from '@scorm-cli/parser'
import {
  createScoIndex,
  createScormRuntime,
  decodeSuspendData,
  encodeSuspendData
} from '@scorm-cli/scorm'
import type { ScoIndex } from '@scorm-cli/scorm'

let root: string
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true })
})

/** Authored options are deliberately not alphabetical in either question. */
async function writeAuthoredPackage(): Promise<string> {
  root = await mkdtemp(path.join(os.tmpdir(), 'scorm-cli-roundtrip-'))
  await writeFile(
    path.join(root, 'index.mdx'),
    `---\ntitle: Authored course\n---\n<Scroll>\n  <Page src="lesson.mdx" />\n</Scroll>\n`
  )
  await writeFile(
    path.join(root, 'lesson.mdx'),
    `---\ntitle: Lesson\n---\n` +
      `<Questionnaire>\n` +
      `<Question type="multiple-choice">\n<Prompt>Pick all</Prompt>\n` +
      `<Option value="zebra" correct={true}>Zebra</Option>\n` +
      `<Option value="mango" correct={false}>Mango</Option>\n` +
      `<Option value="apple" correct={true}>Apple</Option>\n` +
      `</Question>\n` +
      `<Question type="single-choice">\n<Prompt>Pick one</Prompt>\n` +
      `<Option value="beta" correct={false}>Beta</Option>\n` +
      `<Option value="alpha" correct={true}>Alpha</Option>\n` +
      `</Question>\n` +
      `</Questionnaire>\n`
  )
  return root
}

function firstQuestionnaire(contentPackage: ContentPackage): QuestionnaireNode {
  if (contentPackage.presentation.type !== 'scroll')
    throw new Error('expected a scroll presentation')
  const page = contentPackage.presentation.pages[0]
  const questionnaire = page?.content.find(
    (node): node is QuestionnaireNode => node.type === 'questionnaire'
  )
  if (!questionnaire) throw new Error('expected a questionnaire')
  return questionnaire
}

/** Runs the packaged SCORM bridge against a minimal in-memory LMS. */
function runRuntime(scoIndex: ScoIndex) {
  const values: Record<string, string> = {}
  const window: any = {
    __SCORM_DEVTOOLS__: false,
    parent: null,
    API: {
      LMSInitialize: () => 'true',
      LMSGetValue: (key: string) => values[key] ?? '',
      LMSSetValue: (key: string, value: string) => {
        values[key] = value
        return 'true'
      },
      LMSCommit: () => 'true',
      LMSFinish: () => 'true'
    },
    addEventListener: () => undefined,
    dispatchEvent: () => undefined,
    CustomEvent: class {}
  }
  window.parent = window
  vm.runInNewContext(createScormRuntime(scoIndex), { window })
  return { window, values }
}

describe('authored MDX to suspend_data round trip', () => {
  it('carries authored option order through parse, sco index, runtime selection and codec', async () => {
    const contentPackage = await parsePackage(await writeAuthoredPackage())
    const questionnaire = firstQuestionnaire(contentPackage)
    const [multi, single] = questionnaire.questions
    if (!multi || !single) throw new Error('expected two questions')
    expect(multi.questionType).toBe('multiple-choice')
    expect(single.questionType).toBe('single-choice')

    // 1. The parsed QuestionNode keeps authored source order, not value order.
    const authoredMulti = multi.options.map((option) => option.value)
    const authoredSingle = single.options.map((option) => option.value)
    expect(authoredMulti).toEqual(['zebra', 'mango', 'apple'])
    expect(authoredSingle).toEqual(['beta', 'alpha'])
    expect([...authoredMulti].sort()).not.toEqual(authoredMulti)
    expect([...authoredSingle].sort()).not.toEqual(authoredSingle)

    // 2. The sco index keeps questionnaire-local question indexes in that same
    //    source order and reuses the parsed question ids rather than reordering
    //    by value.
    const scoIndex = createScoIndex(contentPackage)
    const indexPage = scoIndex.pages['0']
    if (!indexPage) throw new Error('expected sco index page 0')
    if (!indexPage.questionnaires) throw new Error('expected sco index questionnaires on page 0')
    const indexQuestionnaire = indexPage.questionnaires['0']
    if (!indexQuestionnaire) throw new Error('expected sco index questionnaire 0')
    expect(indexQuestionnaire.id).toBe(questionnaire.id)
    expect(indexQuestionnaire.questions['0'].id).toBe(multi.id)
    expect(indexQuestionnaire.questions['1'].id).toBe(single.id)
    expect(indexQuestionnaire.questions['0'].options).toEqual({
      '0': { value: 'zebra', label: 'Zebra' },
      '1': { value: 'mango', label: 'Mango' },
      '2': { value: 'apple', label: 'Apple' }
    })
    expect(indexQuestionnaire.questions['1'].options).toEqual({
      '0': { value: 'beta', label: 'Beta' },
      '1': { value: 'alpha', label: 'Alpha' }
    })
    // Index 1 is the authored second option, not the alphabetically first value.
    expect(indexQuestionnaire.questions['0'].options['1']!.value).toBe('mango')
    expect(indexQuestionnaire.questions['1'].options['1']!.value).toBe('alpha')
    expect(indexQuestionnaire.questions['0'].correctAnswers).toEqual(['zebra', 'apple'])
    expect(indexQuestionnaire.questions['1'].correctAnswers).toEqual(['alpha'])

    // 3. A runtime selects semantic option values, not indexes: an array for
    //    multiple-choice and a scalar for single-choice.
    const pageId = indexPage.id
    const selected: PlayerState = {
      pages: {
        [pageId]: {
          visited: true,
          answers: {
            [multi.id]: ['zebra', 'apple'],
            [single.id]: 'alpha'
          } satisfies Record<string, AnswerValue>
        }
      }
    }

    // The single questionnaire owns both local question indexes.
    const compact = {
      v: 2,
      p: 0,
      x: '1',
      d: { '0.a.0.0': [0, 2], '0.a.0.1': 1 }
    }
    expect(encodeSuspendData(scoIndex, selected, 0)).toEqual(compact)

    // 4. The runtime bridge persists exactly that compact payload as
    //    cmi.suspend_data, with no semantic values or labels leaking.
    const { window, values } = runRuntime(scoIndex)
    expect(window.scormBridge.saveState(selected)).toBe(true)
    const suspendData = values['cmi.suspend_data']!
    expect(JSON.parse(suspendData)).toEqual(compact)
    expect(suspendData).not.toMatch(/zebra|mango|apple|beta|alpha/i)
    expect(suspendData).not.toMatch(/Pick all|Pick one|Zebra|Mango|Beta/i)

    // 5. Decoding resolves the indexes back to equivalent semantic values.
    const expectedAnswers = {
      [multi.id]: ['zebra', 'apple'],
      [single.id]: 'alpha'
    }
    const decoded = decodeSuspendData(scoIndex, suspendData)
    expect(decoded.pages[pageId]!.answers).toEqual(expectedAnswers)
    expect(window.scormBridge.getResumeState()).toEqual(
      expect.objectContaining({
        pages: expect.objectContaining({
          [pageId]: expect.objectContaining({ answers: expectedAnswers })
        })
      })
    )
  })
})
