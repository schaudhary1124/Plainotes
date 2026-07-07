import { useMemo, useState } from "react";
import { parseMarkdownForStudyItems } from "../utils/markdownParser";
import { StudyCard } from "./StudyCard";

interface StudyViewProps {
  content: string;
}

export function StudyView({ content }: StudyViewProps) {
  const items = useMemo(() => parseMarkdownForStudyItems(content), [content]);
  const [index, setIndex] = useState(0);

  if (items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-10">
        <div className="glass-panel animate-card-in max-w-lg rounded-2xl p-10 text-center">
          <p className="text-lg font-medium text-slate-100">
            No study items yet
          </p>
          <p className="mt-2 text-sm text-slate-400">
            Add lines like these anywhere in your note, then come back to
            Study Mode.
          </p>
          <div className="mt-6 space-y-2 rounded-xl bg-black/20 p-4 text-left font-mono text-xs text-slate-300">
            <p>Q: What is the capital of France? -&gt; A: Paris</p>
            <p>
              MCQ: Which ocean is the largest? | Atlantic, Pacific, Indian,
              Arctic | Pacific
            </p>
          </div>
        </div>
      </div>
    );
  }

  const current = items[index];
  const flashcardCount = items.filter(
    (item) => item.kind === "flashcard",
  ).length;
  const mcqCount = items.length - flashcardCount;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-10">
      <div className="flex items-center gap-3 text-xs text-slate-400">
        <span>
          {flashcardCount} flashcard{flashcardCount === 1 ? "" : "s"}
        </span>
        <span className="text-slate-600">·</span>
        <span>{mcqCount} multiple choice</span>
      </div>

      <div key={current.id} className="animate-card-in w-full max-w-xl">
        <StudyCard item={current} />
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          className="btn-ghost h-9 px-4 text-sm disabled:opacity-30"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
        >
          Previous
        </button>
        <span className="text-sm tabular-nums text-slate-400">
          {index + 1} / {items.length}
        </span>
        <button
          type="button"
          className="btn-ghost h-9 px-4 text-sm disabled:opacity-30"
          onClick={() => setIndex((i) => Math.min(items.length - 1, i + 1))}
          disabled={index === items.length - 1}
        >
          Next
        </button>
      </div>
    </div>
  );
}
