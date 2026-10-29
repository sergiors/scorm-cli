import type { PlayerState } from '@scorm-cli/core'
import type { ScoIndex } from './sco-index'

type ScoPage = ScoIndex['pages'][string]
type ScoQuestionnaire = NonNullable<ScoPage['questionnaires']>[string]
type ScoQuestion = ScoQuestionnaire['questions'][string]

/** A flat value: an option index, a decisecond value, a flag, or attempt counts. */
type CompactValue = number | readonly number[]

/**
 * Compact suspend-data payload: `v` is format version 2; `p` is the course
 * completion percentage (integer 0–100); `x` has one visited (`1`) or
 * unvisited (`0`) character per SCO-index page in page order; `s` is an optional
 * global questionnaire shuffle seed; and `d` is an optional compact state
 * dictionary.
 *
 * Answer keys in `d` are `<pageIndex>.a.<questionnaireIndex>.<questionIndex>`;
 * other keys are `<pageIndex>.<kind>.<entityIndex>`. Indexes are resolved through
 * the current SCO index. The seven kinds are:
 * `a` answer option indexes (question index local to its questionnaire),
 * `t` playback position in deciseconds (page-local video index), `w` accumulated
 * watch time in deciseconds, persisted only for videos with a positive
 * `minWatchTime` requirement (same video namespace as `t`, but distinct from
 * playback position), `q` correct-answer counts by attempt (page-local
 * questionnaire index), `r` active-retry flag (`1`), `c` completed flag (`1`),
 * and `i` active question as an index local to that questionnaire. `q` stores
 * attempt history; `r` and `c` are flags, and either marker is meaningful only
 * with valid `q` history.
 */
export interface CompactSuspendData {
  readonly v: 2
  readonly p: number
  readonly x: string
  readonly s?: number
  readonly d?: Readonly<Record<string, CompactValue>>
}

/**
 * The codec implementation is deliberately self-contained so this same
 * browser-safe behavior can be used by Node and embedded in the SCO runtime.
 */
