export const MAC_RAM_PROFILES = [
  {
    id: "8gb",
    label: "8GB",
    recommended: "qwen3:4b",
    chatModel: "qwen3:4b",
    embeddingModel: "nomic-embed-text",
    numCtx: 16384,
    numPredict: 1536,
    note: "Small, stable profile for light ingest and short retrieval answers.",
  },
  {
    id: "16gb",
    label: "16GB",
    recommended: "qwen3:8b",
    chatModel: "qwen3:8b",
    embeddingModel: "nomic-embed-text",
    numCtx: 24576,
    numPredict: 2048,
    note: "Balanced profile for most laptops when other apps are open.",
  },
  {
    id: "24gb",
    label: "24GB",
    recommended: "qwen3:14b",
    chatModel: "qwen3:14b",
    embeddingModel: "nomic-embed-text",
    numCtx: 32768,
    numPredict: 2048,
    note: "Recommended default for a 24GB M4 MacBook Pro.",
  },
  {
    id: "32gb",
    label: "32GB",
    recommended: "qwen3:14b",
    chatModel: "qwen3:14b",
    embeddingModel: "mxbai-embed-large",
    numCtx: 40960,
    numPredict: 3072,
    note: "More retrieval headroom while keeping generation responsive.",
  },
  {
    id: "48gb",
    label: "48GB+",
    recommended: "qwen3:30b",
    chatModel: "qwen3:30b",
    embeddingModel: "bge-m3",
    numCtx: 49152,
    numPredict: 4096,
    note: "Higher-quality synthesis for larger local corpora.",
  },
  {
    id: "64gb",
    label: "64GB+",
    recommended: "qwen3:30b",
    chatModel: "qwen3:30b",
    embeddingModel: "bge-m3",
    numCtx: 65536,
    numPredict: 4096,
    note: "Best local profile here without moving into very large 70B-class models.",
  },
];

export const CHAT_MODELS = [
  { id: "qwen3:4b", label: "Qwen3 4B", fit: "Small ingest and quick answers" },
  { id: "llama3.1:8b", label: "Llama 3.1 8B", fit: "Fast fallback with long context" },
  { id: "qwen3:8b", label: "Qwen3 8B", fit: "Balanced low-memory profile" },
  { id: "gemma3:12b", label: "Gemma 3 12B", fit: "Strong fallback for summarization" },
  { id: "qwen3:14b", label: "Qwen3 14B", fit: "Recommended 24GB profile" },
  { id: "gemma3:27b", label: "Gemma 3 27B", fit: "Stretch profile with memory headroom" },
  { id: "qwen3:30b", label: "Qwen3 30B", fit: "Large local synthesis profile" },
];

export const EMBEDDING_MODELS = [
  { id: "nomic-embed-text", label: "nomic-embed-text", fit: "Default local retrieval" },
  { id: "mxbai-embed-large", label: "mxbai-embed-large", fit: "Higher-quality English retrieval" },
  { id: "bge-m3", label: "bge-m3", fit: "Multilingual and long-document retrieval" },
  { id: "qwen3-embedding", label: "qwen3-embedding", fit: "Qwen-family embedding profile" },
  { id: "nomic-embed-text-v2-moe", label: "nomic-embed-text-v2-moe", fit: "New multilingual MoE embedding profile" },
];

export function profileByRam(id = "24gb") {
  return MAC_RAM_PROFILES.find((profile) => profile.id === id) ?? MAC_RAM_PROFILES[2];
}
