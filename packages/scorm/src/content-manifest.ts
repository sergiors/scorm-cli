import type {
  ContentNode,
  ContentPackage,
  InlineContentNode,
  InlineNode,
  QuestionNode,
} from '@scorm-cli/core';

export interface ContentManifest {
  schemaVersion: 1;
  title: string;
  presentation: 'scroll' | 'grid';
  pages: Record<
    string,
    {
      id: string;
      title: string;
      questions: Record<
        string,
        {
          id: string;
          prompt: string;
          type: QuestionNode['questionType'];
          options: Record<string, { value: string; label: string }>;
        }
      >;
    }
  >;
}

function inlineText(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
        case 'inlineCode':
          return node.value;
        case 'break':
          return ' ';
        case 'image':
          return [node.alt, node.caption].filter(Boolean).join(' ');
        case 'emphasis':
        case 'strong':
        case 'link':
          return inlineText(node.children);
      }
    })
    .join('');
}

function plainText(nodes: ContentNode[]): string {
  const chunks: string[] = [];
  const visit = (items: Array<ContentNode | InlineContentNode>) => {
    for (const node of items) {
      switch (node.type) {
        case 'heading':
        case 'paragraph':
          chunks.push(inlineText(node.children));
          break;
        case 'inlineContent':
          chunks.push(inlineText(node.children));
          break;
        case 'code':
          chunks.push(node.value);
          break;
        case 'image':
          chunks.push([node.alt, node.caption].filter(Boolean).join(' '));
          break;
        case 'video':
          if (node.title) chunks.push(node.title);
          break;
        case 'list':
          for (const item of node.items) visit(item.children);
          break;
        case 'quote':
          visit(node.children);
          break;
        case 'questionnaire':
          for (const question of node.questions) {
            chunks.push(plainText(question.prompt));
            for (const option of question.options)
              chunks.push(plainText(option.content));
          }
          break;
      }
    }
  };
  visit(nodes);
  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}

function collectQuestions(
  nodes: Array<ContentNode | InlineContentNode>,
  output: QuestionNode[],
): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'list':
        for (const item of node.items) collectQuestions(item.children, output);
        break;
      case 'quote':
        collectQuestions(node.children, output);
        break;
      case 'questionnaire':
        output.push(...node.questions);
        for (const question of node.questions) {
          collectQuestions(question.prompt, output);
          for (const option of question.options)
            collectQuestions(option.content, output);
        }
        break;
      case 'inlineContent':
        // Inline runs cannot hold a questionnaire block; skip them while still
        // traversing sibling blocks.
        break;
      default:
        break;
    }
  }
}

/** Creates the stable, content-free dictionary shared by packaging and runtime. */
export function createContentManifest(
  contentPackage: ContentPackage,
): ContentManifest {
  const nodes =
    contentPackage.presentation.type === 'scroll'
      ? contentPackage.presentation.pages
      : contentPackage.presentation.items;
  const pages: ContentManifest['pages'] = {};
  nodes.forEach((node, pageIndex) => {
    const sourceQuestions: QuestionNode[] = [];
    collectQuestions(node.content, sourceQuestions);
    const questions: ContentManifest['pages'][string]['questions'] = {};
    sourceQuestions.forEach((question, questionIndex) => {
      const options: Record<string, { value: string; label: string }> = {};
      question.options.forEach((option, optionIndex) => {
        options[String(optionIndex)] = {
          value: option.value,
          label: plainText(option.content),
        };
      });
      questions[String(questionIndex)] = {
        id: question.id,
        prompt: plainText(question.prompt),
        type: question.questionType,
        options,
      };
    });
    pages[String(pageIndex)] = {
      id: node.id,
      title: node.metadata.title,
      questions,
    };
  });

  return {
    schemaVersion: 1,
    title: contentPackage.metadata.title,
    presentation: contentPackage.presentation.type,
    pages,
  };
}
