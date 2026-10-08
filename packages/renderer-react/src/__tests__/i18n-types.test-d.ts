/**
 * Compile-time checks for the `FormatjsIntl` catalog augmentation. This file
 * lives under `src`, so `tsc` type-checks it, but its name does not match
 * Vitest's `*.test.{ts,tsx}` include, so it is never executed: the intentional
 * errors below are validated purely by the compiler. An `@ts-expect-error`
 * directive that stops erroring — because the id or its values became valid —
 * would itself fail the type-check.
 */
import type { IntlShape } from 'react-intl';
import { en, ptBR, type MessageId } from '../../app/lib/messages';

declare const intl: IntlShape;

// Canonical ids type-check, with or without interpolation values.
intl.formatMessage({ id: 'path.label' });
intl.formatMessage({ id: 'package.empty' });
intl.formatMessage({ id: 'content.for' }, { title: 'A title' });
intl.formatMessage({ id: 'questionnaire.progress' }, { current: 1, total: 2 });

// @ts-expect-error an unknown message id is rejected.
intl.formatMessage({ id: 'not.a.real.message' });
// @ts-expect-error interpolation values are type-checked.
intl.formatMessage({ id: 'content.for' }, { title: 42 });

// Both catalogs expose exactly the canonical key set.
const canonicalEnglish: Record<MessageId, string> = en;
const canonicalPortuguese: Record<MessageId, string> = ptBR;
void canonicalEnglish;
void canonicalPortuguese;
