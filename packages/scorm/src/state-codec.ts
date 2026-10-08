import type { AnswerValue, PlayerState } from '@scorm-cli/core';
import type { ContentManifest } from './content-manifest';

export interface CompactSuspendData {
  v: 1;
  p: number;
  x: string;
  d?: Record<string, { a?: Record<string, number | number[]> }>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const safeKey = (value: string) =>
  value.length > 0 &&
  value !== '__proto__' &&
  value !== 'prototype' &&
  value !== 'constructor';
const hasOwn = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);

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
  const pageEntries = Object.entries(manifest.pages);
  const encoded: CompactSuspendData = {
    v: 1,
    p: Number.isFinite(progress)
      ? Math.max(0, Math.min(100, Math.round(progress)))
      : 0,
    x: pageEntries
      .map(([, page]) =>
        safeKey(page.id) &&
        hasOwn(state.pages, page.id) &&
        state.pages[page.id]?.visited === true
          ? '1'
          : '0',
      )
      .join(''),
  };
  const dataByPage: Record<string, { a?: Record<string, number | number[]> }> =
    {};

  pageEntries.forEach(([pageIndex, page]) => {
    if (!safeKey(page.id)) return;
    if (!hasOwn(state.pages, page.id)) return;
    const pageState = state.pages[page.id];
    if (!pageState || !isRecord(pageState.answers)) return;
    const answers: Record<string, number | number[]> = {};
    for (const [questionIndex, question] of Object.entries(page.questions)) {
      if (!safeKey(question.id)) continue;
      const answer = pageState.answers[question.id];
      const optionIndexes = Object.entries(question.options)
        .filter(([, option]) =>
          Array.isArray(answer)
            ? answer.includes(option.value)
            : answer === option.value,
        )
        .map(([optionIndex]) => Number(optionIndex))
        .filter(Number.isSafeInteger)
        .sort((left, right) => left - right);
      if (optionIndexes.length === 0) continue;
      answers[questionIndex] =
        question.type === 'multiple-choice' ? optionIndexes : optionIndexes[0]!;
    }
    if (Object.keys(answers).length > 0) dataByPage[pageIndex] = { a: answers };
  });

  if (Object.keys(dataByPage).length > 0) encoded.d = dataByPage;
  return encoded;
}

