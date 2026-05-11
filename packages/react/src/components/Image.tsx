import React from "react";

interface ImageProps {
  src: string;
  alt?: string;
}

export function Image({ src, alt = "" }: ImageProps) {
  return (
    <img
      src={src}
      alt={alt}
      style={{ maxWidth: "100%", height: "auto" }}
    />
  );
}
