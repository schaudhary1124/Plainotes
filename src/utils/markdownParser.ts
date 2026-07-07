import type { Flashcard, MultipleChoice, StudyItem } from "../types";

// Study syntax (each on its own line within a note):
//   Q: <question> -> A: <answer>
//   MCQ: <question> | <option 1, option 2, option 3> | <correct option>
const FLASHCARD_PATTERN = /^Q:\s*(.+?)\s*->\s*A:\s*(.+)$/i;
const MCQ_PATTERN = /^MCQ:\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+)$/i;

function parseFlashcardLine(line: string, id: string): Flashcard | null {
  const match = line.match(FLASHCARD_PATTERN);
  if (!match) return null;

  const [, question, answer] = match;
  if (!question.trim() || !answer.trim()) return null;

  return {
    kind: "flashcard",
    id,
    question: question.trim(),
    answer: answer.trim(),
  };
}

function parseMcqLine(line: string, id: string): MultipleChoice | null {
  const match = line.match(MCQ_PATTERN);
  if (!match) return null;

  const [, question, rawOptions, rawAnswer] = match;
  const options = rawOptions
    .split(",")
    .map((option) => option.trim())
    .filter(Boolean);
  const answer = rawAnswer.trim();
  if (!question.trim() || options.length < 2 || !answer) return null;

  const answerIndex = options.findIndex(
    (option) => option.toLowerCase() === answer.toLowerCase(),
  );

  return {
    kind: "mcq",
    id,
    question: question.trim(),
    options,
    answer,
    answerIndex,
  };
}

/**
 * Extracts study items (flashcards and multiple-choice questions) from raw
 * Markdown note content. Recognized lines are removed from the surrounding
 * prose; unrecognized lines are ignored (not an error) so notes can freely
 * mix study syntax with regular Markdown.
 */
export function parseMarkdownForStudyItems(content: string): StudyItem[] {
  const items: StudyItem[] = [];

  content.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;

    const id = `${index}`;
    if (/^MCQ:/i.test(line)) {
      const mcq = parseMcqLine(line, id);
      if (mcq) items.push(mcq);
    } else if (/^Q:/i.test(line)) {
      const flashcard = parseFlashcardLine(line, id);
      if (flashcard) items.push(flashcard);
    }
  });

  return items;
}