/** Restores readable IDs/values only through the exact manifest dictionary. */
export function decodeSuspendData(
  manifest: ContentManifest,
  raw: unknown,
): PlayerState {
  const fresh: PlayerState = { pages: {} };
  try {
    const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (
      !isRecord(parsed) ||
      parsed.v !== 1 ||
      !Number.isInteger(parsed.p) ||
      (parsed.p as number) < 0 ||
      (parsed.p as number) > 100 ||
      typeof parsed.x !== 'string' ||
      !/^[01]*$/.test(parsed.x) ||
      parsed.x.length > Object.keys(manifest.pages).length
    ) {
      return fresh;
    }

    const data = parsed as Record<string, unknown>;
    const pageEntries = Object.entries(manifest.pages);
    const completedCount =
      manifest.presentation === 'scroll'
        ? Math.max(
            0,
            Math.min(
              pageEntries.length,
              Math.round(((data.p as number) * pageEntries.length) / 100),
            ),
          )
        : 0;
    pageEntries.forEach(([pageIndex, page], order) => {
      if (!safeKey(page.id)) return;
      const visited = (data.x as string)[order] === '1';
      const completed = order < completedCount;
      const pageState: PlayerState['pages'][string] = {};
      if (visited || completed) pageState.visited = true;
      if (completed) pageState.completed = true;

      const encodedPage = isRecord(data.d) ? data.d[pageIndex] : undefined;
      const encodedAnswers = isRecord(encodedPage) ? encodedPage.a : undefined;
      if (isRecord(encodedAnswers)) {
        const answers: Record<string, AnswerValue> = {};
        for (const [questionIndex, question] of Object.entries(
          page.questions,
        )) {
          if (!safeKey(question.id)) continue;
          const selection = encodedAnswers[questionIndex];
          const selections = Array.isArray(selection)
            ? selection
            : Number.isSafeInteger(selection)
              ? [selection]
              : [];
          const values = [...new Set(selections)]
            .filter(
              (index): index is number =>
                Number.isSafeInteger(index) && index >= 0,
            )
            .sort((left, right) => left - right)
            .map((index) => question.options[String(index)]?.value)
            .filter((value): value is string => typeof value === 'string');
          if (values.length === 0) continue;
          answers[question.id] =
            question.type === 'multiple-choice' ? values : values[0]!;
        }
        if (Object.keys(answers).length > 0) pageState.answers = answers;
      }
      if (Object.keys(pageState).length > 0) fresh.pages[page.id] = pageState;
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
        if (entry[1].id === "__proto__" || entry[1].id === "prototype" || entry[1].id === "constructor") return "0";
        var page = state && state.pages && Object.prototype.hasOwnProperty.call(state.pages, entry[1].id)
          ? state.pages[entry[1].id] : null;
        return page && page.visited === true ? "1" : "0";
      }).join("")
    };
    var dataByPage = Object.create(null);
    entries.forEach(function (entry) {
      var pageIndex = entry[0], page = entry[1];
      if (page.id === "__proto__" || page.id === "prototype" || page.id === "constructor") return;
      var pageState = state && state.pages && Object.prototype.hasOwnProperty.call(state.pages, page.id)
        ? state.pages[page.id] : null;
      if (!pageState || !pageState.answers || typeof pageState.answers !== "object") return;
      var answers = Object.create(null);
        Object.keys(page.questions).forEach(function (questionIndex) {
          var question = page.questions[questionIndex];
          if (question.id === "__proto__" || question.id === "prototype" || question.id === "constructor") return;
        var answer = pageState.answers[question.id];
        if (typeof answer !== "string" && !Array.isArray(answer)) return;
        var selected = Object.keys(question.options).filter(function (optionIndex) {
          var value = question.options[optionIndex].value;
          return Array.isArray(answer) ? answer.indexOf(value) >= 0 : answer === value;
        }).map(Number).filter(Number.isSafeInteger).sort(function (a, b) { return a - b; });
        if (selected.length) answers[questionIndex] = question.type === "multiple-choice" ? selected : selected[0];
      });
      if (Object.keys(answers).length) dataByPage[pageIndex] = { a: answers };
    });
    if (Object.keys(dataByPage).length) payload.d = dataByPage;
    return JSON.stringify(payload);
  }
  function compactDecode(manifest, raw) {
    var fresh = { pages: {} };
    try {
      if (typeof raw !== "string" || !raw) return fresh;
      var data = JSON.parse(raw);
      var count = Object.keys(manifest.pages).length;
      if (!data || typeof data !== "object" || Array.isArray(data) || data.v !== 1 ||
          !Number.isInteger(data.p) || data.p < 0 || data.p > 100 ||
          typeof data.x !== "string" || !/^[01]*$/.test(data.x) || data.x.length > count) return fresh;
      var entries = Object.keys(manifest.pages).map(function (key) { return [key, manifest.pages[key]]; });
      var completedCount = manifest.presentation === "scroll" ? Math.max(0, Math.min(count, Math.round(data.p * count / 100))) : 0;
      entries.forEach(function (entry, order) {
        var pageIndex = entry[0], page = entry[1], state = {};
        if (page.id === "__proto__" || page.id === "prototype" || page.id === "constructor") return;
        var visited = data.x.charAt(order) === "1", completed = order < completedCount;
        if (visited || completed) state.visited = true;
        if (completed) state.completed = true;
        var encodedPage = data.d && data.d[pageIndex];
        var encoded = encodedPage && typeof encodedPage === "object" && !Array.isArray(encodedPage) ? encodedPage.a : undefined;
        if (encoded && typeof encoded === "object" && !Array.isArray(encoded)) {
          var answers = {};
          Object.keys(page.questions).forEach(function (questionIndex) {
            var question = page.questions[questionIndex], selection = encoded[questionIndex];
            if (question.id === "__proto__" || question.id === "prototype" || question.id === "constructor") return;
            var selections = Array.isArray(selection) ? selection : Number.isSafeInteger(selection) ? [selection] : [];
            selections = selections.filter(function (index, indexAt, all) {
              return Number.isSafeInteger(index) && index >= 0 && all.indexOf(index) === indexAt;
            }).sort(function (a, b) { return a - b; });
            var values = selections.map(function (index) {
              return question.options[String(index)] && question.options[String(index)].value;
            }).filter(function (value) { return typeof value === "string"; });
            if (values.length) answers[question.id] = question.type === "multiple-choice" ? values : values[0];
          });
          if (Object.keys(answers).length) state.answers = answers;
        }
        if (Object.keys(state).length) fresh.pages[page.id] = state;
      });
      return fresh;
    } catch (_) { return fresh; }
  }`;
}
