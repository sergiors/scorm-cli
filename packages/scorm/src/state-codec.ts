import type { PlayerState } from '@scorm-cli/core';
import type { ContentManifest } from './content-manifest';

export interface CompactSuspendData {
  readonly v: 1;
  readonly p: number;
  readonly x: string;
  readonly d?: Readonly<
    Record<string, { readonly a?: Readonly<Record<string, number | readonly number[]>> }>
  >;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const safeKey = (value: string): boolean =>
  value.length > 0 && value !== '__proto__' && value !== 'prototype' && value !== 'constructor';

type PageEntry = readonly [index: string, page: ContentManifest['pages'][string]];
type EncodedAnswers = Record<string, number | number[]>;

interface ValidSuspendData {
  readonly p: number;
  readonly x: string;
  readonly d?: unknown;
}

function normalizeProgress(progress: number): number {
  if (!Number.isFinite(progress)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(progress)));
}

function pageEntries(manifest: ContentManifest): PageEntry[] {
  return Object.entries(manifest.pages);
}

function encodeVisitedPages(entries: readonly PageEntry[], state: PlayerState): string {
  return entries
    .map(([, page]) => {
      const pageState =
        safeKey(page.id) && Object.prototype.hasOwnProperty.call(state.pages, page.id)
          ? state.pages[page.id]
          : undefined;
      return pageState?.visited === true ? '1' : '0';
    })
    .join('');
}

function encodePageAnswers(
  page: ContentManifest['pages'][string],
  pageState: PlayerState['pages'][string],
): EncodedAnswers | undefined {
  if (!pageState || !isRecord(pageState.answers)) {
    return undefined;
  }

  const answers: EncodedAnswers = {};
  for (const [questionIndex, question] of Object.entries(page.questions)) {
    if (!safeKey(question.id)) {
      continue;
    }

    const answer = pageState.answers[question.id];
    const optionIndexes = Object.entries(question.options)
      .filter(([, option]) =>
        Array.isArray(answer) ? answer.includes(option.value) : answer === option.value,
      )
      .map(([optionIndex]) => Number(optionIndex))
      .filter(Number.isSafeInteger)
      .sort((left, right) => left - right);
    if (optionIndexes.length === 0) {
      continue;
    }

    answers[questionIndex] =
      question.type === 'multiple-choice' ? optionIndexes : optionIndexes[0]!;
  }
  return Object.keys(answers).length > 0 ? answers : undefined;
}

function encodeAnswersByPage(entries: readonly PageEntry[], state: PlayerState) {
  const dataByPage: Record<string, { a: EncodedAnswers }> = {};
  for (const [pageIndex, page] of entries) {
    if (!safeKey(page.id) || !Object.prototype.hasOwnProperty.call(state.pages, page.id)) {
      continue;
    }

    const answers = encodePageAnswers(page, state.pages[page.id]);
    if (answers) {
      dataByPage[pageIndex] = { a: answers };
    }
  }
  return dataByPage;
}

function isValidSuspendData(value: unknown, pageCount: number): value is ValidSuspendData {
  if (!isRecord(value)) {
    return false;
  }
  const { v, p, x } = value;
  return (
    v === 1 &&
    typeof p === 'number' &&
    Number.isInteger(p) &&
    p >= 0 &&
    p <= 100 &&
    typeof x === 'string' &&
    /^[01]*$/.test(x) &&
    x.length <= pageCount
  );
}

function completedPageCount(
  presentation: ContentManifest['presentation'],
  progress: number,
  pageCount: number,
): number {
  if (presentation !== 'scroll') {
    return 0;
  }
  return Math.max(0, Math.min(pageCount, Math.round((progress * pageCount) / 100)));
}

