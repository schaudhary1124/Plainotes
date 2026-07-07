export interface NoteSummary {
  /** File name including the .md extension, unique within the notes directory */
  name: string;
  /** Display title, derived from the file name without its extension */
  title: string;
}

export type AppMode = "edit" | "study";

export interface Flashcard {
  kind: "flashcard";
  id: string;
  question: string;
  answer: string;
}

export interface MultipleChoice {
  kind: "mcq";
  id: string;
  question: string;
  options: string[];
  answer: string;
  /** Index of `answer` within `options`, or -1 if it couldn't be matched */
  answerIndex: number;
}

export type StudyItem = Flashcard | MultipleChoice;
