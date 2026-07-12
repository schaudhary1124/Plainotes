import { useEffect, useMemo, useState } from "react";
import { parseMarkdownForStudyItems } from "../utils/markdownParser";
import { StudyCard } from "./StudyCard";

interface StudyViewProps {
  content: string;
}

export function StudyView({ content }: StudyViewProps) {
  const items = useMemo(() => parseMarkdownForStudyItems(content), [content]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, items.length - 1)));
  }, [items.length]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setIndex((i) => Math.min(items.length - 1, i + 1));
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [items.length]);

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center overflow-y-auto p-10 @max-sm:p-4">
        <div className="glass-panel animate-card-in shadow-app max-w-lg rounded-2xl p-10 text-center @max-sm:p-5">
          <p className="text-primary text-lg font-medium">No study items yet</p>
        </div>
      </div>
    );
  }

  const current = items[index];
  const flashcardCount = items.filter((item) => item.kind === "flashcard").length;
  const mcqCount = items.length - flashcardCount;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 overflow-y-auto p-10 @max-lg:gap-4 @max-lg:p-5 @max-sm:gap-2 @max-sm:p-3">
      <div className="text-secondary flex items-center gap-3 text-xs @max-sm:hidden">
        <span>
          {flashcardCount} flashcard{flashcardCount === 1 ? "" : "s"}
        </span>
        <span className="text-tertiary">·</span>
        <span>{mcqCount} multiple choice</span>
      </div>

      <div key={current.id} className="animate-card-in w-full max-w-xl">
        <StudyCard item={current} />
      </div>

      <div className="flex items-center gap-4 @max-sm:gap-2">
        <button
          type="button"
          className="btn-ghost h-9 px-4 text-sm disabled:opacity-30 @max-sm:h-8 @max-sm:px-2"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
        >
          Previous
        </button>
        <span className="text-secondary text-sm tabular-nums">
          {index + 1} / {items.length}
        </span>
        <button
          type="button"
          className="btn-ghost h-9 px-4 text-sm disabled:opacity-30 @max-sm:h-8 @max-sm:px-2"
          onClick={() => setIndex((i) => Math.min(items.length - 1, i + 1))}
          disabled={index === items.length - 1}
        >
          Next
        </button>
      </div>
    </div>
  );
}
