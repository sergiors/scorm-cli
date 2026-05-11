import React from "react";
import type { GridNode } from "@scorm-cli/parser";

interface GridProps {
  columns?: number;
  children: React.ReactNode;
}

export function Grid({ children, columns = 2 }: GridProps) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gap: "1rem",
      }}
    >
      {children}
    </div>
  );
}
