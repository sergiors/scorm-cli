import type { PlayerState } from '@scorm-cli/core'
import type { ContentManifest } from './content-manifest'

type ManifestPage = ContentManifest['pages'][string]
type ManifestQuestion = ManifestPage['questions'][string]

/** A single flat value: answer option indexes or video deciseconds. */
type CompactValue = number | readonly number[]

/**
 * Compact suspend-data payload. Keys in `d` are
 * `<pageIndex>.<kind>.<entityIndex>` where `kind` is `a` (answer), `t`
 * (video position), `q` (questionnaire attempt history), `r` (active retry),
 * `c` (completed questionnaire), or `i` (active stepper question).
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

  /** Builds the single flat data key for a manifest page/kind/entity. */
  const makeDataKey = (
    pageIndex: string,
    kind: 'a' | 't' | 'q' | 'r' | 'c' | 'i',
    entityIndex: string
  ): string => `${pageIndex}.${kind}.${entityIndex}`

  /**
   * Parses a flat data key. Returns undefined unless it is exactly three
   * segments: two canonical non-negative safe-integer indexes around a kind of
   * `a`, `t`, `q`, `r`, `c`, or `i`.
   */
  const parseDataKey = (
    key: string
  ):
    | { pageIndex: string; kind: 'a' | 't' | 'q' | 'r' | 'c' | 'i'; entityIndex: string }
    | undefined => {
    const segments = key.split('.')
    if (segments.length !== 3) return undefined
    const [pageIndex, kind, entityIndex] = segments as [string, string, string]
    if (
      kind !== 'a' &&
      kind !== 't' &&
      kind !== 'q' &&
      kind !== 'r' &&
      kind !== 'c' &&
      kind !== 'i'
    ) {
      return undefined
    }
    if (!canonicalIndex(pageIndex) || !canonicalIndex(entityIndex)) return undefined
    return { pageIndex, kind, entityIndex }
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

  /** Stores one valid decisecond position under its semantic video ID. */
  function assignVideoPosition(
    fresh: PlayerState,
    page: ManifestPage,
    videoIndex: string,
    deciseconds: unknown
  ): void {
    if (
      !safeVideoIndex(videoIndex) ||
      typeof deciseconds !== 'number' ||
      !Number.isSafeInteger(deciseconds) ||
      deciseconds < 0
    ) {
      return
    }
    const video = page.videos?.[videoIndex]
    if (!isRecord(video) || !safeKey(video.id)) return
    const pageState = fresh.pages[page.id] ?? (fresh.pages[page.id] = {})
    const videos = pageState.videos ?? (pageState.videos = {})
    videos[video.id] = deciseconds / 10
  }

  /** Flat `d` layout keyed by `<pageIndex>.<kind>.<entityIndex>`. */
  function decodeData(
    encoded: Record<string, unknown>,
    entries: Array<[string, ManifestPage]>,
    fresh: PlayerState,
    pageIndexed: boolean
  ): void {
    const pagesByIndex = new Map<string, ManifestPage>()
    entries.forEach(([pageIndex, page]) => {
      if (safeKey(page.id)) pagesByIndex.set(pageIndex, page)
    })
    const retryCandidates: Array<{ page: ManifestPage; questionnaireIndex: string }> = []
    const completedCandidates: Array<{ page: ManifestPage; questionnaireIndex: string }> = []
    Object.entries(encoded).forEach(([key, value]) => {
      const parsedKey = parseDataKey(key)
      if (!parsedKey) return
      const page = pagesByIndex.get(parsedKey.pageIndex)
      if (!page) return
      if (parsedKey.kind === 'a') {
        if (!pageIndexed) return
        const question = (page.questions ?? {})[parsedKey.entityIndex]
        if (!question || !safeKey(question.id)) return
        const answer = resolveAnswer(question, value)
        if (answer === undefined) return
        const pageState = fresh.pages[page.id] ?? (fresh.pages[page.id] = {})
        const answers = pageState.answers ?? (pageState.answers = {})
        answers[question.id] = answer
      } else if (parsedKey.kind === 't') {
        assignVideoPosition(fresh, page, parsedKey.entityIndex, value)
      } else if (parsedKey.kind === 'q') {
        if (!pageIndexed || !Array.isArray(value)) return
        const questionnaire = page.questionnaires?.[parsedKey.entityIndex]
        if (
          !questionnaire ||
          !safeKey(questionnaire.id) ||
          !validMaxAttempts(questionnaire.maxAttempts) ||
          !Number.isSafeInteger(questionnaire.questionCount) ||
          questionnaire.questionCount < 0 ||
          value.length === 0 ||
          !withinAttemptLimit(value.length, questionnaire.maxAttempts) ||
          !value.every(
            (count) =>
              typeof count === 'number' &&
              Number.isSafeInteger(count) &&
              count >= 0 &&
              count <= questionnaire.questionCount
          )
        ) {
          return
        }
        const pageState = fresh.pages[page.id] ?? (fresh.pages[page.id] = {})
        const attempts = pageState.questionnaireAttempts ?? (pageState.questionnaireAttempts = {})
        attempts[questionnaire.id] = [...value] as number[]
      } else if (parsedKey.kind === 'r') {
        if (!pageIndexed || value !== 1) return
        retryCandidates.push({ page, questionnaireIndex: parsedKey.entityIndex })
      } else if (parsedKey.kind === 'c') {
        if (!pageIndexed || value !== 1) return
        completedCandidates.push({ page, questionnaireIndex: parsedKey.entityIndex })
      } else if (parsedKey.kind === 'i') {
        if (!pageIndexed || !Number.isSafeInteger(value) || (value as number) < 0) return
        const range = questionnaireQuestionRange(page, parsedKey.entityIndex)
        if (!range || (value as number) >= range.count) return
        const question = page.questions[String(range.start + (value as number))]
        const questionnaire = page.questionnaires?.[parsedKey.entityIndex]
        if (
          !question ||
          typeof question.id !== 'string' ||
          !safeKey(question.id) ||
          !questionnaire ||
          typeof questionnaire.id !== 'string' ||
          !safeKey(questionnaire.id)
        )
          return
        const pageState = fresh.pages[page.id] ?? (fresh.pages[page.id] = {})
        const activeItems =
          pageState.activeQuestionnaireItems ?? (pageState.activeQuestionnaireItems = {})
        activeItems[questionnaire.id] = question.id
      }
    })
    completedCandidates.forEach(({ page, questionnaireIndex }) => {
      const questionnaire = page.questionnaires?.[questionnaireIndex]
      if (
        !questionnaire ||
        !safeKey(questionnaire.id) ||
        !validMaxAttempts(questionnaire.maxAttempts) ||
        !Number.isSafeInteger(questionnaire.questionCount) ||
        questionnaire.questionCount < 0
      ) {
        return
      }
      const history = fresh.pages[page.id]?.questionnaireAttempts?.[questionnaire.id]
      if (
        !history ||
        history.length === 0 ||
        !withinAttemptLimit(history.length, questionnaire.maxAttempts)
      )
        return
      const pageState = fresh.pages[page.id] ?? (fresh.pages[page.id] = {})
      const completed =
        pageState.completedQuestionnaires ?? (pageState.completedQuestionnaires = [])
      completed.push(questionnaire.id)
    })
    retryCandidates.forEach(({ page, questionnaireIndex }) => {
      const questionnaire = page.questionnaires?.[questionnaireIndex]
      if (
        !questionnaire ||
        !safeKey(questionnaire.id) ||
        !validMaxAttempts(questionnaire.maxAttempts) ||
        !Number.isSafeInteger(questionnaire.questionCount) ||
        questionnaire.questionCount < 0
      )
        return
      const history = fresh.pages[page.id]?.questionnaireAttempts?.[questionnaire.id]
      if (
        !history ||
        history.length === 0 ||
        (questionnaire.maxAttempts !== -1 && history.length >= questionnaire.maxAttempts) ||
        fresh.pages[page.id]?.completedQuestionnaires?.includes(questionnaire.id)
      ) {
        return
      }
      const pageState = fresh.pages[page.id] ?? (fresh.pages[page.id] = {})
      const retries =
        pageState.activeQuestionnaireRetries ?? (pageState.activeQuestionnaireRetries = [])
      retries.push(questionnaire.id)
    })
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
                data[makeDataKey(pageIndex, 'i', questionnaireIndex)] = localIndex
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
        data[makeDataKey(pageIndex, 'q', questionnaireIndex)] = [...history]
        const isCompleted = pageState?.completedQuestionnaires?.includes(questionnaire.id) === true
        if (isCompleted) {
          data[makeDataKey(pageIndex, 'c', questionnaireIndex)] = 1
        } else if (
          pageState?.activeQuestionnaireRetries?.includes(questionnaire.id) &&
          (questionnaire.maxAttempts === -1 || history.length < questionnaire.maxAttempts)
        ) {
          data[makeDataKey(pageIndex, 'r', questionnaireIndex)] = 1
        }
      })
    })

    entries.forEach(([pageIndex, page]) => {
      if (!canonicalIndex(pageIndex) || !safeKey(page.id) || !isRecord(page.videos)) return
      const videoState = state.pages[page.id]?.videos
      if (!isRecord(videoState)) return
      Object.entries(page.videos).forEach(([videoIndex, video]) => {
        if (!safeVideoIndex(videoIndex) || !isRecord(video) || !safeKey(video.id)) return
        const seconds = videoState[video.id]
        if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return
        const deciseconds = Math.round(seconds * 10)
        if (!Number.isSafeInteger(deciseconds) || deciseconds === 0) return
        data[makeDataKey(pageIndex, 't', videoIndex)] = deciseconds
      })
    })

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
        data[makeDataKey(pageIndex, 'a', questionIndex)] =
          question.type === 'multiple-choice' ? optionIndexes : optionIndexes[0]
      })
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
    const fresh: PlayerState = { pages: {} }
    try {
      const parsed: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw
      if (!isRecord(parsed)) {
        return fresh
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
        return fresh
      }
      if (typeof parsed.s === 'number' && Number.isSafeInteger(parsed.s) && parsed.s >= 0) {
        fresh.shuffleSeed = parsed.s
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
            fresh.pages[page.id] = pageState
          }
        })
      }

      const encoded = parsed.d
      if (isRecord(encoded)) {
        decodeData(encoded, entries, fresh, pageIndexed)
      }
      return fresh
    } catch {
      return fresh
    }
  }

  return { encode, decode }
}

const codec = createSuspendDataCodec()

/** Encodes manifest-indexed progress/answers and manifest-owned video positions. */
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
