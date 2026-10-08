import type { PlayerLocale } from '../i18n/locale';

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
  'scroll.previousPage': 'Previous page',
  'scroll.continueNextPage': 'Continue to next page',
  'path.label': 'Path',
  'path.visited': 'Visited',
  'path.available': 'Available',
  'path.locked': 'Locked',
  'video.label': 'Video',
  'video.captions': 'Captions',
  'questionnaire.previous': 'Previous question',
  'questionnaire.next': 'Next question',
  'questionnaire.submit': 'Submit questionnaire',
  'questionnaire.progressLabel': 'Questionnaire progress',
  'questionnaire.progress': 'Question {current} of {total}',
  'dialog.close': 'Close',
  'package.empty': 'This package does not contain any content.',
  'previewError.title': 'Content error',
  'previewError.hint':
    'Fix the content and save. The preview reloads automatically once the content is valid again.',
  'content.for': 'Content for {title}',
} as const;

/** Canonical message ids, derived from the English dictionary. */
export type MessageId = keyof typeof en;

/**
 * Brazilian Portuguese. Typing it as `Record<MessageId, string>` makes the
 * compiler reject a missing or unknown key, so both dictionaries always expose
 * exactly the same set.
 */
export const ptBR: Record<MessageId, string> = {
  'scroll.previousPage': 'Página anterior',
  'scroll.continueNextPage': 'Continuar para a próxima página',
  'path.label': 'Trilha',
  'path.visited': 'Visitada',
  'path.available': 'Disponível',
  'path.locked': 'Bloqueada',
  'video.label': 'Vídeo',
  'video.captions': 'Legendas',
  'questionnaire.previous': 'Pergunta anterior',
  'questionnaire.next': 'Próxima pergunta',
  'questionnaire.submit': 'Enviar questionário',
  'questionnaire.progressLabel': 'Progresso do questionário',
  'questionnaire.progress': 'Pergunta {current} de {total}',
  'dialog.close': 'Fechar',
  'package.empty': 'Este pacote não contém nenhum conteúdo.',
  'previewError.title': 'Erro de conteúdo',
  'previewError.hint':
    'Corrija o conteúdo e salve. A pré-visualização recarrega automaticamente assim que o conteúdo for válido novamente.',
  'content.for': 'Conteúdo de {title}',
};

/** Complete message catalogs for every supported UI locale. */
export const messages: Record<PlayerLocale, Record<MessageId, string>> = {
  en,
  'pt-BR': ptBR,
};

declare global {
  namespace FormatjsIntl {
    /**
     * Canonical message ids. Narrows `FormattedMessage`/`formatMessage` to the
     * shipped catalog, so an unknown or misspelled id is a compile-time error.
     */
    interface Message {
      ids: MessageId;
    }

    /**
     * ICU argument contracts for the messages that interpolate runtime data.
     * Registering them makes the required values, and their types, explicit at
     * every call site.
     */
    interface MessageArguments {
      'questionnaire.progress': { current: number; total: number };
      'content.for': { title: string };
    }

    /** The active UI locale is always one the player ships a catalog for. */
    interface IntlConfig {
      locale: PlayerLocale;
    }
  }
}
