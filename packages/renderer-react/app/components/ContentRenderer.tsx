import { ExternalLink } from "lucide-react";
import type { ContentNode } from "../types";
import { cn } from "../lib/utils";
import { QuestionView } from "./QuestionView";

const HEADING_TAGS = {
  1: "h1",
  2: "h2",
  3: "h3",
  4: "h4",
  5: "h5",
  6: "h6",
} as const;

function clampHeading(depth: number, offset: number): keyof typeof HEADING_TAGS {
  const level = Math.min(6, Math.max(1, Math.trunc(depth) + offset));
  return level as keyof typeof HEADING_TAGS;
}

export interface ContentRendererProps {
  nodes: ContentNode[];
  /**
   * Shifts every heading down so item content nests under the player's
   * headings. Defaults to 0, keeping the source depth untouched.
   */
  headingOffset?: number;
}

export function ContentRenderer({
  nodes,
  headingOffset = 0,
}: ContentRendererProps) {
  return (
    <>
      {nodes.map((node, index) => (
        <ContentNodeView
          key={`${node.type}-${index}`}
          node={node}
          headingOffset={headingOffset}
        />
      ))}
    </>
  );
}

function ContentNodeView({
  node,
  headingOffset,
}: {
  node: ContentNode;
  headingOffset: number;
}) {
  switch (node.type) {
    case "heading": {
      const Tag = HEADING_TAGS[clampHeading(node.depth, headingOffset)];
      return (
        <Tag className="mt-6 mb-2 scroll-mt-24 text-xl font-semibold text-foreground first:mt-0">
          {node.text}
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p className="my-3 leading-7 text-foreground/90">{node.text}</p>
      );
    case "list": {
      const ListTag = node.ordered ? "ol" : "ul";
      const items = node.items ?? [];
      return (
        <ListTag
          className={cn(
            "my-3 space-y-1 pl-6 text-foreground/90",
            node.ordered ? "list-decimal" : "list-disc",
          )}
        >
          {items.map((item, index) => (
            <li key={index} className="leading-7">
              {item}
            </li>
          ))}
        </ListTag>
      );
    }
    case "link": {
      const isExternal = /^https?:\/\//i.test(node.href);
      return (
        <a
          href={node.href}
          target={isExternal ? "_blank" : undefined}
          rel={isExternal ? "noreferrer noopener" : undefined}
          className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-4 hover:text-primary/80"
        >
          {node.text}
          {isExternal ? (
            <ExternalLink aria-hidden="true" className="size-4" />
          ) : null}
        </a>
      );
    }
    case "image":
      return (
        <img
          src={node.src}
          alt={node.alt}
          loading="lazy"
          className="my-4 h-auto max-w-full rounded-lg border border-border"
        />
      );
    case "video":
      return (
        <figure className="my-4 space-y-2">
          <video
            controls
            preload="metadata"
            src={node.src}
            aria-label={node.title ?? "Video"}
            className="w-full rounded-lg border border-border"
          />
          {node.title ? (
            <figcaption className="text-sm text-muted-foreground">
              {node.title}
            </figcaption>
          ) : null}
        </figure>
      );
    case "question":
      return (
        <div className="my-4">
          <QuestionView node={node} />
        </div>
      );
    case "code":
      return (
        <pre className="my-4 overflow-x-auto rounded-lg border border-border bg-secondary p-4 text-sm">
          <code
            className={cn(
              "font-mono",
              node.language ? `language-${node.language}` : undefined,
            )}
          >
            {node.value}
          </code>
        </pre>
      );
    case "quote":
      return (
        <blockquote className="my-4 border-l-4 border-primary/50 bg-secondary/50 px-4 py-3 italic text-foreground/90">
          <p>{node.text}</p>
        </blockquote>
      );
    default: {
      // Exhaustiveness guard: adding a new ContentNode variant surfaces here.
      const exhaustive: never = node;
      void exhaustive;
      return null;
    }
  }
}
