import type { ReactNode } from 'react';

/**
 * Authoring-only MDX markers for the SCORM CLI.
 *
 * Import these from `scorm-cli/authoring` so editors can complete component
 * names and type check authored MDX. The SCORM CLI resolves these named
 * bindings (and aliases) while parsing, but content files are parsed as data
 * and never executed, so every marker throws if it is ever rendered by other
 * tooling.
 *
 * The marker vocabulary and props mirror the parser contract exactly; the
 * parser remains the source of truth for validation.
 */

/** Keeps the exported marker names in one place for tooling and tests. */
export type AuthoringComponentName =
  | 'Scroll'
  | 'Grid'
  | 'Page'
  | 'Item'
  | 'Path'
  | 'Image'
  | 'Video'
  | 'Questionnaire'
  | 'Question'
  | 'Prompt'
  | 'Option';

/** Question kinds accepted by `<Question type="...">`. */
export type QuestionType = 'single-choice' | 'multiple-choice' | 'true-false';

/** Props shared by markers that wrap authored children. */
export interface ContainerProps {
  /** Authored child components and Markdown content. */
  children?: ReactNode;
}

/**
 * Props for the root `<Scroll>` presentation, which contains direct
 * `<Page src="..." />` children.
 */
export type ScrollProps = ContainerProps;

/** Props for the root `<Grid>` presentation, which contains direct `<Item>`. */
export interface GridProps extends ContainerProps {
  /** Number of columns, an integer from 1 to 12. */
  columns?: number;
}

/** Props for a root `<Page src="..." />` declared directly in `<Scroll>`. */
export interface PageSourceProps {
  /** Path to the referenced page document, relative to the declaring file. */
  src: string;
  ref?: never;
}

/**
 * Props for a `<Page ref="..." />` nested in a `<Path>`, which points at a page
 * already declared by a root `<Page src="..." />`.
 */
export interface PageReferenceProps {
  /** Root Scroll page reference, relative to the content package root. */
  ref: string;
  src?: never;
}

/** Props for `<Page>`, which is `src`-based in a Scroll and `ref`-based in a Path. */
export type PageProps = PageSourceProps | PageReferenceProps;

/** Props for `<Item src="..." />` in a root `<Grid>` presentation. */
export interface ItemProps {
  /** Path to the referenced item document, relative to the declaring file. */
  src: string;
}

/**
 * Props for `<Path>`, an ordered navigation path through pages already declared
 * in the root `<Scroll>`.
 */
export type PathProps = ContainerProps;

/** Props for `<Image src="..." alt="..." />`, which requires alt text. */
export interface ImageProps {
  /** Path to the image, relative to the declaring file. */
  src: string;
  /** Alternative text describing the image's purpose; may be empty. */
  alt: string;
  /** Optional visible caption. */
  caption?: string;
}

/** Props for `<Video src="..." />` and its optional media references. */
export interface VideoProps {
  /** Path to the video, relative to the declaring file. */
  src: string;
  /** Optional visible title. */
  title?: string;
  /** Optional poster image shown before playback. */
  poster?: string;
  /** Optional captions track. */
  captions?: string;
}

/** Props for `<Questionnaire>`, which contains one or more `<Question>`. */
export type QuestionnaireProps = ContainerProps;

/** Props for `<Question type="..." />`, which contains a Prompt and Options. */
export interface QuestionProps extends ContainerProps {
  /** Question kind, which determines the correct-option rules. */
  type: QuestionType;
}

/** Props for `<Prompt>`, the question text. */
export type PromptProps = ContainerProps;

/** Props for `<Option value="..." />`, an answer choice. */
export interface OptionProps extends ContainerProps {
  /** Unique value identifying this option within its question. */
  value: string;
  /** Whether this option is part of the correct answer. */
  correct?: boolean;
}

function authoringStub(component: AuthoringComponentName): never {
  throw new Error(
    `<${component}> is an authoring marker from "scorm-cli/authoring" and cannot be executed. ` +
      'SCORM CLI parses MDX content as data and never runs author code.',
  );
}

/** Root `<Scroll>` presentation. See {@link ScrollProps}. */
export function Scroll(_props: ScrollProps): never {
  return authoringStub('Scroll');
}

/** Root `<Grid>` presentation. See {@link GridProps}. */
export function Grid(_props: GridProps): never {
  return authoringStub('Grid');
}

/** Page reference. See {@link PageProps}. */
export function Page(_props: PageProps): never {
  return authoringStub('Page');
}

/** Grid item reference. See {@link ItemProps}. */
export function Item(_props: ItemProps): never {
  return authoringStub('Item');
}

/** Ordered path through root Scroll pages. See {@link PathProps}. */
export function Path(_props: PathProps): never {
  return authoringStub('Path');
}

/** Image with required alternative text. See {@link ImageProps}. */
export function Image(_props: ImageProps): never {
  return authoringStub('Image');
}

/** Video with optional poster and captions. See {@link VideoProps}. */
export function Video(_props: VideoProps): never {
  return authoringStub('Video');
}

/** Questionnaire wrapper. See {@link QuestionnaireProps}. */
export function Questionnaire(_props: QuestionnaireProps): never {
  return authoringStub('Questionnaire');
}

/** Single question. See {@link QuestionProps}. */
export function Question(_props: QuestionProps): never {
  return authoringStub('Question');
}

/** Question prompt. See {@link PromptProps}. */
export function Prompt(_props: PromptProps): never {
  return authoringStub('Prompt');
}

/** Answer option. See {@link OptionProps}. */
export function Option(_props: OptionProps): never {
  return authoringStub('Option');
}
