import "dotenv/config";
import { createServer } from "./server.js";

const PORT = parseInt(process.env["PORT"] ?? "3001", 10);

const app = createServer();

app.listen(PORT, () => {
  console.log(`[lumabet-api] listening on http://localhost:${PORT}`);
});
