import type { PlayerState } from '@scorm-cli/core'
import type { ContentManifest } from './content-manifest'

type ManifestPage = ContentManifest['pages'][string]
type ManifestQuestion = ManifestPage['questions'][string]

/** A flat value: an option index, a decisecond value, a flag, or attempt counts. */
type CompactValue = number | readonly number[]

/**
 * Compact suspend-data payload: `v` is format version 1; `p` is the course
 * completion percentage (integer 0–100); `x` has one visited (`1`) or
 * unvisited (`0`) character per manifest page in page order; `s` is an optional
 * global questionnaire shuffle seed; and `d` is an optional compact state
 * dictionary.
 *
 * Keys in `d` are `<pageIndex>.<kind>.<entityIndex>`. The page index follows
 * `manifest.pages` order; entity indexes are local to their namespace and are
 * always resolved through the current manifest. The seven kinds are:
 * `a` answer option indexes (question index in the page's flattened questions),
 * `t` playback position in deciseconds (page-local video index), `w` accumulated
 * watch time in deciseconds, persisted only for videos with a positive
 * `minWatchTime` requirement (same video namespace as `t`, but distinct from
 * playback position), `q` correct-answer counts by attempt (page-local
 * questionnaire index), `r` active-retry flag (`1`), `c` completed flag (`1`),
 * and `i` active question as an offset local to that questionnaire. `q` stores
 * attempt history; `r` and `c` are flags, and either marker is meaningful only
 * with valid `q` history. The `i` offset is questionnaire-local, not a flattened
 * page question index.
 */
export interface CompactSuspendData {
  readonly v: 1
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
  const dataKinds = ['a', 't', 'w', 'q', 'r', 'c', 'i'] as const
  type DataKind = (typeof dataKinds)[number]

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

  /** Builds the single flat data key for a manifest page/kind/entity. */
  const makeDataKey = (pageIndex: string, kind: DataKind, entityIndex: string): string =>
    `${pageIndex}.${kind}.${entityIndex}`

  /**
   * Parses a flat data key. Returns undefined unless it is exactly three
   * segments: two canonical non-negative safe-integer indexes around a kind of
   * `a`, `t`, `w`, `q`, `r`, `c`, or `i`.
   */
  const parseDataKey = (
    key: string
  ): { pageIndex: string; kind: DataKind; entityIndex: string } | undefined => {
    const segments = key.split('.')

    if (segments.length !== 3) {
      return undefined
    }

    const [pageIndex, kind, entityIndex] = segments as [string, string, string]

    if (!dataKinds.includes(kind as DataKind)) {
      return undefined
    }

    if (!canonicalIndex(pageIndex) || !canonicalIndex(entityIndex)) {
      return undefined
    }

    return { pageIndex, kind: kind as DataKind, entityIndex }
  }