function createSuspendDataCodec() {
  const pageLocalKinds = ['t', 'w', 'q', 'r', 'c', 'i'] as const
  type PageLocalKind = (typeof pageLocalKinds)[number]

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
  const safeKey = (value: string): boolean =>
    value.length > 0 && value !== '__proto__' && value !== 'prototype' && value !== 'constructor'
  const canonicalIndex = (value: string): boolean =>
    value.length > 0 &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) >= 0 &&
    String(Number(value)) === value
  const safeVideoIndex = (value: string): boolean => safeKey(value) && canonicalIndex(value)
  const validMaxAttempts = (value: number): boolean =>
    Number.isSafeInteger(value) && (value === -1 || value >= 1)
  const withinAttemptLimit = (historyLength: number, maxAttempts: number): boolean =>
    maxAttempts === -1 || historyLength <= maxAttempts

  const isPositiveSeconds = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0

  /** Builds a three-part page-local key for a non-answer entity. */
  const makeDataKey = (pageIndex: string, kind: PageLocalKind, entityIndex: string): string =>
    `${pageIndex}.${kind}.${entityIndex}`

  const makeAnswerKey = (
    pageIndex: string,
    questionnaireIndex: string,
    questionIndex: string
  ): string => `${pageIndex}.a.${questionnaireIndex}.${questionIndex}`

  /**
   * Parses four-part answer keys separately from three-part page-local keys.
   */
  const parseDataKey = (
    key: string
  ):
    | { pageIndex: string; kind: 'a'; questionnaireIndex: string; questionIndex: string }
    | { pageIndex: string; kind: PageLocalKind; entityIndex: string }
    | undefined => {
    const segments = key.split('.')
    if (segments[1] === 'a') {
      if (segments.length !== 4) return undefined
      const [pageIndex, , questionnaireIndex, questionIndex] = segments
      if (
        !canonicalIndex(pageIndex) ||
        !canonicalIndex(questionnaireIndex) ||
        !canonicalIndex(questionIndex)
      ) {
        return undefined
      }
      return { pageIndex, kind: 'a', questionnaireIndex, questionIndex }
    }
    if (segments.length !== 3) return undefined
    const [pageIndex, kind, entityIndex] = segments
    if (
      !pageLocalKinds.includes(kind as PageLocalKind) ||
      !canonicalIndex(pageIndex) ||
      !canonicalIndex(entityIndex)
    ) {
      return undefined
    }
    return { pageIndex, kind: kind as PageLocalKind, entityIndex }
  }

  /** Maps persisted option indexes back to semantic values through the SCO index. */
  const resolveAnswer = (
    question: ScoQuestion,
    selection: unknown
  ): string | string[] | undefined => {
    const selections = Array.isArray(selection)
      ? selection
      : Number.isSafeInteger(selection)
        ? [selection]
        : []
    const values = [...new Set(selections)]
      .filter((index): index is number => Number.isSafeInteger(index) && index >= 0)
      .sort((left, right) => left - right)
      .map((index) => question.options[String(index)]?.value)
      .filter((value): value is string => typeof value === 'string')
    if (values.length === 0) return undefined
    return question.type === 'multiple-choice' ? values : values[0]
  }

  /** Returns the number of nested question entries for attempt-count bounds. */
  const questionnaireQuestionCount = (questionnaire: unknown): number | undefined => {
    if (!isRecord(questionnaire) || !isRecord(questionnaire.questions)) return undefined
    return Object.keys(questionnaire.questions).length
  }

  /** Resolves a valid decisecond position to its semantic video ID and seconds. */
  function decodeVideoPosition(
    page: ScoPage,
    videoIndex: string,
    deciseconds: unknown
  ): [string, number] | undefined {
    if (
      !safeVideoIndex(videoIndex) ||
      typeof deciseconds !== 'number' ||
      !Number.isSafeInteger(deciseconds) ||
      deciseconds < 0
    ) {
      return undefined
    }
    const video = page.videos?.[videoIndex]
    if (!isRecord(video) || !safeKey(video.id)) return undefined
    return [video.id, deciseconds / 10]
  }

  /** Resolves accumulated watch seconds only for videos with a positive requirement. */
  function decodeVideoWatchSeconds(
    page: ScoPage,
    videoIndex: string,
    deciseconds: unknown
  ): [string, number] | undefined {
    if (
      !safeVideoIndex(videoIndex) ||
      typeof deciseconds !== 'number' ||
      !Number.isSafeInteger(deciseconds) ||
      deciseconds <= 0
    ) {
      return undefined
    }
    const video = page.videos?.[videoIndex]
    if (!isRecord(video) || !safeKey(video.id) || !isPositiveSeconds(video.minWatchTime)) {
      return undefined
    }
    const seconds = Math.min(deciseconds / 10, video.minWatchTime)
    return [video.id, seconds]
  }

  function decodeAnswer(
    page: ScoPage,
    questionnaireIndex: string,
    questionIndex: string,
    value: unknown
  ): [string, string | string[]] | undefined {
    const question = page.questionnaires?.[questionnaireIndex]?.questions?.[questionIndex]
    if (!question || !safeKey(question.id)) return undefined
    const answer = resolveAnswer(question, value)
    if (answer === undefined) return undefined
    return [question.id, answer]
  }

  function usableQuestionnaireHistory(
    questionnaire: unknown,
    history: unknown
  ): { id: string; history: number[] } | undefined {
    if (!questionnaire) return undefined
    const fields = questionnaire as {
      id?: unknown
      maxAttempts?: unknown
    }
    const id = fields.id
    const maxAttempts = fields.maxAttempts
    const questionCount = questionnaireQuestionCount(questionnaire)
    if (
      typeof id !== 'string' ||
      !safeKey(id) ||
      typeof maxAttempts !== 'number' ||
      !validMaxAttempts(maxAttempts) ||
      questionCount === undefined ||
      !Array.isArray(history) ||
      history.length === 0 ||
      !withinAttemptLimit(history.length, maxAttempts) ||
      !history.every(
        (count) =>
          typeof count === 'number' &&
          Number.isSafeInteger(count) &&
          count >= 0 &&
          count <= questionCount
      )
    ) {
      return undefined
    }
    return { id, history: history as number[] }
  }

  function decodeQuestionnaireAttempts(
    page: ScoPage,
    questionnaireIndex: string,
    value: unknown
  ): [string, number[]] | undefined {
    const usable = usableQuestionnaireHistory(page.questionnaires?.[questionnaireIndex], value)
    if (!usable) return undefined
    return [usable.id, [...usable.history]]
  }

  function decodeActiveQuestion(
    page: ScoPage,
    questionnaireIndex: string,
    value: unknown
  ): [string, string] | undefined {
    if (!Number.isSafeInteger(value) || (value as number) < 0) return undefined
    const questionnaire = page.questionnaires?.[questionnaireIndex]
    if (!isRecord(questionnaire) || !isRecord(questionnaire.questions)) return undefined
    const question = questionnaire.questions[String(value)]
    if (
      !isRecord(question) ||
      typeof question.id !== 'string' ||
      !safeKey(question.id) ||
      typeof questionnaire.id !== 'string' ||
      !safeKey(questionnaire.id)
    ) {
      return undefined
    }
    return [questionnaire.id, question.id]
  }

  type QuestionnaireMarkerCandidate = {
    page: ScoPage
    questionnaireIndex: string
  }
  type QuestionnaireMarkerEntry = {
    pageId: string
    questionnaireId: string
  }

  function resolveCompletedQuestionnaireMarkers(
    candidates: QuestionnaireMarkerCandidate[],
    pageData: Map<string, PlayerState['pages'][string]>
  ): QuestionnaireMarkerEntry[] {
    const markers: QuestionnaireMarkerEntry[] = []
    for (const { page, questionnaireIndex } of candidates) {
      const questionnaire = page.questionnaires?.[questionnaireIndex]
      if (!questionnaire) continue
      const history = pageData.get(page.id)?.questionnaireAttempts?.[questionnaire.id]
      const usable = usableQuestionnaireHistory(questionnaire, history)
      if (!usable) continue
      markers.push({ pageId: page.id, questionnaireId: usable.id })
    }
    return markers
  }

  function resolveRetryQuestionnaireMarkers(
    candidates: QuestionnaireMarkerCandidate[],
    pageData: Map<string, PlayerState['pages'][string]>,
    completedMarkers: QuestionnaireMarkerEntry[]
  ): QuestionnaireMarkerEntry[] {
    const markers: QuestionnaireMarkerEntry[] = []
    for (const { page, questionnaireIndex } of candidates) {
      const questionnaire = page.questionnaires?.[questionnaireIndex]
      if (!questionnaire) continue
      const history = pageData.get(page.id)?.questionnaireAttempts?.[questionnaire.id]
      const usable = usableQuestionnaireHistory(questionnaire, history)
      if (
        !usable ||
        (questionnaire.maxAttempts !== -1 && usable.history.length >= questionnaire.maxAttempts) ||
        completedMarkers.some(
          (marker) => marker.pageId === page.id && marker.questionnaireId === usable.id
        )
      ) {
        continue
      }
      markers.push({ pageId: page.id, questionnaireId: usable.id })
    }
    return markers
  }

  /** `d` uses nested indexes for answers and page-local indexes for other kinds. */
  function decodeData(
    encoded: Record<string, unknown>,
    entries: Array<[string, ScoPage]>
  ): Map<string, PlayerState['pages'][string]> {
    const pagesByIndex = new Map<string, ScoPage>()
    entries.forEach(([pageIndex, page]) => {
      if (safeKey(page.id)) pagesByIndex.set(pageIndex, page)
    })
    const retryCandidates: QuestionnaireMarkerCandidate[] = []
    const completedCandidates: QuestionnaireMarkerCandidate[] = []
    const pageData = new Map<string, PlayerState['pages'][string]>()
    const pageStateFor = (page: ScoPage): PlayerState['pages'][string] => {
      let pageState = pageData.get(page.id)
      if (!pageState) {
        pageState = {}
        pageData.set(page.id, pageState)
      }
      return pageState
    }
    try {
      Object.entries(encoded).forEach(([key, value]) => {
        const parsedKey = parseDataKey(key)
        const page = parsedKey && pagesByIndex.get(parsedKey.pageIndex)
        if (!parsedKey || !page) return
        switch (parsedKey.kind) {
          case 'a':
            {
              const answer = decodeAnswer(
                page,
                parsedKey.questionnaireIndex,
                parsedKey.questionIndex,
                value
              )
              if (answer) {
                const pageState = pageStateFor(page)
                const answers = pageState.answers ?? (pageState.answers = {})
                answers[answer[0]] = answer[1]
              }
            }
            break
          case 't':
            {
              const position = decodeVideoPosition(page, parsedKey.entityIndex, value)
              if (position) {
                const pageState = pageStateFor(page)
                const videos = pageState.videos ?? (pageState.videos = {})
                videos[position[0]] = position[1]
              }
            }
            break
          case 'w':
            {
              const watch = decodeVideoWatchSeconds(page, parsedKey.entityIndex, value)
              if (watch) {
                const pageState = pageStateFor(page)
                const watched = pageState.videoWatchSeconds ?? (pageState.videoWatchSeconds = {})
                watched[watch[0]] = watch[1]
              }
            }
            break
          case 'q':
            {
              const attempts = decodeQuestionnaireAttempts(page, parsedKey.entityIndex, value)
              if (attempts) {
                const pageState = pageStateFor(page)
                const histories =
                  pageState.questionnaireAttempts ?? (pageState.questionnaireAttempts = {})
                histories[attempts[0]] = attempts[1]
              }
            }
            break
          case 'r':
            if (value === 1)
              retryCandidates.push({ page, questionnaireIndex: parsedKey.entityIndex })
            break
          case 'c':
            if (value === 1)
              completedCandidates.push({ page, questionnaireIndex: parsedKey.entityIndex })
            break
          case 'i':
            {
              const active = decodeActiveQuestion(page, parsedKey.entityIndex, value)
              if (active) {
                const pageState = pageStateFor(page)
                const items =
                  pageState.activeQuestionnaireItems ?? (pageState.activeQuestionnaireItems = {})
                items[active[0]] = active[1]
              }
            }
            break
        }
      })
    } catch {
      return pageData
    }
    // Resolve markers after the pass so histories are restored regardless of JSON key order.
    const completedMarkers = resolveCompletedQuestionnaireMarkers(completedCandidates, pageData)
    for (const marker of completedMarkers) {
      const pageState = pageData.get(marker.pageId)!
      const completed =
        pageState.completedQuestionnaires ?? (pageState.completedQuestionnaires = [])
      completed.push(marker.questionnaireId)
    }
    const retryMarkers = resolveRetryQuestionnaireMarkers(
      retryCandidates,
      pageData,
      completedMarkers
    )
    for (const marker of retryMarkers) {
      const pageState = pageData.get(marker.pageId)!
      const retries =
        pageState.activeQuestionnaireRetries ?? (pageState.activeQuestionnaireRetries = [])
      retries.push(marker.questionnaireId)
    }
    return pageData
  }

  function encodeQuestionnaires(
    entries: Array<[string, ScoPage]>,
    state: PlayerState
  ): Array<[string, CompactValue]> {
    const encoded: Array<[string, CompactValue]> = []
    entries.forEach(([pageIndex, page]) => {
      if (
        !canonicalIndex(pageIndex) ||
        !safeKey(page.id) ||
        !Object.prototype.hasOwnProperty.call(state.pages, page.id)
      ) {
        return
      }
      const pageState = state.pages[page.id]
      Object.entries(page.questionnaires ?? {}).forEach(([questionnaireIndex, questionnaire]) => {
        if (
          !canonicalIndex(questionnaireIndex) ||
          !isRecord(questionnaire) ||
          !safeKey(questionnaire.id) ||
          !validMaxAttempts(questionnaire.maxAttempts)
        ) {
          return
        }
        const questionCount = questionnaireQuestionCount(questionnaire)
        if (questionCount === undefined) return
        const activeQuestionId = pageState?.activeQuestionnaireItems?.[questionnaire.id]
        if (typeof activeQuestionId === 'string' && isRecord(questionnaire.questions)) {
          const activeQuestion = Object.entries(questionnaire.questions).find(
            ([questionIndex, question]) =>
              canonicalIndex(questionIndex) &&
              isRecord(question) &&
              typeof question.id === 'string' &&
              safeKey(question.id) &&
              question.id === activeQuestionId
          )
          if (activeQuestion) {
            encoded.push([
              makeDataKey(pageIndex, 'i', questionnaireIndex),
              Number(activeQuestion[0])
            ])
          }
        }
        const history = pageState?.questionnaireAttempts?.[questionnaire.id]
        if (
          !Array.isArray(history) ||
          history.length === 0 ||
          !withinAttemptLimit(history.length, questionnaire.maxAttempts) ||
          !history.every(
            (count) => Number.isSafeInteger(count) && count >= 0 && count <= questionCount
          )
        ) {
          return
        }
        encoded.push([makeDataKey(pageIndex, 'q', questionnaireIndex), [...history]])
        const isCompleted = pageState?.completedQuestionnaires?.includes(questionnaire.id) === true
        if (isCompleted) {
          encoded.push([makeDataKey(pageIndex, 'c', questionnaireIndex), 1])
        } else if (
          pageState?.activeQuestionnaireRetries?.includes(questionnaire.id) &&
          (questionnaire.maxAttempts === -1 || history.length < questionnaire.maxAttempts)
        ) {
          encoded.push([makeDataKey(pageIndex, 'r', questionnaireIndex), 1])
        }
      })
    })
    return encoded
  }

  function encodeVideos(
    entries: Array<[string, ScoPage]>,
    state: PlayerState
  ): Array<[string, CompactValue]> {
    const encoded: Array<[string, CompactValue]> = []
    entries.forEach(([pageIndex, page]) => {
      if (!canonicalIndex(pageIndex) || !safeKey(page.id) || !isRecord(page.videos)) return
      const pageState = state.pages[page.id]
      const videoPositions = isRecord(pageState?.videos) ? pageState.videos : {}
      const videoWatchSeconds = isRecord(pageState?.videoWatchSeconds)
        ? pageState.videoWatchSeconds
        : {}
      Object.entries(page.videos).forEach(([videoIndex, video]) => {
        if (!safeVideoIndex(videoIndex) || !isRecord(video) || !safeKey(video.id)) return
        const seconds = videoPositions[video.id]
        if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) {
          const deciseconds = Math.round(seconds * 10)
          if (Number.isSafeInteger(deciseconds) && deciseconds !== 0) {
            encoded.push([makeDataKey(pageIndex, 't', videoIndex), deciseconds])
          }
        }

        if (!isPositiveSeconds(video.minWatchTime)) return
        const watched = videoWatchSeconds[video.id]
        if (typeof watched !== 'number' || !Number.isFinite(watched) || watched <= 0) return
        const bounded = Math.min(watched, video.minWatchTime)
        const deciseconds = Math.round(bounded * 10)
        if (!Number.isSafeInteger(deciseconds) || deciseconds === 0) return
        encoded.push([makeDataKey(pageIndex, 'w', videoIndex), deciseconds])
      })
    })
    return encoded
  }

  function encodeAnswers(
    entries: Array<[string, ScoPage]>,
    state: PlayerState
  ): Array<[string, CompactValue]> {
    const encoded: Array<[string, CompactValue]> = []
    entries.forEach(([pageIndex, page]) => {
      if (
        !canonicalIndex(pageIndex) ||
        !safeKey(page.id) ||
        !Object.prototype.hasOwnProperty.call(state.pages, page.id)
      ) {
        return
      }
      const pageAnswers = state.pages[page.id]?.answers
      if (!isRecord(pageAnswers)) return

      Object.entries(page.questionnaires ?? {}).forEach(([questionnaireIndex, questionnaire]) => {
        if (!canonicalIndex(questionnaireIndex) || !isRecord(questionnaire.questions)) return
        Object.entries(questionnaire.questions).forEach(([questionIndex, question]) => {
          if (!canonicalIndex(questionIndex) || !safeKey(question.id)) return
          const answer = pageAnswers[question.id]
          const optionIndexes = Object.entries(question.options)
            .filter(([, option]) =>
              Array.isArray(answer) ? answer.includes(option.value) : answer === option.value
            )
            .map(([optionIndex]) => Number(optionIndex))
            .filter(Number.isSafeInteger)
            .sort((left, right) => left - right)
          if (optionIndexes.length === 0) return
          encoded.push([
            makeAnswerKey(pageIndex, questionnaireIndex, questionIndex),
            question.type === 'multiple-choice' ? optionIndexes : optionIndexes[0]
          ])
        })
      })
    })
    return encoded
  }

  function encode(scoIndex: ScoIndex, state: PlayerState, progress: number): CompactSuspendData {
    const entries = Object.entries(scoIndex.pages)
    const normalizedProgress = Number.isFinite(progress)
      ? Math.max(0, Math.min(100, Math.round(progress)))
      : 0
    const visited = entries
      .map(([, page]) => {
        const pageState =
          safeKey(page.id) && Object.prototype.hasOwnProperty.call(state.pages, page.id)
            ? state.pages[page.id]
            : undefined
        return pageState?.visited === true ? '1' : '0'
      })
      .join('')
    const data: Record<string, CompactValue> = Object.create(null)
    const dataEntries = encodeQuestionnaires(entries, state).concat(
      encodeVideos(entries, state),
      encodeAnswers(entries, state)
    )
    dataEntries.forEach(([key, value]) => {
      data[key] = value
    })

    return {
      v: 2,
      p: normalizedProgress,
      x: visited,
      ...(typeof state.shuffleSeed === 'number' &&
      Number.isSafeInteger(state.shuffleSeed) &&
      state.shuffleSeed >= 0
        ? { s: state.shuffleSeed }
        : {}),
      ...(Object.keys(data).length > 0 ? { d: data } : {})
    }
  }

  function decode(scoIndex: ScoIndex, raw: unknown): PlayerState {
    const state: PlayerState = { pages: {} }
    try {
      if (!isRecord(scoIndex) || scoIndex.schemaVersion !== 1) return state
      const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (!isRecord(parsed)) {
        return state
      }
      const { v, p, x } = parsed
      const entries = Object.entries(scoIndex.pages)
      if (
        v !== 2 ||
        typeof p !== 'number' ||
        !Number.isInteger(p) ||
        p < 0 ||
        p > 100 ||
        typeof x !== 'string' ||
        !/^[01]*$/.test(x)
      ) {
        return state
      }
      if (typeof parsed.s === 'number' && Number.isSafeInteger(parsed.s) && parsed.s >= 0) {
        state.shuffleSeed = parsed.s
      }

      // Page-indexed data is only meaningful when its visited bitmap is not
      // oversized for the current page list.
      const pageIndexed = x.length <= entries.length
      if (pageIndexed) {
        // Sequential page presentations persist completion as progress and
        // reconstruct it here so a resume that only kept `p` stays gated. A
        // tiled presentation's items are done once opened, which the visited
        // bitmap already records, so it derives no completion from progress.
        const sequential = scoIndex.presentation === 'scroll' || scoIndex.presentation === 'slides'
        const completedCount = sequential
          ? Math.max(0, Math.min(entries.length, Math.round((p * entries.length) / 100)))
          : 0
        entries.forEach(([, page], order) => {
          if (!safeKey(page.id)) {
            return
          }
          const pageState: PlayerState['pages'][string] = {}
          const completed = order < completedCount
          if (x[order] === '1' || completed) {
            pageState.visited = true
          }
          if (completed) {
            pageState.completed = true
          }
          if (Object.keys(pageState).length > 0) {
            state.pages[page.id] = pageState
          }
        })
      }

      const encoded = parsed.d
      if (pageIndexed && isRecord(encoded)) {
        const pageData = decodeData(encoded, entries)
        pageData.forEach((pageState, pageId) => {
          const existing = state.pages[pageId]
          if (existing) {
            Object.assign(existing, pageState)
          } else {
            state.pages[pageId] = pageState
          }
        })
      }
      return state
    } catch {
      return state
    }
  }

  return { encode, decode }
}

