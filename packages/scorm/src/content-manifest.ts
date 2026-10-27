import { collectVideoNodes } from '@scorm-cli/core'
import type {
  ContentNode,
  ContentPackage,
  InlineContentNode,
  QuestionNode,
  QuestionnaireNode,
  VideoProvider
} from '@scorm-cli/core'

export interface ContentManifest {
  schemaVersion: 1
  title: string
  lang: string
  presentation: 'scroll' | 'slides' | 'tiles'
  pages: Record<
    string,
    {
      id: string
      title: string
      questions: Record<
        string,
        {
          id: string
          prompt: string
          type: QuestionNode['questionType']
          options: Record<string, { value: string; label: string }>
          correctAnswers: string[]
        }
      >
      /** Stable preorder questionnaire indexes and the bounds needed by suspend-data validation. */
      questionnaires?: Record<string, { id: string; maxAttempts: number; questionCount: number }>
      videos?: Record<string, { id: string; src: string; provider: VideoProvider }>
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
      case 'questionnaire':
        output.push(node)
        break
      default:
        break
    }
  }
}

function collectQuestions(
  nodes: Array<ContentNode | InlineContentNode>,
  output: QuestionNode[]
): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'list':
        for (const item of node.items) collectQuestions(item.children, output)
        break
      case 'quote':
        collectQuestions(node.children, output)
        break
      case 'questionnaire':
        output.push(...node.questions)
        break
      case 'inlineContent':
        // Inline runs cannot hold a questionnaire block; skip them while still
        // traversing sibling blocks.
        break
      default:
        break
    }
  }
}

/** Creates the stable static dictionary, including authored question correctness, shared by packaging and runtime. */
export function createContentManifest(contentPackage: ContentPackage): ContentManifest {
  const nodes =
    contentPackage.presentation.type === 'tiles'
      ? contentPackage.presentation.items
      : contentPackage.presentation.pages
  const pages: ContentManifest['pages'] = {}
  nodes.forEach((node, pageIndex) => {
    const sourceQuestions: QuestionNode[] = []
    collectQuestions(node.content, sourceQuestions)
    const sourceQuestionnaires: QuestionnaireNode[] = []
    collectQuestionnaires(node.content, sourceQuestionnaires)
    const questions: ContentManifest['pages'][string]['questions'] = {}
    sourceQuestions.forEach((question, questionIndex) => {
      const options: Record<string, { value: string; label: string }> = {}
      question.options.forEach((option, optionIndex) => {
        options[String(optionIndex)] = {
          value: option.value,
          label: option.content
        }
      })
      questions[String(questionIndex)] = {
        id: question.id,
        prompt: question.prompt,
        type: question.questionType,
        options,
        correctAnswers: question.options
          .filter((option) => option.correct)
          .map((option) => option.value)
      }
    })
    const questionnaires = Object.fromEntries(
      sourceQuestionnaires.map((questionnaire, questionnaireIndex) => [
        String(questionnaireIndex),
        {
          id: questionnaire.id,
          maxAttempts: questionnaire.maxAttempts ?? 1,
          questionCount: questionnaire.questions.length
        }
      ])
    )
    const videos = Object.fromEntries(
      collectVideoNodes(node.content).map(({ id, src, provider }, videoIndex) => [
        String(videoIndex),
        { id, src, provider }
      ])
    )
    pages[String(pageIndex)] = {
      id: node.id,
      title: node.metadata.title,
      questions,
      questionnaires,
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
