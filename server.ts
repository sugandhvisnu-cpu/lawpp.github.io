import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { 
  addCaseHandler, 
  resyncCaseHandler, 
  updateCaseNotesHandler,
  checkAndFetchUpdatedDetails 
} from "./src/services/caseSyncService";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // JSON parsing middleware is required for parsing incoming POST bodies
  app.use(express.json());

  // Register API routes first before Vite middleware
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/cases/add", addCaseHandler);
  app.post("/api/cases/resync", resyncCaseHandler);
  app.post("/api/cases/notes", updateCaseNotesHandler);
  app.post("/api/sync", addCaseHandler);

  // Start background worker for delayed 12-minute eCourts sync (runs every 60 seconds)
  checkAndFetchUpdatedDetails().catch(err => console.error("Initial worker run error:", err));
  setInterval(() => {
    checkAndFetchUpdatedDetails().catch(err => console.error("Periodic worker run error:", err));
  }, 60 * 1000);

  // Serve static assets or use Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start custom server:", err);
});
