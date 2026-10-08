import type { ReactNode } from 'react';
import { IntlProvider } from 'react-intl';
import { resolvePlayerLocale } from '../i18n/locale';
import { messages } from './messages';

export interface PlayerI18nProviderProps {
  /** Authored BCP-47 language tag from the package metadata. */
  lang?: string | null;
  children: ReactNode;
}

/**
 * Wraps the player in `react-intl`'s provider with the catalog for the locale
 * resolved from the authored language tag.
 *
 * This is the player's single i18n boundary: components read the active locale
 * and messages through `useIntl`/`FormattedMessage`. An absent or unsupported
 * tag resolves to English while the document keeps its own declared `lang`
 * (set by the Vite HTML transform), so the generated chrome and the document
 * language stay independent concerns.
 */
export function PlayerI18nProvider({
  lang,
  children,
}: PlayerI18nProviderProps) {
  const locale = resolvePlayerLocale(lang);
  return (
    <IntlProvider locale={locale} messages={messages[locale]}>
      {children}
    </IntlProvider>
  );
}
