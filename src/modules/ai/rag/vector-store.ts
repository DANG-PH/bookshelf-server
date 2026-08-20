export type EmbeddedChunk = {
  bookId: string;
  bookTitle: string;
  text: string;
  embedding: number[];
};

/**
 * In-memory vector store, keyed loosely by book so a single book's
 * chunks can be added or dropped without touching the rest.
 * Fine for: one small personal library (hundreds of chunks), single
 * instance. Not fine for: a PM2 cluster (each instance would index
 * separately) or a library large enough that linear scan gets slow —
 * reach for a real vector DB (Qdrant, Weaviate) if that day comes.
 */
export class InMemoryVectorStore {
  private store: EmbeddedChunk[] = [];

  add(chunks: EmbeddedChunk[]): void {
    this.store.push(...chunks);
  }

  removeByBookId(bookId: string): void {
    this.store = this.store.filter((c) => c.bookId !== bookId);
  }

  // a title edit doesn't change the PDF's contents, so there's no need
  // to re-embed anything — just keep what search results display in sync
  renameBook(bookId: string, newTitle: string): void {
    this.store.forEach((c) => {
      if (c.bookId === bookId) c.bookTitle = newTitle;
    });
  }

  get indexedBookIds(): Set<string> {
    return new Set(this.store.map((c) => c.bookId));
  }

  /**
   * Top K chunks by cosine similarity to queryEmbedding.
   * Linear scan — fine under a few thousand chunks.
   */
  search(queryEmbedding: number[], topK = 4): EmbeddedChunk[] {
    return this.store
      .map((chunk) => ({
        chunk,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((r) => r.chunk);
  }

  /** Serializes to disk so a restart doesn't mean re-embedding everything. */
  dump(): EmbeddedChunk[] {
    return this.store;
  }

  load(chunks: EmbeddedChunk[]): void {
    this.store = chunks;
  }

  get size(): number {
    return this.store.length;
  }
}

/**
 * Cosine similarity = (A · B) / (|A| × |B|)
 *
 * Measures the angle between two vectors rather than their distance.
 * 1.0 = identical direction, 0.0 = unrelated, -1.0 = opposite.
 *
 * Euclidean distance would let longer text (bigger vector magnitude)
 * skew the result; cosine cancels out length and compares meaning only.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) throw new Error('Vector dimension mismatch');

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
