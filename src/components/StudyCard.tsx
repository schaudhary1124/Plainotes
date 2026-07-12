import { useState } from "react";
import type { StudyItem } from "../types";

interface StudyCardProps {
  item: StudyItem;
}

export function StudyCard({ item }: StudyCardProps) {
  if (item.kind === "flashcard") {
    return <FlashcardView question={item.question} answer={item.answer} />;
  }

  return <McqView question={item.question} options={item.options} answer={item.answer} />;
}

function FlashcardView({ question, answer }: { question: string; answer: string }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div
      className="h-72 w-full cursor-pointer [perspective:1400px] @max-lg:h-56 @max-md:h-48 @max-sm:h-36"
      onClick={() => setRevealed((prev) => !prev)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") setRevealed((prev) => !prev);
      }}
    >
      <div
        className="relative h-full w-full transition-transform duration-500 ease-out [transform-style:preserve-3d]"
        style={{ transform: revealed ? "rotateY(180deg)" : "rotateY(0deg)" }}
      >
        <div className="glass-panel shadow-app absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl p-8 text-center [backface-visibility:hidden] @max-md:gap-1.5 @max-md:p-4">
          <span className="text-accent text-xs font-medium uppercase tracking-wider">Question</span>
          <p className="text-primary text-xl font-medium @max-md:text-base">{question}</p>
          <span className="text-tertiary mt-4 text-xs @max-md:mt-1">Click to reveal answer</span>
        </div>
        <div
          className="border-accent-soft bg-accent-soft shadow-app absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl border p-8 text-center backdrop-blur-2xl [backface-visibility:hidden] @max-md:gap-1.5 @max-md:p-4"
          style={{ transform: "rotateY(180deg)" }}
        >
          <span className="text-accent text-xs font-medium uppercase tracking-wider">Answer</span>
          <p className="text-primary text-xl font-medium @max-md:text-base">{answer}</p>
          <span className="text-tertiary mt-4 text-xs @max-md:mt-1">Click to flip back</span>
        </div>
      </div>
    </div>
  );
}

function McqView({
  question,
  options,
  answer,
}: {
  question: string;
  options: string[];
  answer: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const hasAnswered = selected !== null;

  return (
    <div className="glass-panel shadow-app flex h-72 w-full flex-col gap-5 rounded-2xl p-8 @max-lg:h-56 @max-md:h-48 @max-md:gap-2.5 @max-md:p-4 @max-sm:h-40">
      <span className="text-accent text-xs font-medium uppercase tracking-wider">Multiple choice</span>
      <p className="text-primary text-xl font-medium @max-md:text-base">{question}</p>
      <div className="grid flex-1 auto-rows-min grid-cols-1 gap-2.5 overflow-y-auto sm:grid-cols-2">
        {options.map((option) => {
          const isCorrect = option.toLowerCase() === answer.toLowerCase();
          const isSelected = selected === option;

          let stateClasses = "border-subtle bg-surface-hover text-secondary hover:border-accent-soft hover:text-primary";
          if (hasAnswered && isCorrect) {
            stateClasses = "border-success-soft bg-success-soft text-success";
          } else if (hasAnswered && isSelected && !isCorrect) {
            stateClasses = "border-danger-soft bg-danger-soft text-danger";
          } else if (hasAnswered) {
            stateClasses = "border-subtle text-tertiary opacity-60";
          }

          return (
            <button
              key={option}
              type="button"
              onClick={() => setSelected(option)}
              disabled={hasAnswered}
              className={`rounded-xl border px-4 py-3 text-left text-sm transition-colors duration-150 ${stateClasses}`}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
