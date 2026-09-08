import { promises as fs } from 'fs';
import { PDFParse } from 'pdf-parse';

// Latin Extended Additional (U+1EA0–U+1EF9) is a Unicode block that
// exists almost solely for Vietnamese's tone-marked vowels; đ/Đ, ơ/Ơ,
// ư/Ư (Latin Extended-A/B) are likewise essentially unique to it among
// Latin-script languages. Real Vietnamese prose carries one of these on
// a large fraction of its words — easily 20-40%+ of all letters in a
// normal paragraph — so a simple density check reliably tells "is this
// Vietnamese" apart from any other language, no library or API call
// needed. This is deliberately NOT a general multi-language detector:
// the question this app actually needs answered is binary (Vietnamese
// or not), which is a much narrower and easier problem.
const VIETNAMESE_CHARS_RE = /[Ạ-ỹĐđƠơƯư]/g;

// below this, there just isn't enough text to tell either way (a mostly
// blank title page, a scanned book with no OCR text layer, …)
const MIN_LETTERS_FOR_SIGNAL = 200;

// real Vietnamese text sits far above this (see comment above) — set
// low enough that even a short, diacritic-light passage still clears
// it, while no other Latin-script language gets anywhere close by
// accident (a stray loanword or two, at most)
const VIETNAMESE_MIN_RATIO = 0.01;

// only the first few pages — plenty of signal for a language check,
// and far cheaper than parsing an entire book just to sample it
const SAMPLE_PAGES = 5;

export type DetectedLanguage = 'vi' | 'foreign' | null;

// Runs once, right when a book's file is stored — see
// BooksService.create()/update(). null means "couldn't tell" (encrypted
// PDF, scanned pages with no text layer, a cover-only first few pages)
// and is never guessed at; the book simply has no language badge in the
// admin panel rather than a wrong one.
export async function detectBookLanguage(
  filePath: string,
): Promise<DetectedLanguage> {
  let text: string;
  try {
    const buffer = await fs.readFile(filePath);
    const parser = new PDFParse({
      data: new Uint8Array(buffer),
      isEvalSupported: false,
    });
    try {
      ({ text } = await parser.getText({ first: SAMPLE_PAGES }));
    } finally {
      await parser.destroy();
    }
  } catch {
    return null;
  }

  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < MIN_LETTERS_FOR_SIGNAL) return null;
  const hits = text.match(VIETNAMESE_CHARS_RE) ?? [];
  return hits.length / letters.length >= VIETNAMESE_MIN_RATIO
    ? 'vi'
    : 'foreign';
}
