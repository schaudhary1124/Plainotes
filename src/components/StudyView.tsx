import { useEffect, useState } from "react";
import { GraduationCap, HelpCircle, Layers, Pencil } from "lucide-react";
import { readStudyItems, writeStudyItems } from "../utils/fsNotes";
import type { Flashcard, MultipleChoice, StudyItem } from "../types";
import { useDebouncedCallback } from "../hooks/useDebouncedCallback";
import { StudyCard } from "./StudyCard";
import { StudyItemList } from "./StudyItemList";

interface StudyViewProps {
  notePath: string;
}

type SubMode = "manage" | "practice";

function newFlashcard(): Flashcard {
  return { kind: "flashcard", id: crypto.randomUUID(), question: "", answer: "" };
}

function newMcq(): MultipleChoice {
  return {
    kind: "mcq",
    id: crypto.randomUUID(),
    question: "",
    options: ["", ""],
    answer: "",
    answerIndex: 0,
  };
}

export function StudyView({ notePath }: StudyViewProps) {
  const [items, setItems] = useState<StudyItem[] | null>(null);
  const [index, setIndex] = useState(0);
  const [subMode, setSubMode] = useState<SubMode>("manage");
  const [focusId, setFocusId] = useState<string | null>(null);

  const debouncedWrite = useDebouncedCallback((next: StudyItem[]) => {
    void writeStudyItems(notePath, next);
  }, 500);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setSubMode("manage");
    readStudyItems(notePath).then((loaded) => {
      if (!cancelled) setItems(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [notePath]);

  useEffect(() => {
    if (!items) return;
    const practiceCount = items.filter((item) => item.question.trim() !== "").length;
    setIndex((i) => Math.min(i, Math.max(0, practiceCount - 1)));
    if (practiceCount === 0) setSubMode("manage");
  }, [items]);

  useEffect(() => {
    if (subMode !== "practice" || !items) return;
    const practiceCount = items.filter((item) => item.question.trim() !== "").length;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight") setIndex((i) => Math.min(practiceCount - 1, i + 1));
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [items, subMode]);

  function persist(next: StudyItem[], immediate: boolean) {
    setItems(next);
    if (immediate) {
      void writeStudyItems(notePath, next);
    } else {
      debouncedWrite(next);
    }
  }

  function handleAddItem(item: StudyItem) {
    const current = items ?? [];
    persist([...current, item], true);
    setFocusId(item.id);
  }

  function handleUpdateItem(item: StudyItem) {
    if (!items) return;
    persist(
      items.map((i) => (i.id === item.id ? item : i)),
      false,
    );
  }

  function handleDeleteItem(item: StudyItem) {
    if (!items) return;
    const next = items.filter((i) => i.id !== item.id);
    persist(next, true);
    setIndex((i) => Math.min(i, Math.max(0, next.length - 1)));
  }

  if (items === null) {
    return (
      <div className="text-secondary flex h-full items-center justify-center text-sm">Loading…</div>
    );
  }

  const flashcardCount = items.filter((item) => item.kind === "flashcard").length;
  const mcqCount = items.length - flashcardCount;
  const practiceItems = items.filter((item) => item.question.trim() !== "");
  const canPractice = practiceItems.length > 0;
  const current = practiceItems.length > 0 ? practiceItems[Math.min(index, practiceItems.length - 1)] : null;

  const addButtonsSmall = (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => handleAddItem(newFlashcard())}
        className="btn-ghost flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-medium"
      >
        <Layers size={14} /> Add flashcard
      </button>
      <button
        type="button"
        onClick={() => handleAddItem(newMcq())}
        className="btn-ghost flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-medium"
      >
        <HelpCircle size={14} /> Add multiple choice
      </button>
    </div>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-subtle flex h-11 shrink-0 items-center justify-between border-b px-4">
        <div className="text-secondary flex items-center gap-3 text-xs @max-sm:hidden">
          <span>
            {flashcardCount} flashcard{flashcardCount === 1 ? "" : "s"}
          </span>
          <span className="text-tertiary">·</span>
          <span>{mcqCount} multiple choice</span>
        </div>

        <div
          role="tablist"
          aria-label="Toggle between managing and practicing cards"
          className="glass-surface relative ml-auto flex h-8 w-44 shrink-0 items-center overflow-hidden rounded-full border-0 p-1 text-xs font-medium"
        >
          <span
            className="bg-accent-solid shadow-app absolute top-1 bottom-1 left-1 w-[calc(50%-4px)] rounded-full transition-transform duration-200 ease-out"
            style={{ transform: subMode === "practice" ? "translateX(100%)" : "translateX(0)" }}
          />
          <button
            type="button"
            role="tab"
            aria-selected={subMode === "manage"}
            onClick={() => setSubMode("manage")}
            title="Manage cards"
            className={`z-10 flex flex-1 items-center justify-center gap-1.5 rounded-full py-1 text-center whitespace-nowrap transition-colors duration-150 ${
              subMode === "manage" ? "text-white" : "text-secondary"
            }`}
          >
            <Pencil size={12} className="shrink-0" /> Manage
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={subMode === "practice"}
            onClick={() => canPractice && setSubMode("practice")}
            disabled={!canPractice}
            title={canPractice ? "Practice cards" : "Add a question to start practicing"}
            className={`z-10 flex flex-1 items-center justify-center gap-1.5 rounded-full py-1 text-center whitespace-nowrap transition-colors duration-150 ${
              subMode === "practice" ? "text-white" : "text-secondary"
            } ${!canPractice ? "cursor-not-allowed opacity-40" : ""}`}
          >
            <GraduationCap size={12} className="shrink-0" /> Practice
          </button>
        </div>
      </div>

      {subMode === "manage" ? (
        <div className="flex flex-1 flex-col items-center gap-4 overflow-y-auto p-10 @max-lg:p-5 @max-sm:p-3">
          {items.length === 0 ? (
            <EmptyState onAddFlashcard={() => handleAddItem(newFlashcard())} onAddMcq={() => handleAddItem(newMcq())} />
          ) : (
            <>
              <StudyItemList
                items={items}
                focusId={focusId}
                onFocusHandled={() => setFocusId(null)}
                onReorder={(next) => persist(next, true)}
                onUpdate={handleUpdateItem}
                onDelete={handleDeleteItem}
              />
              {addButtonsSmall}
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-10 @max-lg:gap-4 @max-lg:p-5 @max-sm:gap-2 @max-sm:p-3">
          {current && (
            <>
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
                  {index + 1} / {practiceItems.length}
                </span>
                <button
                  type="button"
                  className="btn-ghost h-9 px-4 text-sm disabled:opacity-30 @max-sm:h-8 @max-sm:px-2"
                  onClick={() => setIndex((i) => Math.min(practiceItems.length - 1, i + 1))}
                  disabled={index === practiceItems.length - 1}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({ onAddFlashcard, onAddMcq }: { onAddFlashcard: () => void; onAddMcq: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-7">
      <div className="text-center">
        <p className="text-primary text-lg font-semibold">Start building your study set</p>
        <p className="text-secondary mt-1 max-w-sm text-sm">
          Add a flashcard or a multiple-choice question, then keep going — you can fill in the
          details and reorder cards whenever you like.
        </p>
      </div>
      <div className="flex items-stretch gap-4 @max-sm:flex-col">
        <button
          type="button"
          onClick={onAddFlashcard}
          className="glass-panel shadow-app hover:border-accent-soft hover:shadow-app-lg group flex h-44 w-52 flex-col items-center justify-center gap-3 rounded-2xl border border-transparent p-6 text-center transition-all duration-150 hover:-translate-y-0.5"
        >
          <span className="bg-accent-soft flex h-12 w-12 items-center justify-center rounded-full transition-transform duration-150 group-hover:scale-105">
            <Layers size={22} className="text-accent" />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-primary text-sm font-semibold">Add Flashcard</span>
            <span className="text-tertiary text-xs">Question &amp; answer</span>
          </span>
        </button>
        <button
          type="button"
          onClick={onAddMcq}
          className="glass-panel shadow-app hover:border-accent-soft hover:shadow-app-lg group flex h-44 w-52 flex-col items-center justify-center gap-3 rounded-2xl border border-transparent p-6 text-center transition-all duration-150 hover:-translate-y-0.5"
        >
          <span className="bg-accent-soft flex h-12 w-12 items-center justify-center rounded-full transition-transform duration-150 group-hover:scale-105">
            <HelpCircle size={22} className="text-accent" />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-primary text-sm font-semibold">Add Multiple Choice</span>
            <span className="text-tertiary text-xs">Pick the right answer</span>
          </span>
        </button>
      </div>
    </div>
  );
}
