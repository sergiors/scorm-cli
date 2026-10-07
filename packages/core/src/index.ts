export interface Course {
  metadata: { title: string; description?: string };
  children: CourseStructureNode[];
}

export type CourseStructureNode = SectionNode | ItemNode;

export interface SectionNode {
  type: 'section';
  id: string;
  title?: string;
  presentation: { layout: 'list' | 'grid'; columns?: number };
  children: CourseStructureNode[];
}

export interface ItemNode {
  type: 'item';
  id: string;
  source: string;
  metadata: { title: string; description?: string; thumbnail?: string };
  content: ContentNode[];
}

export type ContentNode =
  | { type: 'heading'; depth: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'link'; href: string; text: string }
  | { type: 'image'; src: string; alt: string }
  | { type: 'video'; src: string; title?: string }
  | {
      type: 'question';
      questionType: 'single-choice' | 'multiple-choice';
      question: string;
      answers: { text: string; correct: boolean }[];
    }
  | { type: 'code'; value: string; language?: string }
  | { type: 'quote'; text: string };

export interface RenderOptions {
  outputDirectory: string;
  assets?: Array<{ sourcePath: string; targetPath: string }>;
}

export interface RenderResult {
  directory: string;
  entrypoint: string;
}

export interface Renderer {
  build(course: Course, options: RenderOptions): Promise<RenderResult>;
}

/** Completion is deliberately renderer-agnostic: a course is complete after every item is visited. */
export function isCourseComplete(
  course: Course,
  visitedItemIds: Iterable<string>,
): boolean {
  const visited =
    visitedItemIds instanceof Set ? visitedItemIds : new Set(visitedItemIds);
  const itemIds: string[] = [];
  const walk = (nodes: CourseStructureNode[]) => {
    for (const node of nodes) {
      if (node.type === 'item') itemIds.push(node.id);
      else walk(node.children);
    }
  };
  walk(course.children);
  return itemIds.length > 0 && itemIds.every((id) => visited.has(id));
}

/** Local references in the course AST are normalized relative to the course root. */
export function collectAssetReferences(course: Course): string[] {
  const refs = new Set<string>();
  const visit = (nodes: CourseStructureNode[]) => {
    for (const node of nodes) {
      if (node.type === 'section') {
        visit(node.children);
        continue;
      }
      if (
        node.metadata.thumbnail &&
        !isRemoteReference(node.metadata.thumbnail)
      )
        refs.add(node.metadata.thumbnail);
      for (const content of node.content) {
        if (content.type === 'image' || content.type === 'video') {
          if (!isRemoteReference(content.src)) refs.add(content.src);
        }
      }
    }
  };
  visit(course.children);
  return [...refs].sort();
}

export function isRemoteReference(value: string): boolean {
  return /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value);
}
