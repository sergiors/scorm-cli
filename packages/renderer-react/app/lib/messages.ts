import type { PlayerLocale } from '../i18n/locale'

/**
 * Every string the player itself generates — never authored content. Titles,
 * descriptions, prompts and options are rendered verbatim; only this fixed
 * chrome is translated.
 *
 * IDs are structured and namespaced by the surface that owns them, and values
 * that interpolate runtime data use ICU placeholders so `react-intl` formats
 * them (numbers included) rather than a hand-rolled template. English is the
 * canonical dictionary: its keys define {@link MessageId}, so every other
 * locale is checked against it at compile time.
 */
export const en = {
  'slides.previousPage': 'Previous page',
  'slides.continueNextPage': 'Continue to next page',
  'scroll.loading': 'Loading page',
  'scroll.locked': 'Complete this page to continue.',
  'content.loadError': 'This content could not be loaded.',
  'content.retry': 'Try again',
  'tiles.locked': 'Locked',
  'path.label': 'Path',
  'path.visited': 'Visited',
  'path.available': 'Available',
  'path.locked': 'Locked',
  'video.label': 'Video',
  'video.error': 'This video could not be played.',
  'video.requiredProgress': 'Required viewing: {percent}% watched',
  'video.requiredComplete': 'Required viewing complete',
  'questionnaire.previous': 'Previous question',
  'questionnaire.next': 'Next question',
  'questionnaire.submit': 'Submit questionnaire',
  'questionnaire.progressLabel': 'Questionnaire progress',
  'questionnaire.progress': 'Question {current} of {total}',
  'questionnaire.answerRequired': 'Choose an answer to continue.',
  'questionnaire.summaryTitle': 'Questionnaire completed',
  'questionnaire.summaryCorrect': '{correct} of {total} correct answers',
  'questionnaire.summaryProgressLabel': 'Correct answers',
  'questionnaire.tryAgain': 'Try again ({count} remaining)',
  'questionnaire.useThisScore': 'Use this score',
  'dialog.close': 'Close',
  'package.empty': 'This package does not contain any content.',
  'content.for': 'Content for {title}'
} as const

/** Canonical message ids, derived from the English dictionary. */
export type MessageId = keyof typeof en

/**
 * Brazilian Portuguese. Typing it as `Record<MessageId, string>` makes the
 * compiler reject a missing or unknown key, so both dictionaries always expose
 * exactly the same set.
 */
export const ptBR: Record<MessageId, string> = {
  'slides.previousPage': 'Página anterior',
  'slides.continueNextPage': 'Continuar para a próxima página',
  'scroll.loading': 'Carregando página',
  'scroll.locked': 'Conclua esta página para continuar.',
  'content.loadError': 'Não foi possível carregar este conteúdo.',
  'content.retry': 'Tentar novamente',
  'tiles.locked': 'Bloqueado',
  'path.label': 'Trilha',
  'path.visited': 'Visitada',
  'path.available': 'Disponível',
  'path.locked': 'Bloqueada',
  'video.label': 'Vídeo',
  'video.error': 'Não foi possível reproduzir este vídeo.',
  'video.requiredProgress': 'Visualização obrigatória: {percent}% assistida',
  'video.requiredComplete': 'Visualização obrigatória concluída',
  'questionnaire.previous': 'Pergunta anterior',
  'questionnaire.next': 'Próxima pergunta',
  'questionnaire.submit': 'Enviar questionário',
  'questionnaire.progressLabel': 'Progresso do questionário',
  'questionnaire.progress': 'Pergunta {current} de {total}',
  'questionnaire.answerRequired': 'Escolha uma resposta para continuar.',
  'questionnaire.summaryTitle': 'Questionário concluído',
  'questionnaire.summaryCorrect': '{correct} de {total} respostas corretas',
  'questionnaire.summaryProgressLabel': 'Respostas corretas',
  'questionnaire.tryAgain':
    'Tentar novamente ({count, plural, one {# restante} other {# restantes}})',
  'questionnaire.useThisScore': 'Usar esta pontuação',
  'dialog.close': 'Fechar',
  'package.empty': 'Este pacote não contém nenhum conteúdo.',
  'content.for': 'Conteúdo de {title}'
}

/** Complete message catalogs for every supported UI locale. */
export const messages: Record<PlayerLocale, Record<MessageId, string>> = {
  en,
  'pt-BR': ptBR
}

declare global {
  namespace FormatjsIntl {
    /**
     * Canonical message ids. Narrows `FormattedMessage`/`formatMessage` to the
     * shipped catalog, so an unknown or misspelled id is a compile-time error.
     */
    interface Message {
      ids: MessageId
    }

    /**
     * ICU argument contracts for the messages that interpolate runtime data.
     * Registering them makes the required values, and their types, explicit at
     * every call site.
     */
    interface MessageArguments {
      'questionnaire.progress': { current: number; total: number }
      'questionnaire.summaryCorrect': { correct: number; total: number }
      'video.requiredProgress': { percent: number }
      'content.for': { title: string }
    }

    /** The active UI locale is always one the player ships a catalog for. */
    interface IntlConfig {
      locale: PlayerLocale
    }
  }
}
