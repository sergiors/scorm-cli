export interface HeadingNode {
  type: "heading";
  depth: number;
  text: string;
}

export interface ParagraphNode {
  type: "paragraph";
  text: string;
}

export interface ListNode {
  type: "list";
  ordered: boolean;
  items: string[];
}

export interface QuestionOption {
  text: string;
  correct: boolean;
}

export interface QuestionNode {
  type: "question";
  questionType: "single-choice" | "multiple-choice";
  prompt: string;
  options: QuestionOption[];
}

export interface VideoNode {
  url: string;
  title?: string;
}

export interface CardNode {
  type: "card";
  href: string;
}

export interface GridNode {
  type: "grid";
  items: CardNode[];
}

export type CourseNode =
  | HeadingNode
  | ParagraphNode
  | ListNode
  | QuestionNode
  | VideoNode
  | GridNode
  | CardNode;
