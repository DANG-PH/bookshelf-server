import { promises as fs } from 'fs';
import { PDFParse } from 'pdf-parse';

/**
 * Reads a PDF and splits its text into overlapping word chunks for the
 * RAG pipeline.
 *
 * @param filePath  Absolute path to the PDF file
 * @param chunkSize Max words per chunk (default 500)
 * @param overlap   Words repeated between two adjacent chunks (default 50)
 * @returns         One string per chunk
 *
 * Why chunk instead of embedding the whole file?
 * One vector for an entire book represents "the whole book" — searches
 * can't tell which part is actually relevant. Smaller chunks each get
 * their own vector, so search returns the specific passage that matters.
 *
 * Why overlap?
 * A sentence sitting right on a chunk boundary would otherwise get cut
 * in half, losing meaning in both halves. The overlap guarantees it
 * shows up whole in at least one of the two chunks.
 *
 * Example with chunkSize=10, overlap=2:
 *   chunk_1: [word 1  ... word 10]
 *   chunk_2: [word 9  ... word 18]  ← words 9-10 repeat
 *   chunk_3: [word 17 ... word 26]  ← words 17-18 repeat
 */
export async function chunkPdf(
  filePath: string,
  chunkSize = 500,
  overlap = 50,
): Promise<string[]> {
  const buffer = await fs.readFile(filePath);
  // isEvalSupported:false — text extraction never needs to run whatever
  // JS a PDF might embed, so don't let it
  const parser = new PDFParse({
    data: new Uint8Array(buffer),
    isEvalSupported: false,
  });
  const { text } = await parser.getText();
  await parser.destroy();

  // filter(Boolean) drops empty strings from runs of whitespace. Plain
  // whitespace splitting is good enough for mixed Vietnamese/English
  // technical text — the embedding model handles the actual semantics.
  const words = text.split(/\s+/).filter(Boolean);

  const chunks: string[] = [];
  let i = 0;

  // Each pass takes words[i .. i+chunkSize]. Stepping by
  // (chunkSize - overlap) instead of chunkSize is what makes adjacent
  // chunks share their boundary words.
  while (i < words.length) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    chunks.push(chunk);
    i += chunkSize - overlap;
  }

  return chunks;
}
