// Re-export shim over @tyroneross/local-llm. The canonical provider layer now
// lives in the shared package; this path is preserved for back-compat with this
// app's existing importers (tests, cos-runner, UI). Includes mlx (new).
export {
  chat,
  setChatImpl,
  PROVIDER_NAMES,
  LOCAL_PROVIDERS,
  ollamaTags,
  ollamaPs,
} from "@tyroneross/local-llm";