function decodePageAnswers(
  page: ContentManifest['pages'][string],
  encodedAnswers: unknown,
): PlayerState['pages'][string]['answers'] | undefined {
  if (!isRecord(encodedAnswers)) {
    return undefined;
  }

  const answers: NonNullable<PlayerState['pages'][string]['answers']> = {};
  for (const [questionIndex, question] of Object.entries(page.questions)) {
    if (!safeKey(question.id)) {
      continue;
    }

    const selection = encodedAnswers[questionIndex];
    const selections = Array.isArray(selection)
      ? selection
      : Number.isSafeInteger(selection)
        ? [selection]
        : [];
    const values = [...new Set(selections)]
      .filter((index): index is number => Number.isSafeInteger(index) && index >= 0)
      .sort((left, right) => left - right)
      .map((index) => question.options[String(index)]?.value)
      .filter((value): value is string => typeof value === 'string');
    if (values.length === 0) {
      continue;
    }

    answers[question.id] = question.type === 'multiple-choice' ? values : values[0]!;
  }
  return Object.keys(answers).length > 0 ? answers : undefined;
}

function decodePageState(
  pageIndex: string,
  page: ContentManifest['pages'][string],
  order: number,
  data: ValidSuspendData,
  completedCount: number,
): PlayerState['pages'][string] | undefined {
  if (!safeKey(page.id)) {
    return undefined;
  }

  const visited = data.x[order] === '1';
  const completed = order < completedCount;
  const pageState: PlayerState['pages'][string] = {};
  if (visited || completed) {
    pageState.visited = true;
  }
  if (completed) {
    pageState.completed = true;
  }

  const encodedPage = isRecord(data.d) ? data.d[pageIndex] : undefined;
  const encodedAnswers = isRecord(encodedPage) ? encodedPage.a : undefined;
  const answers = decodePageAnswers(page, encodedAnswers);
  if (answers) {
    pageState.answers = answers;
  }

  return Object.keys(pageState).length > 0 ? pageState : undefined;
}

/**
 * Encodes only manifest-indexed progress and answer selections. `p` is limited
 * to whole-number SCORM 1.2 percent (0..100); decoding rounds that percentage
 * to the nearest completed page because the format has no per-page completion
 * field.
 */
export function encodeSuspendData(
  manifest: ContentManifest,
  state: PlayerState,
  progress: number,
): CompactSuspendData {
  const entries = pageEntries(manifest);
  const dataByPage = encodeAnswersByPage(entries, state);
  return {
    v: 1,
    p: normalizeProgress(progress),
    x: encodeVisitedPages(entries, state),
    ...(Object.keys(dataByPage).length > 0 ? { d: dataByPage } : {}),
  };
}

/** Restores readable IDs/values only through the exact manifest dictionary. */
export function decodeSuspendData(manifest: ContentManifest, raw: unknown): PlayerState {
  const fresh: PlayerState = { pages: {} };
  try {
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const entries = pageEntries(manifest);
    if (!isValidSuspendData(parsed, entries.length)) {
      return fresh;
    }

    const completedCount = completedPageCount(manifest.presentation, parsed.p, entries.length);
    entries.forEach(([index, page], order) => {
      const pageState = decodePageState(index, page, order, parsed, completedCount);
      if (pageState) {
        fresh.pages[page.id] = pageState;
      }
    });
    return fresh;
  } catch {
    return fresh;
  }
}

