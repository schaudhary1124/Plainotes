import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { GripVertical, HelpCircle, Layers, MessageCircleQuestion, Minus, Plus, Trash2, X } from "lucide-react";
import type { Flashcard, MultipleChoice, StudyItem } from "../types";

interface StudyItemListProps {
  items: StudyItem[];
  focusId: string | null;
  onFocusHandled: () => void;
  onReorder: (next: StudyItem[]) => void;
  onUpdate: (item: StudyItem) => void;
  onDelete: (item: StudyItem) => void;
}

const SETTLE_TRANSITION = "transform 220ms cubic-bezier(0.2, 0, 0, 1)";

interface DragState {
  id: string;
  startY: number;
  startTop: number;
  height: number;
}

export function StudyItemList({
  items,
  focusId,
  onFocusHandled,
  onReorder,
  onUpdate,
  onDelete,
}: StudyItemListProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Local, unpersisted order shown while a drag is in progress - swaps happen
  // here instantly for a smooth preview, and are only committed to the parent
  // (which writes to disk) once, when the drag ends. Committing on every
  // swap would fire an immediate file write per swap and stalls the app.
  const [dragItems, setDragItems] = useState<StudyItem[] | null>(null);
  const displayItems = dragItems ?? items;
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const dragStateRef = useRef<DragState | null>(null);
  const prevTops = useRef<Map<string, number>>(new Map());

  // Kept in sync every render so the window-level drag listeners (added once
  // per drag session, see below) always see the latest values without
  // needing to be re-subscribed on every keystroke/swap.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const dragItemsRef = useRef(dragItems);
  dragItemsRef.current = dragItems;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  // FLIP: whenever the order changes, animate non-dragged items sliding into
  // their new slot, and keep the dragged item's transform anchored to the
  // pointer instead of snapping to its new natural position.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const prev = prevTops.current;
    for (const item of displayItems) {
      const el = itemRefs.current.get(item.id);
      if (!el) continue;
      if (item.id === draggingId) continue;
      const prevTop = prev.get(item.id);
      const newTop = el.offsetTop;
      if (prevTop !== undefined && prevTop !== newTop) {
        const delta = prevTop - newTop;
        el.style.transition = "none";
        el.style.transform = `translateY(${delta}px)`;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            el.style.transition = SETTLE_TRANSITION;
            el.style.transform = "";
          });
        });
      }
    }

    const ds = dragStateRef.current;
    if (draggingId && ds) {
      const el = itemRefs.current.get(draggingId);
      if (el) {
        const desiredTop = ds.startTop + (el.dataset.lastDelta ? Number(el.dataset.lastDelta) : 0);
        el.style.transition = "none";
        el.style.transform = `translateY(${desiredTop - el.offsetTop}px)`;
      }
    }

    for (const item of displayItems) {
      const el = itemRefs.current.get(item.id);
      if (el) prev.set(item.id, el.offsetTop);
    }
  }, [displayItems.map((item) => item.id).join("|")]);

  // Track the drag via window-level listeners rather than element pointer
  // capture: fast drags can make the browser silently drop capture on the
  // tiny grip element mid-gesture, which loses the final pointerup entirely
  // and leaves the drag stuck forever. Listening on window always sees the
  // pointer regardless of which element is currently under it.
  useEffect(() => {
    if (!draggingId) return;

    function settle(el: HTMLDivElement) {
      el.style.transition = SETTLE_TRANSITION;
      requestAnimationFrame(() => {
        el.style.transform = "";
      });
    }

    function handleMove(e: PointerEvent) {
      const ds = dragStateRef.current;
      if (!ds) return;
      const el = itemRefs.current.get(ds.id);
      if (!el) return;

      const deltaY = e.clientY - ds.startY;
      el.dataset.lastDelta = String(deltaY);
      const desiredTop = ds.startTop + deltaY;
      el.style.transform = `translateY(${desiredTop - el.offsetTop}px)`;

      const list = dragItemsRef.current ?? itemsRef.current;
      // Compare the dragged item's leading edge (not its center) to the
      // neighbor's midpoint - swapping as soon as the edge closest to the
      // neighbor crosses its middle, rather than waiting for the dragged
      // item's own center to get there, roughly halves the distance needed.
      const desiredBottom = desiredTop + ds.height;
      const currentIdx = list.findIndex((it) => it.id === ds.id);
      let idx = currentIdx;

      while (idx < list.length - 1) {
        const nextEl = itemRefs.current.get(list[idx + 1].id);
        if (!nextEl) break;
        const nextMid = nextEl.offsetTop + nextEl.offsetHeight / 2;
        if (desiredBottom > nextMid) idx++;
        else break;
      }
      while (idx > 0) {
        const prevEl = itemRefs.current.get(list[idx - 1].id);
        if (!prevEl) break;
        const prevMid = prevEl.offsetTop + prevEl.offsetHeight / 2;
        if (desiredTop < prevMid) idx--;
        else break;
      }

      if (idx !== currentIdx) {
        const next = [...list];
        const [moved] = next.splice(currentIdx, 1);
        next.splice(idx, 0, moved);
        setDragItems(next);
      }
    }

    function handleUp() {
      const ds = dragStateRef.current;
      if (ds) {
        const el = itemRefs.current.get(ds.id);
        if (el) settle(el);
      }
      dragStateRef.current = null;
      setDraggingId(null);

      const finalItems = dragItemsRef.current;
      const original = itemsRef.current;
      if (finalItems) {
        const reordered =
          finalItems.length !== original.length || finalItems.some((item, i) => item.id !== original[i]?.id);
        if (reordered) onReorderRef.current(finalItems);
        setDragItems(null);
      }
    }

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [draggingId]);

  function handleCardPointerDown(e: React.PointerEvent<HTMLDivElement>, item: StudyItem) {
    if (e.button !== 0) return;
    // Let clicks on text fields, radios, and buttons behave normally - only
    // treat the rest of the card as a drag handle.
    if ((e.target as HTMLElement).closest("textarea, input, button, a, select, [contenteditable=\"true\"]")) return;
    const el = itemRefs.current.get(item.id);
    if (!el) return;
    e.preventDefault();
    el.style.transition = "none";
    el.dataset.lastDelta = "0";
    dragStateRef.current = {
      id: item.id,
      startY: e.clientY,
      startTop: el.offsetTop,
      height: el.offsetHeight,
    };
    setDraggingId(item.id);
    setDragItems(items);
  }

  return (
    <div className="relative flex w-full max-w-2xl flex-col gap-3">
      {displayItems.map((item, index) => (
        <div
          key={item.id}
          ref={(el) => {
            if (el) itemRefs.current.set(item.id, el);
            else itemRefs.current.delete(item.id);
          }}
          onPointerDown={(e) => handleCardPointerDown(e, item)}
          className={`glass-panel shadow-app cursor-grab rounded-2xl border border-transparent p-3.5 will-change-transform active:cursor-grabbing @max-sm:p-2.5 ${
            draggingId === item.id ? "shadow-xl ring-accent-soft relative z-10 ring-2 opacity-95" : "z-0 opacity-100"
          }`}
        >
          <div className="flex items-start gap-2.5">
            <div className="flex shrink-0 flex-col items-center gap-1.5 pt-1">
              <span className="text-tertiary flex h-5 w-5 items-center justify-center">
                <GripVertical size={15} />
              </span>
              <span className="text-tertiary text-xs font-medium tabular-nums">{index + 1}</span>
            </div>

            <div className="min-w-0 flex-1">
              {item.kind === "flashcard" ? (
                <FlashcardFields
                  item={item}
                  autoFocus={item.id === focusId}
                  onFocusHandled={onFocusHandled}
                  onUpdate={onUpdate}
                />
              ) : (
                <McqFields
                  item={item}
                  autoFocus={item.id === focusId}
                  onFocusHandled={onFocusHandled}
                  onUpdate={onUpdate}
                />
              )}
            </div>

            <button
              type="button"
              onClick={() => onDelete(item)}
              title="Delete card"
              aria-label="Delete card"
              className="btn-ghost h-7 w-7 shrink-0 cursor-pointer"
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function FieldLabel({ icon: Icon, children }: { icon: typeof Layers; children: React.ReactNode }) {
  return (
    <label className="text-tertiary flex items-center gap-1 text-[10px] font-semibold tracking-wide uppercase">
      <Icon size={10} /> {children}
    </label>
  );
}

function ReasonToggle({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="text-tertiary hover:text-accent flex w-fit cursor-pointer items-center gap-1 self-start text-xs font-medium transition-colors duration-150"
    >
      {expanded ? <Minus size={12} /> : <Plus size={12} />} {expanded ? "Remove reason" : "Add reason"}
    </button>
  );
}

function ReasonTextarea({
  reasonRef,
  reason,
  onChange,
}: {
  reasonRef: React.RefObject<HTMLTextAreaElement | null>;
  reason: string | undefined;
  onChange: (reason: string) => void;
}) {
  return (
    <div>
      <FieldLabel icon={MessageCircleQuestion}>Reason (optional)</FieldLabel>
      <textarea
        ref={reasonRef}
        value={reason ?? ""}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        placeholder="Explain why this is the answer…"
        className="border-subtle bg-surface-hover text-primary mt-1 w-full cursor-text resize-y rounded-lg border px-2.5 py-1.5 text-sm focus:outline-none"
      />
    </div>
  );
}

function FlashcardFields({
  item,
  autoFocus,
  onFocusHandled,
  onUpdate,
}: {
  item: Flashcard;
  autoFocus: boolean;
  onFocusHandled: () => void;
  onUpdate: (item: StudyItem) => void;
}) {
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reasonExpanded, setReasonExpanded] = useState(!!item.reason);

  useEffect(() => {
    if (autoFocus) {
      questionRef.current?.focus();
      onFocusHandled();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  function toggleReason() {
    if (reasonExpanded) {
      onUpdate({ ...item, reason: undefined });
      setReasonExpanded(false);
    } else {
      setReasonExpanded(true);
      requestAnimationFrame(() => reasonRef.current?.focus());
    }
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-2 gap-3 @max-sm:grid-cols-1">
        <div>
          <FieldLabel icon={Layers}>Question</FieldLabel>
          <textarea
            ref={questionRef}
            value={item.question}
            onChange={(e) => onUpdate({ ...item, question: e.target.value })}
            rows={2}
            placeholder="Type a question…"
            className="border-subtle bg-surface-hover text-primary mt-1 w-full cursor-text resize-y rounded-lg border px-2.5 py-1.5 text-sm focus:outline-none"
          />
        </div>
        <div>
          <FieldLabel icon={Layers}>Answer</FieldLabel>
          <textarea
            value={item.answer}
            onChange={(e) => onUpdate({ ...item, answer: e.target.value })}
            rows={2}
            placeholder="Type the answer…"
            className="border-subtle bg-surface-hover text-primary mt-1 w-full cursor-text resize-y rounded-lg border px-2.5 py-1.5 text-sm focus:outline-none"
          />
        </div>
      </div>
      <ReasonToggle expanded={reasonExpanded} onToggle={toggleReason} />
      {reasonExpanded && (
        <ReasonTextarea
          reasonRef={reasonRef}
          reason={item.reason}
          onChange={(reason) => onUpdate({ ...item, reason })}
        />
      )}
    </div>
  );
}

function McqFields({
  item,
  autoFocus,
  onFocusHandled,
  onUpdate,
}: {
  item: MultipleChoice;
  autoFocus: boolean;
  onFocusHandled: () => void;
  onUpdate: (item: StudyItem) => void;
}) {
  const questionRef = useRef<HTMLTextAreaElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reasonExpanded, setReasonExpanded] = useState(!!item.reason);

  useEffect(() => {
    if (autoFocus) {
      questionRef.current?.focus();
      onFocusHandled();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  function toggleReason() {
    if (reasonExpanded) {
      onUpdate({ ...item, reason: undefined });
      setReasonExpanded(false);
    } else {
      setReasonExpanded(true);
      requestAnimationFrame(() => reasonRef.current?.focus());
    }
  }

  function updateOption(index: number, value: string) {
    const options = item.options.map((o, i) => (i === index ? value : o));
    const answer = index === item.answerIndex ? value : item.answer;
    onUpdate({ ...item, options, answer });
  }

  function setCorrect(index: number) {
    onUpdate({ ...item, answerIndex: index, answer: item.options[index] });
  }

  function addOption() {
    onUpdate({ ...item, options: [...item.options, ""] });
  }

  function removeOption(index: number) {
    const options = item.options.filter((_, i) => i !== index);
    const answerIndex = index === item.answerIndex ? 0 : index < item.answerIndex ? item.answerIndex - 1 : item.answerIndex;
    onUpdate({ ...item, options, answerIndex, answer: options[answerIndex] ?? "" });
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div>
        <FieldLabel icon={HelpCircle}>Question</FieldLabel>
        <textarea
          ref={questionRef}
          value={item.question}
          onChange={(e) => onUpdate({ ...item, question: e.target.value })}
          rows={2}
          placeholder="Type a question…"
          className="border-subtle bg-surface-hover text-primary mt-1 w-full cursor-text resize-y rounded-lg border px-2.5 py-1.5 text-sm focus:outline-none"
        />
      </div>
      <div>
        <FieldLabel icon={HelpCircle}>Options (select the correct one)</FieldLabel>
        <div className="mt-1 grid grid-cols-2 gap-1.5 @max-sm:grid-cols-1">
          {item.options.map((option, index) => (
            <div key={index} className="flex items-center gap-1.5">
              <input
                type="radio"
                name={`correct-${item.id}`}
                checked={item.answerIndex === index}
                onChange={() => setCorrect(index)}
                className="shrink-0 cursor-pointer"
                aria-label={`Mark option ${index + 1} correct`}
              />
              <input
                value={option}
                onChange={(e) => updateOption(index, e.target.value)}
                placeholder={`Option ${index + 1}`}
                className="border-subtle bg-surface-hover text-primary h-8 flex-1 cursor-text rounded-lg border px-2.5 text-sm focus:outline-none"
              />
              <button
                type="button"
                onClick={() => removeOption(index)}
                disabled={item.options.length <= 2}
                title="Remove option"
                aria-label="Remove option"
                className="btn-ghost h-6 w-6 shrink-0 cursor-pointer disabled:opacity-30"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex items-center justify-between">
          <ReasonToggle expanded={reasonExpanded} onToggle={toggleReason} />
          <button
            type="button"
            onClick={addOption}
            className="text-accent flex cursor-pointer items-center gap-1 text-xs font-medium"
          >
            <Plus size={12} /> Add option
          </button>
        </div>
      </div>
      {reasonExpanded && (
        <ReasonTextarea
          reasonRef={reasonRef}
          reason={item.reason}
          onChange={(reason) => onUpdate({ ...item, reason })}
        />
      )}
    </div>
  );
}
