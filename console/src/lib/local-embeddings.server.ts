const EMBED_DIM = 3072;

/**
 * Deterministic hashed bag-of-tokens embeddings. The Supabase pgvector columns
 * use 3,072 dimensions, so this stays schema-compatible without sending
 * telemetry or document text to an external AI service.
 */
function localEmbedding(text: string): number[] {
  const vector = new Array<number>(EMBED_DIM).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9._:-]+/g) ?? [];
  for (const token of tokens) {
    let hash = 2166136261;
    for (let index = 0; index < token.length; index += 1) {
      hash ^= token.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    const bucket = Math.abs(hash) % EMBED_DIM;
    vector[bucket] = (vector[bucket] ?? 0) + 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  return vector.map((value) => value / norm);
}

export async function embedTexts(inputs: string[]): Promise<number[][]> {
  return inputs.map(localEmbedding);
}