/** Browser-compatible equivalent embedded verbatim into generated runtime. */
export function browserCodecSource(): string {
  return `
  function compactEncode(manifest, state, progress) {
    var entries = Object.keys(manifest.pages).map(function (key) { return [key, manifest.pages[key]]; });
    var payload = {
      v: 1,
      p: Math.max(0, Math.min(100, Math.round(Number.isFinite(progress) ? progress : 0))),
      x: entries.map(function (entry) {
        if (entry[1].id === "__proto__" || entry[1].id === "prototype" || entry[1].id === "constructor") {
          return "0";
        }
        var page = state && state.pages && Object.prototype.hasOwnProperty.call(state.pages, entry[1].id)
          ? state.pages[entry[1].id] : null;
        return page && page.visited === true ? "1" : "0";
      }).join("")
    };
    var dataByPage = Object.create(null);
    entries.forEach(function (entry) {
      var pageIndex = entry[0], page = entry[1];
      if (page.id === "__proto__" || page.id === "prototype" || page.id === "constructor") {
        return;
      }
      var pageState = state && state.pages && Object.prototype.hasOwnProperty.call(state.pages, page.id)
        ? state.pages[page.id] : null;
      if (!pageState || !pageState.answers || typeof pageState.answers !== "object") {
        return;
      }
      var answers = Object.create(null);
      Object.keys(page.questions).forEach(function (questionIndex) {
        var question = page.questions[questionIndex];
        if (question.id === "__proto__" || question.id === "prototype" || question.id === "constructor") {
          return;
        }
        var answer = pageState.answers[question.id];
        if (typeof answer !== "string" && !Array.isArray(answer)) {
          return;
        }
        var selected = Object.keys(question.options).filter(function (optionIndex) {
          var value = question.options[optionIndex].value;
          return Array.isArray(answer) ? answer.indexOf(value) >= 0 : answer === value;
        }).map(Number).filter(Number.isSafeInteger).sort(function (a, b) { return a - b; });
        if (selected.length) {
          answers[questionIndex] = question.type === "multiple-choice" ? selected : selected[0];
        }
      });
      if (Object.keys(answers).length) {
        dataByPage[pageIndex] = { a: answers };
      }
    });
    if (Object.keys(dataByPage).length) {
      payload.d = dataByPage;
    }
    return JSON.stringify(payload);
  }
  function compactDecode(manifest, raw) {
    var fresh = { pages: {} };
    try {
      if (typeof raw !== "string" || !raw) {
        return fresh;
      }
      var data = JSON.parse(raw);
      var count = Object.keys(manifest.pages).length;
      if (!data || typeof data !== "object" || Array.isArray(data) || data.v !== 1 ||
          !Number.isInteger(data.p) || data.p < 0 || data.p > 100 ||
          typeof data.x !== "string" || !/^[01]*$/.test(data.x) || data.x.length > count) {
        return fresh;
      }
      var entries = Object.keys(manifest.pages).map(function (key) { return [key, manifest.pages[key]]; });
      var completedCount = manifest.presentation === "scroll" ? Math.max(0, Math.min(count, Math.round(data.p * count / 100))) : 0;
      entries.forEach(function (entry, order) {
        var pageIndex = entry[0], page = entry[1], state = {};
        if (page.id === "__proto__" || page.id === "prototype" || page.id === "constructor") {
          return;
        }
        var visited = data.x.charAt(order) === "1", completed = order < completedCount;
        if (visited || completed) {
          state.visited = true;
        }
        if (completed) {
          state.completed = true;
        }
        var encodedPage = data.d && data.d[pageIndex];
        var encoded = encodedPage && typeof encodedPage === "object" && !Array.isArray(encodedPage) ? encodedPage.a : undefined;
        if (encoded && typeof encoded === "object" && !Array.isArray(encoded)) {
          var answers = {};
          Object.keys(page.questions).forEach(function (questionIndex) {
            var question = page.questions[questionIndex], selection = encoded[questionIndex];
            if (question.id === "__proto__" || question.id === "prototype" || question.id === "constructor") {
              return;
            }
            var selections = Array.isArray(selection) ? selection : Number.isSafeInteger(selection) ? [selection] : [];
            selections = selections.filter(function (index, indexAt, all) {
              return Number.isSafeInteger(index) && index >= 0 && all.indexOf(index) === indexAt;
            }).sort(function (a, b) { return a - b; });
            var values = selections.map(function (index) {
              return question.options[String(index)] && question.options[String(index)].value;
            }).filter(function (value) { return typeof value === "string"; });
            if (values.length) {
              answers[question.id] = question.type === "multiple-choice" ? values : values[0];
            }
          });
          if (Object.keys(answers).length) {
            state.answers = answers;
          }
        }
        if (Object.keys(state).length) {
          fresh.pages[page.id] = state;
        }
      });
      return fresh;
    } catch (_) {
      return fresh;
    }
  }`;
}
