import { describe, expect, it } from 'vitest'
import { sanitizePlayerState } from '../../app/lib/player-state'
import type { ContentPackage, QuestionnaireNode } from '../../app/types'
import { shuffleQuestionOptions } from '../../app/lib/shuffle'
import { scrollPackage } from './fixtures'

type ShuffleOption = { value: string; correct: boolean; content: string }

/** Four options with a deliberately non-alphabetical authored order. */
const fourOptions: ShuffleOption[] = ['a', 'b', 'c', 'd'].map((value, index) => ({
  value,
  correct: index === 0,
  content: value
}))

/**
 * One option-shuffle scope shared by the expectations below. Every expected
 * order was derived from the deterministic hash/xorshift implementation, so
 * these constants pin the mapping instead of re-deriving it per assertion.
 */
const sharedScope = {
  seed: 42,
  questionnaireId: 'questionnaire:lesson.mdx:1:1',
  questionId: 'question:lesson.mdx:1:1',
  attemptIndex: 0
}

function orderFor(
  options: readonly ShuffleOption[],
  scopeOverrides: Partial<typeof sharedScope> = {}
): string[] {
  return shuffleQuestionOptions(options, { ...sharedScope, ...scopeOverrides }).map(
    (option) => option.value
  )
}

describe('shuffleQuestionOptions', () => {
  it('repeats the exact same order for the same seed and scope', () => {
    expect(orderFor(fourOptions)).toEqual(['a', 'c', 'b', 'd'])
    expect(orderFor(fourOptions)).toEqual(orderFor(fourOptions))
  })

  it('maps every valid seed to one fixed order', () => {
    const ordersBySeed: Array<[number, string[]]> = [
      [0, ['c', 'b', 'd', 'a']],
      [1, ['a', 'b', 'd', 'c']],
      [42, ['a', 'c', 'b', 'd']],
      [12345, ['a', 'd', 'c', 'b']],
      // The upper bound of the generator's 32-bit seed space still shuffles.
      [0x9e3779b9, ['b', 'c', 'a', 'd']],
      [4294967295, ['b', 'a', 'c', 'd']]
    ]
    for (const [seed, expected] of ordersBySeed) {
      expect(orderFor(fourOptions, { seed })).toEqual(expected)
    }
  })

  it('returns a copy: authored options are never mutated or reordered', () => {
    const authored: ShuffleOption[] = ['w', 'x', 'y', 'z'].map((value, index) => ({
      value,
      correct: index === 0,
      content: value
    }))

    const shuffled = shuffleQuestionOptions(authored, sharedScope)

    // A new array, never the authored reference.
    expect(shuffled).not.toBe(authored)
    // Same option objects exactly once, in a different order.
    expect([...shuffled].sort((left, right) => left.value.localeCompare(right.value))).toEqual(
      [...authored].sort((left, right) => left.value.localeCompare(right.value))
    )
    expect(new Set(shuffled.map((option) => option.value))).toEqual(
      new Set(authored.map((option) => option.value))
    )
    // Mutating the copy cannot leak back into the authored order.
    shuffled[0] = shuffled[1]
    expect(authored.map((option) => option.value)).toEqual(['w', 'x', 'y', 'z'])
  })

  it('scopes one order per attempt so a retry draws a fresh order', () => {
    expect(orderFor(fourOptions, { attemptIndex: 0 })).toEqual(['a', 'c', 'b', 'd'])
    expect(orderFor(fourOptions, { attemptIndex: 1 })).toEqual(['c', 'b', 'a', 'd'])
    expect(orderFor(fourOptions, { attemptIndex: 2 })).toEqual(['a', 'c', 'd', 'b'])
  })

  it('scopes one order per question inside the same questionnaire', () => {
    // With this seed the first two questions receive distinct orders.
    expect(orderFor(fourOptions, { seed: 0, questionId: 'question:one' })).toEqual([
      'c',
      'a',
      'd',
      'b'
    ])
    expect(orderFor(fourOptions, { seed: 0, questionId: 'question:two' })).toEqual([
      'b',
      'a',
      'd',
      'c'
    ])
  })

  it('scopes one order per questionnaire so siblings never share it', () => {
    expect(orderFor(fourOptions)).toEqual(['a', 'c', 'b', 'd'])
    expect(orderFor(fourOptions, { questionnaireId: 'questionnaire:other.mdx:1:1' })).toEqual([
      'c',
      'a',
      'b',
      'd'
    ])
  })

  it('keeps one- and two-option questions deterministic permutations', () => {
    const one: ShuffleOption[] = [{ value: 'only', correct: true, content: 'Only' }]
    const two: ShuffleOption[] = ['yes', 'no'].map((value, index) => ({
      value,
      correct: index === 0,
      content: value
    }))

    expect(orderFor(one)).toEqual(['only'])
    expect(orderFor(one)).not.toBe(one)
    // A two-option shuffle with this seed resolves to the authored order, and
    // it is still a fresh deterministic copy rather than the authored array.
    expect(orderFor(two)).toEqual(['yes', 'no'])
    expect(orderFor(two)).not.toBe(two)
  })
})

/** A package that opts its questionnaire into option shuffling. */
function packageWithShuffledQuestionnaire(shuffleOptions: boolean): ContentPackage {
  const questionnaire: QuestionnaireNode = {
    type: 'questionnaire',
    id: 'questionnaire:intro.mdx:1:1',
    contributesToScore: true,
    revealCorrectAnswers: true,
    maxAttempts: 1,
    shuffleOptions,
    questions: [
      {
        type: 'question',
        id: 'question:intro.mdx:1:1',
        questionType: 'single-choice',
        prompt: 'Pick one',
        options: [
          { value: 'first', correct: true, content: 'First' },
          { value: 'second', correct: false, content: 'Second' }
        ]
      }
    ]
  }
  return {
    metadata: { title: 'Shuffle package' },
    presentation: {
      type: 'scroll',
      pages: [
        {
          type: 'page',
          id: 'page:intro.mdx',
          source: 'intro.mdx',
          metadata: { title: 'Intro' },
          content: [questionnaire]
        }
      ]
    }
  }
}

describe('sanitizePlayerState shuffle seed', () => {
  it('keeps a persisted non-negative safe-integer seed', () => {
    const state = sanitizePlayerState(scrollPackage, { pages: {}, shuffleSeed: 12345 })
    expect(state.shuffleSeed).toBe(12345)
    // Seed 0 is a valid seed, not a missing one.
    expect(sanitizePlayerState(scrollPackage, { shuffleSeed: 0 }).shuffleSeed).toBe(0)
  })

  it('drops invalid persisted seeds so the session can generate a fresh one', () => {
    for (const shuffleSeed of [-1, 1.5, 2 ** 53, '12345', true, Number.NaN]) {
      const state = sanitizePlayerState(scrollPackage, { pages: {}, shuffleSeed })
      expect(state).not.toHaveProperty('shuffleSeed')
    }
  })

  it('keeps the seed even when the rest of the persisted state is unusable', () => {
    const state = sanitizePlayerState(packageWithShuffledQuestionnaire(true), {
      location: 'page:missing.mdx',
      pages: { 'page:gone.mdx': { visited: true } },
      shuffleSeed: 42
    })
    expect(state.shuffleSeed).toBe(42)
    expect(state.location).toBeUndefined()
    expect(state.pages).toEqual({})
  })

  it('carries no seed when none was persisted', () => {
    const state = sanitizePlayerState(scrollPackage, { pages: { 'page:intro.mdx': {} } })
    expect(state).not.toHaveProperty('shuffleSeed')
  })
})
