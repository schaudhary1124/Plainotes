import { useRef, useState } from "react";
import { useDebouncedCallback } from "../hooks/useDebouncedCallback";

type SaveStatus = "idle" | "pending" | "saving" | "saved";

interface EditorProps {
  initialContent: string;
  onChange: (content: string) => void;
  onSave: (content: string) => Promise<void>;
}

const AUTOSAVE_DELAY_MS = 1000;

export function Editor({ initialContent, onChange, onSave }: EditorProps) {
  const [content, setContent] = useState(initialContent);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const latestContentRef = useRef(content);

  const debouncedSave = useDebouncedCallback(async (value: string) => {
    setStatus("saving");
    await onSave(value);
    if (latestContentRef.current === value) {
      setStatus("saved");
    }
  }, AUTOSAVE_DELAY_MS);

  function handleChange(value: string) {
    setContent(value);
    latestContentRef.current = value;
    onChange(value);
    setStatus("pending");
    debouncedSave(value);
  }

  return (
    <div className="relative flex h-full flex-col">
      <textarea
        value={content}
        onChange={(e) => handleChange(e.target.value)}
        spellCheck={false}
        placeholder="Start writing in Markdown..."
        className="h-full w-full flex-1 resize-none bg-transparent px-12 py-10 font-mono text-[15px] leading-7 text-slate-100/90 placeholder:text-slate-500 focus:outline-none"
      />
      <div className="pointer-events-none absolute bottom-5 right-7 text-xs text-slate-400/70 transition-opacity duration-300">
        {status === "saving" && "Saving…"}
        {status === "saved" && "Saved"}
        {status === "pending" && "Editing…"}
      </div>
    </div>
  );
}
