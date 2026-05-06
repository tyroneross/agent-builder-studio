import { pathToFileURL } from "node:url";
import { createAppServer } from "./server/create-server.mjs";

const PORT = Number(process.env.PORT || 3031);

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  createAppServer().listen(PORT, "127.0.0.1", () => {
    console.log(`Chief of Staff running at http://localhost:${PORT}`);
  });
}

export { createAppServer };