const codec = createSuspendDataCodec()

/**
 * Encodes SCO-indexed progress/answers, SCO-indexed video positions,
 * and accumulated watch seconds.
 */
export function encodeSuspendData(
  scoIndex: ScoIndex,
  state: PlayerState,
  progress: number
): CompactSuspendData {
  return codec.encode(scoIndex, state, progress)
}

/** Restores readable IDs/values only through the exact SCO index. */
export function decodeSuspendData(scoIndex: ScoIndex, raw: unknown): PlayerState {
  return codec.decode(scoIndex, raw)
}

/** Embeds the same codec implementation used by the Node exports. */
export function browserCodecSource(): string {
  // Source runners such as `tsx` compile this function with esbuild's
  // `keepNames` transform, which wraps nested functions in `__name(...)` calls
  // to preserve their names. That helper is not part of the serialized
  // function, so the generated browser script would throw `__name is not
  // defined` before the runtime can install its bridge. Provide the same tiny
  // helper before the codec; it is unused by production builds, where
  // `toString()` contains no wrappers.
  return `var __name = function (target, name) {
  try { Object.defineProperty(target, "name", { value: name, configurable: true }); } catch (_) {}
  return target;
};
var suspendCodec = (${createSuspendDataCodec.toString()})();
  function compactEncode(scoIndex, state, progress) {
    return JSON.stringify(suspendCodec.encode(scoIndex, state, progress));
  }
  function compactDecode(scoIndex, raw) {
    return suspendCodec.decode(scoIndex, raw);
  }`
}
