import React from "react";
import type { CardNode } from "@scorm-cli/parser";

interface CardProps {
  href?: string;
  title?: string;
  children?: React.ReactNode;
}

export function Card({ href, title, children }: CardProps) {
  return (
    <a
      href={href}
      style={{
        display: "block",
        padding: "1rem",
        border: "1px solid #ddd",
        borderRadius: "8px",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      {children || title || href}
    </a>
  );
}
