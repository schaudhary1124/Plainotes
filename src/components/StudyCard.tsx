import { useState } from "react";
import type { StudyItem } from "../types";

interface StudyCardProps {
  item: StudyItem;
}

export function StudyCard({ item }: StudyCardProps) {
  if (item.kind === "flashcard") {
    return <FlashcardView question={item.question} answer={item.answer} />;
  }

  return (
    <McqView
      question={item.question}
      options={item.options}
      answer={item.answer}
    />
  );
}

function FlashcardView({
  question,
  answer,
}: {
  question: string;
  answer: string;
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div
      className="h-72 w-full cursor-pointer [perspective:1400px]"
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
        <div className="glass-panel absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl p-8 text-center [backface-visibility:hidden]">
          <span className="text-xs font-medium uppercase tracking-wider text-indigo-300/80">
            Question
          </span>
          <p className="text-xl font-medium text-slate-50">{question}</p>
          <span className="mt-4 text-xs text-slate-400">
            Click to reveal answer
          </span>
        </div>
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-2xl border border-indigo-400/20 bg-indigo-500/10 p-8 text-center backdrop-blur-2xl [backface-visibility:hidden]"
          style={{ transform: "rotateY(180deg)" }}
        >
          <span className="text-xs font-medium uppercase tracking-wider text-indigo-300/80">
            Answer
          </span>
          <p className="text-xl font-medium text-slate-50">{answer}</p>
          <span className="mt-4 text-xs text-slate-400">
            Click to flip back
          </span>
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
    <div className="glass-panel flex h-72 w-full flex-col gap-5 rounded-2xl p-8">
      <span className="text-xs font-medium uppercase tracking-wider text-violet-300/80">
        Multiple choice
      </span>
      <p className="text-xl font-medium text-slate-50">{question}</p>
      <div className="grid flex-1 auto-rows-min grid-cols-1 gap-2.5 overflow-y-auto sm:grid-cols-2">
        {options.map((option) => {
          const isCorrect = option.toLowerCase() === answer.toLowerCase();
          const isSelected = selected === option;

          let stateClasses =
            "border-white/10 bg-white/[0.03] text-slate-200 hover:border-indigo-400/40 hover:bg-white/[0.07]";
          if (hasAnswered && isCorrect) {
            stateClasses = "border-emerald-400/40 bg-emerald-500/15 text-emerald-200";
          } else if (hasAnswered && isSelected && !isCorrect) {
            stateClasses = "border-rose-400/40 bg-rose-500/15 text-rose-200";
          } else if (hasAnswered) {
            stateClasses = "border-white/5 bg-white/[0.02] text-slate-500";
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
