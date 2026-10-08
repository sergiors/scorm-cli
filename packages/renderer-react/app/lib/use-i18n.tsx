import { createContext, useContext, type ReactNode } from 'react';
import { DEFAULT_LOCALE, resolveLocale, type Locale } from './i18n';

/**
 * Every string the player generates itself, as opposed to authored content.
 * Titles, descriptions, prompts and options are never translated; only this
 * fixed chrome is. Values that interpolate authored data are functions so the
 * type records that they must not be pre-formatted.
 */
export interface Messages {
  scrollPreviousPage: string;
  scrollContinueNextPage: string;
  pathLabel: string;
  pathStatusVisited: string;
  pathStatusAvailable: string;
  pathStatusLocked: string;
  videoLabel: string;
  videoCaptions: string;
  questionnairePrevious: string;
  questionnaireNext: string;
  questionnaireSubmit: string;
  questionnaireDefaultPrevious: string;
  questionnaireDefaultSkip: string;
  questionnaireDefaultNext: string;
  questionnaireDefaultSubmit: string;
  dialogClose: string;
  emptyPackage: string;
  contentFor: (title: string) => string;
}

const en: Messages = {
  scrollPreviousPage: 'Previous page',
  scrollContinueNextPage: 'Continue to next page',
  pathLabel: 'Path',
  pathStatusVisited: 'Visited',
  pathStatusAvailable: 'Available',
  pathStatusLocked: 'Locked',
  videoLabel: 'Video',
  videoCaptions: 'Captions',
  questionnairePrevious: 'Previous question',
  questionnaireNext: 'Next question',
  questionnaireSubmit: 'Submit questionnaire',
  questionnaireDefaultPrevious: 'Previous',
  questionnaireDefaultSkip: 'Skip',
  questionnaireDefaultNext: 'Next',
  questionnaireDefaultSubmit: 'Submit',
  dialogClose: 'Close',
  emptyPackage: 'This package does not contain any content.',
  contentFor: (title) => `Content for ${title}`,
};

const ptBR: Messages = {
  scrollPreviousPage: 'Página anterior',
  scrollContinueNextPage: 'Continuar para a próxima página',
  pathLabel: 'Trilha',
  pathStatusVisited: 'Visitada',
  pathStatusAvailable: 'Disponível',
  pathStatusLocked: 'Bloqueada',
  videoLabel: 'Vídeo',
  videoCaptions: 'Legendas',
  questionnairePrevious: 'Pergunta anterior',
  questionnaireNext: 'Próxima pergunta',
  questionnaireSubmit: 'Enviar questionário',
  questionnaireDefaultPrevious: 'Anterior',
  questionnaireDefaultSkip: 'Pular',
  questionnaireDefaultNext: 'Próxima',
  questionnaireDefaultSubmit: 'Enviar',
  dialogClose: 'Fechar',
  emptyPackage: 'Este pacote não contém nenhum conteúdo.',
  contentFor: (title) => `Conteúdo de ${title}`,
};

const MESSAGES: Record<Locale, Messages> = { en, 'pt-BR': ptBR };

export interface I18nValue {
  /** Active UI locale after resolving the authored language tag. */
  locale: Locale;
  /** Message dictionary for {@link locale}. */
  t: Messages;
}

/**
 * Defaults to English so components stay usable — and their existing English
 * output unchanged — when rendered outside a provider (isolated tests, SSR of
 * a single subtree). {@link I18nProvider} overrides it per package.
 */
const I18nContext = createContext<I18nValue>({
  locale: DEFAULT_LOCALE,
  t: en,
});

export interface I18nProviderProps {
  /** Authored BCP-47 language tag from the package metadata. */
  lang?: string;
  children: ReactNode;
}

/**
 * Provides the resolved UI locale and its dictionary to the subtree. An absent
 * or unsupported language resolves to English while the document keeps its own
 * declared `lang` (set by the Vite HTML transform).
 */
export function I18nProvider({ lang, children }: I18nProviderProps) {
  const locale = resolveLocale(lang);
  return (
    <I18nContext.Provider value={{ locale, t: MESSAGES[locale] }}>
      {children}
    </I18nContext.Provider>
  );
}

/** Reads the active locale and message dictionary. Never throws. */
export function useI18n(): I18nValue {
  return useContext(I18nContext);
}
