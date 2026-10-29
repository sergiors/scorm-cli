import { collectVideoNodes } from '@scorm-cli/core'
import type {
  ContentNode,
  ContentPackage,
  InlineContentNode,
  QuestionnaireNode,
  VideoProvider
} from '@scorm-cli/core'

export interface ScoIndex {
  schemaVersion: 1
  title: string
  lang: string
  presentation: 'scroll' | 'slides' | 'tiles'
  pages: Record<
    string,
    {
      id: string
      title: string
      /** Stable preorder questionnaire indexes, each with its own local question indexes. */
      questionnaires?: Record<
        string,
        {
          id: string
          maxAttempts: number
          questions: Record<
            string,
            {
              id: string
              prompt: string
              type: 'single-choice' | 'multiple-choice' | 'true-false'
              options: Record<string, { value: string; label: string }>
              correctAnswers: string[]
            }
          >
        }
      >
      videos?: Record<
        string,
        {
          id: string
          src: string
          provider: VideoProvider
          /** Authored video duration in seconds. */
          duration?: number
          /** Authored minimum accumulated watch time in seconds. */
          minWatchTime?: number
        }
      >
    }
  >
}

function collectQuestionnaires(
  nodes: Array<ContentNode | InlineContentNode>,
  output: QuestionnaireNode[]
): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'list':
        for (const item of node.items) collectQuestionnaires(item.children, output)
        break
      case 'quote':
        collectQuestionnaires(node.children, output)
        break
      case 'callout':
        collectQuestionnaires(node.children, output)
        break
      case 'accordion':
        for (const item of node.items) collectQuestionnaires(item.content, output)
        break
      case 'questionnaire':
        output.push(node)
        break
      default:
        break
    }
  }
}

/** Creates the stable static dictionary, including authored question correctness, shared by packaging and runtime. */
export function createScoIndex(contentPackage: ContentPackage): ScoIndex {
  const nodes =
    contentPackage.presentation.type === 'tiles'
      ? contentPackage.presentation.items
      : contentPackage.presentation.pages
  const pages: ScoIndex['pages'] = {}
  nodes.forEach((node, pageIndex) => {
    const sourceQuestionnaires: QuestionnaireNode[] = []
    collectQuestionnaires(node.content, sourceQuestionnaires)
    const questionnaires = Object.fromEntries(
      sourceQuestionnaires.map((questionnaire, questionnaireIndex) => {
        const questions = Object.fromEntries(
          questionnaire.questions.map((question, questionIndex) => {
            const options: Record<string, { value: string; label: string }> = {}
            question.options.forEach((option, optionIndex) => {
              options[String(optionIndex)] = {
                value: option.value,
                label: option.content
              }
            })
            return [
              String(questionIndex),
              {
                id: question.id,
                prompt: question.prompt,
                type: question.questionType,
                options,
                correctAnswers: question.options
                  .filter((option) => option.correct)
                  .map((option) => option.value)
              }
            ]
          })
        )
        return [
          String(questionnaireIndex),
          { id: questionnaire.id, maxAttempts: questionnaire.maxAttempts, questions }
        ]
      })
    )
    const videos = Object.fromEntries(
      collectVideoNodes(node.content).map((video, videoIndex) => [
        String(videoIndex),
        {
          id: video.id,
          src: video.src,
          provider: video.provider,
          ...(video.duration !== undefined ? { duration: video.duration } : {}),
          ...(video.minWatchTime !== undefined ? { minWatchTime: video.minWatchTime } : {})
        }
      ])
    )
    pages[String(pageIndex)] = {
      id: node.id,
      title: node.metadata.title,
      ...(Object.keys(questionnaires).length > 0 ? { questionnaires } : {}),
      ...(Object.keys(videos).length > 0 ? { videos } : {})
    }
  })

  return {
    schemaVersion: 1,
    title: contentPackage.metadata.title,
    lang: contentPackage.metadata.lang ?? 'en',
    presentation: contentPackage.presentation.type,
    pages
  }
}
