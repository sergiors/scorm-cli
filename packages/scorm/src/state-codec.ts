import type { PlayerState } from '@scorm-cli/core'
import type { ContentManifest } from './content-manifest'

export interface CompactSuspendData {
  readonly v: 1
  readonly p: number
  readonly x: string
  readonly d?: Readonly<
    Record<
      string,
      {
        readonly a?: Readonly<Record<string, number | readonly number[]>>
        readonly t?: Readonly<Record<string, number>>
      }
    >
  >
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

  const videosByPage = (manifest: ContentManifest) =>
    Object.values(manifest.pages).flatMap((page) =>
      page.videos && isRecord(page.videos)
        ? Object.entries(page.videos)
            .filter(
              ([videoId, video]) => safeKey(videoId) && isRecord(video) && video.id === videoId
            )
            .map(([, video]) => ({ pageId: page.id, video }))
        : []
    )

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
    const dataByPage: Record<
      string,
      { a?: Record<string, number | number[]>; t?: Record<string, number> }
    > = Object.create(null)

    const pageIndexById = new Map(entries.map(([pageIndex, page]) => [page.id, pageIndex]))

    videosByPage(manifest).forEach(({ pageId, video }) => {
      const videoId = video.id as string
      if (!safeKey(pageId)) return
      const pageIndex = pageIndexById.get(pageId)
      if (pageIndex === undefined) return
      const videoState = state.pages[pageId]?.videos
      if (!isRecord(videoState) || !Object.prototype.hasOwnProperty.call(videoState, videoId)) {
        return
      }
      const seconds = videoState[videoId]
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return
      const deciseconds = Math.round(seconds * 10)
      if (!Number.isSafeInteger(deciseconds)) return
      const pageData = dataByPage[pageIndex] ?? (dataByPage[pageIndex] = {})
      const videos = pageData.t ?? (pageData.t = Object.create(null))
      videos[videoId] = deciseconds
    })

    entries.forEach(([pageIndex, page]) => {
      if (!safeKey(page.id) || !Object.prototype.hasOwnProperty.call(state.pages, page.id)) {
        return
      }
      const pageState = state.pages[page.id]
      const pageAnswers = pageState?.answers
      if (!isRecord(pageAnswers)) {
        return
      }

      const answers: Record<string, number | number[]> = Object.create(null)
      Object.entries(page.questions ?? {}).forEach(([questionIndex, question]) => {
        if (!safeKey(question.id)) {
          return
        }
        const answer = pageAnswers[question.id]
        const optionIndexes = Object.entries(question.options)
          .filter(([, option]) =>
            Array.isArray(answer) ? answer.includes(option.value) : answer === option.value
          )
          .map(([optionIndex]) => Number(optionIndex))
          .filter(Number.isSafeInteger)
          .sort((left, right) => left - right)
        if (optionIndexes.length > 0) {
          answers[questionIndex] =
            question.type === 'multiple-choice' ? optionIndexes : optionIndexes[0]
        }
      })
      if (Object.keys(answers).length > 0) {
        const pageData = dataByPage[pageIndex] ?? (dataByPage[pageIndex] = {})
        pageData.a = answers
      }
    })

    return {
      v: 1,
      p: normalizedProgress,
      x: visited,
      ...(Object.keys(dataByPage).length > 0 ? { d: dataByPage } : {})
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

      // Page-indexed data is only meaningful when its visited bitmap is not
      // oversized for the current page list. Stable-ID videos can still restore.
      if (x.length <= entries.length) {
        const completedCount =
          manifest.presentation === 'scroll'
            ? Math.max(0, Math.min(entries.length, Math.round((p * entries.length) / 100)))
            : 0
        entries.forEach(([pageIndex, page], order) => {
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

          const encodedPage = isRecord(parsed.d) ? parsed.d[pageIndex] : undefined
          const encodedAnswers = isRecord(encodedPage) ? encodedPage.a : undefined
          if (isRecord(encodedAnswers)) {
            const answers: NonNullable<PlayerState['pages'][string]['answers']> = {}
            Object.entries(page.questions ?? {}).forEach(([questionIndex, question]) => {
              if (!safeKey(question.id)) {
                return
              }
              const selection = encodedAnswers[questionIndex]
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
              if (values.length > 0) {
                answers[question.id] = question.type === 'multiple-choice' ? values : values[0]
              }
            })
            if (Object.keys(answers).length > 0) {
              pageState.answers = answers
            }
          }

          if (Object.keys(pageState).length > 0) {
            fresh.pages[page.id] = pageState
          }
        })
      }
      const encodedPages = parsed.d
      if (isRecord(encodedPages)) {
        const occurrences = new Map<string, number>()
        Object.values(encodedPages).forEach((encodedPage) => {
          const encodedVideos = isRecord(encodedPage) ? encodedPage.t : undefined
          if (!isRecord(encodedVideos)) return
          Object.keys(encodedVideos).forEach((videoId) => {
            occurrences.set(videoId, (occurrences.get(videoId) ?? 0) + 1)
          })
        })

        const videos = videosByPage(manifest)
        const manifestOccurrences = new Map<string, number>()
        videos.forEach(({ video }) => {
          const videoId = video.id as string
          manifestOccurrences.set(videoId, (manifestOccurrences.get(videoId) ?? 0) + 1)
        })
        videos.forEach(({ pageId, video }) => {
          const videoId = video.id as string
          if (
            !safeKey(pageId) ||
            occurrences.get(videoId) !== 1 ||
            manifestOccurrences.get(videoId) !== 1
          ) {
            return
          }
          let deciseconds: unknown
          Object.values(encodedPages).some((encodedPage) => {
            const encodedVideos = isRecord(encodedPage) ? encodedPage.t : undefined
            if (
              isRecord(encodedVideos) &&
              Object.prototype.hasOwnProperty.call(encodedVideos, videoId)
            ) {
              deciseconds = encodedVideos[videoId]
              return true
            }
            return false
          })
          if (Number.isSafeInteger(deciseconds) && (deciseconds as number) >= 0) {
            const pageState = fresh.pages[pageId] ?? (fresh.pages[pageId] = {})
            const videos = pageState.videos ?? (pageState.videos = {})
            videos[videoId] = (deciseconds as number) / 10
          }
        })
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
  return `var suspendCodec = (${createSuspendDataCodec.toString()})();
  function compactEncode(manifest, state, progress) {
    return JSON.stringify(suspendCodec.encode(manifest, state, progress));
  }
  function compactDecode(manifest, raw) {
    return suspendCodec.decode(manifest, raw);
  }`
}