  /** Maps persisted option indexes back to semantic values through the manifest. */
  const resolveAnswer = (
    question: ManifestQuestion,
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

  /**
   * Resolves a questionnaire's flattened question range. The page-local
   * questionnaire and question indexes must both be dense, and question counts
   * must safely account for every flattened question.
   */
  const questionnaireQuestionRange = (
    page: ManifestPage,
    questionnaireIndex: string
  ): { start: number; count: number } | undefined => {
    if (
      !canonicalIndex(questionnaireIndex) ||
      !isRecord(page.questionnaires) ||
      !isRecord(page.questions)
    ) {
      return undefined
    }
    const questionnaireIndexes = Object.keys(page.questionnaires).sort(
      (left, right) => Number(left) - Number(right)
    )
    let start = 0
    let targetCount: number | undefined
    let targetStart: number | undefined
    for (let index = 0; index < questionnaireIndexes.length; index += 1) {
      const currentIndex = questionnaireIndexes[index]
      if (!canonicalIndex(currentIndex) || Number(currentIndex) !== index) return undefined
      const questionnaire = page.questionnaires[currentIndex]
      if (
        !isRecord(questionnaire) ||
        !Number.isSafeInteger(questionnaire.questionCount) ||
        (questionnaire.questionCount as number) < 0
      ) {
        return undefined
      }
      const count = questionnaire.questionCount as number
      if (currentIndex === questionnaireIndex) {
        if (typeof questionnaire.id !== 'string' || !safeKey(questionnaire.id)) return undefined
        targetCount = count
        targetStart = start
      }
      start += count
      if (!Number.isSafeInteger(start)) return undefined
    }
    if (targetCount === undefined || targetStart === undefined) return undefined

    const questionIndexes = Object.keys(page.questions).sort(
      (left, right) => Number(left) - Number(right)
    )
    if (
      questionIndexes.length !== start ||
      questionIndexes.some(
        (index, position) => !canonicalIndex(index) || Number(index) !== position
      )
    ) {
      return undefined
    }
    return { start: targetStart, count: targetCount }
  }

  /** Resolves a valid decisecond position to its semantic video ID and seconds. */
  function decodeVideoPosition(
    page: ManifestPage,
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
    page: ManifestPage,
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
    page: ManifestPage,
    questionIndex: string,
    value: unknown
  ): [string, string | string[]] | undefined {
    const question = (page.questions ?? {})[questionIndex]
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
      questionCount?: unknown
    }
    const id = fields.id
    const maxAttempts = fields.maxAttempts
    const questionCount = fields.questionCount
    if (
      typeof id !== 'string' ||
      !safeKey(id) ||
      typeof maxAttempts !== 'number' ||
      !validMaxAttempts(maxAttempts) ||
      typeof questionCount !== 'number' ||
      !Number.isSafeInteger(questionCount) ||
      questionCount < 0 ||
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
    page: ManifestPage,
    questionnaireIndex: string,
    value: unknown
  ): [string, number[]] | undefined {
    const usable = usableQuestionnaireHistory(page.questionnaires?.[questionnaireIndex], value)
    if (!usable) return undefined
    return [usable.id, [...usable.history]]
  }

  function decodeActiveQuestion(
    page: ManifestPage,
    questionnaireIndex: string,
    value: unknown
  ): [string, string] | undefined {
    if (!Number.isSafeInteger(value) || (value as number) < 0) return undefined
    const range = questionnaireQuestionRange(page, questionnaireIndex)
    if (!range || (value as number) >= range.count) return undefined
    const question = page.questions[String(range.start + (value as number))]
    const questionnaire = page.questionnaires?.[questionnaireIndex]
    if (
      !question ||
      typeof question.id !== 'string' ||
      !safeKey(question.id) ||
      !questionnaire ||
      typeof questionnaire.id !== 'string' ||
      !safeKey(questionnaire.id)
    ) {
      return undefined
    }
    return [questionnaire.id, question.id]
  }

  type QuestionnaireMarkerCandidate = {
    page: ManifestPage
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

  /** Flat `d` layout keyed by `<pageIndex>.<kind>.<entityIndex>`. */
  function decodeData(
    encoded: Record<string, unknown>,
    entries: Array<[string, ManifestPage]>
  ): Map<string, PlayerState['pages'][string]> {
    const pagesByIndex = new Map<string, ManifestPage>()
    entries.forEach(([pageIndex, page]) => {
      if (safeKey(page.id)) pagesByIndex.set(pageIndex, page)
    })
    const retryCandidates: QuestionnaireMarkerCandidate[] = []
    const completedCandidates: QuestionnaireMarkerCandidate[] = []
    const pageData = new Map<string, PlayerState['pages'][string]>()
    const pageStateFor = (page: ManifestPage): PlayerState['pages'][string] => {
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
              const answer = decodeAnswer(page, parsedKey.entityIndex, value)
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
    entries: Array<[string, ManifestPage]>,
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
          !validMaxAttempts(questionnaire.maxAttempts) ||
          !Number.isSafeInteger(questionnaire.questionCount) ||
          questionnaire.questionCount < 0
        ) {
          return
        }
        const activeQuestionId = pageState?.activeQuestionnaireItems?.[questionnaire.id]
        if (typeof activeQuestionId === 'string') {
          const range = questionnaireQuestionRange(page, questionnaireIndex)
          if (range) {
            for (let localIndex = 0; localIndex < range.count; localIndex += 1) {
              const question = page.questions[String(range.start + localIndex)]
              if (question && safeKey(question.id) && question.id === activeQuestionId) {
                encoded.push([makeDataKey(pageIndex, 'i', questionnaireIndex), localIndex])
                break
              }
            }
          }
        }
        const history = pageState?.questionnaireAttempts?.[questionnaire.id]
        if (
          !Array.isArray(history) ||
          history.length === 0 ||
          !withinAttemptLimit(history.length, questionnaire.maxAttempts) ||
          !history.every(
            (count) =>
              Number.isSafeInteger(count) && count >= 0 && count <= questionnaire.questionCount
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
    entries: Array<[string, ManifestPage]>,
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
    entries: Array<[string, ManifestPage]>,
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

      Object.entries(page.questions ?? {}).forEach(([questionIndex, question]) => {
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
          makeDataKey(pageIndex, 'a', questionIndex),
          question.type === 'multiple-choice' ? optionIndexes : optionIndexes[0]
        ])
      })
    })
    return encoded
  }

  function encode(
    manifest: ContentManifest,
    state: PlayerState,
    progress: number
  ): CompactSuspendData {
    const entries = Object.entries(manifest.pages)
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
      v: 1,
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

  function decode(manifest: ContentManifest, raw: unknown): PlayerState {
    const state: PlayerState = { pages: {} }
    try {
      const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (!isRecord(parsed)) {
        return state
      }
      const { v, p, x } = parsed
      const entries = Object.entries(manifest.pages)
      if (
        v !== 1 ||
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
        const sequential = manifest.presentation === 'scroll' || manifest.presentation === 'slides'
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
 * Encodes manifest-indexed progress/answers, manifest-owned video positions,
 * and accumulated watch seconds.
 */
export function encodeSuspendData(
  manifest: ContentManifest,
  state: PlayerState,
  progress: number
): CompactSuspendData {
  return codec.encode(manifest, state, progress)
}

/** Restores readable IDs/values only through the exact manifest dictionary. */
export function decodeSuspendData(manifest: ContentManifest, raw: unknown): PlayerState {
  return codec.decode(manifest, raw)
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
  function compactEncode(manifest, state, progress) {
    return JSON.stringify(suspendCodec.encode(manifest, state, progress));
  }
  function compactDecode(manifest, raw) {
    return suspendCodec.decode(manifest, raw);
  }`
}
