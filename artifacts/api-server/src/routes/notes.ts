import { Router, type IRouter, type RequestHandler } from "express";
import multer from "multer";
import { db } from "@workspace/db";
import { notesTable, commentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { AddCommentBody } from "@workspace/api-zod";
import { requireAuth, requireOwnerPassword } from "../middlewares/requireAuth";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 100 * 1024 * 1024,
    files: 1,
  },
});

// Multer runs before the route handler, so parser/size errors must be handled
// explicitly instead of falling through to Express's generic HTML error page.
const parseUpload: RequestHandler = (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (!err) {
      next();
      return;
    }

    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        res.status(413).json({ error: "PDF is too large. The maximum size is 100 MB." });
        return;
      }

      res.status(400).json({ error: `Upload could not be parsed: ${err.message}` });
      return;
    }

    res.status(400).json({ error: "Upload could not be parsed. Please choose a valid file." });
  });
};

// GET /api/notes — list all notes with their comments
router.get("/notes", async (req, res) => {
  try {
    // Never load the base64 file payload when rendering the shared list.
    // Large PDFs stay server-side and are fetched only by download/preview.
    const notes = await db
      .select({
        id: notesTable.id,
        name: notesTable.name,
        fileType: notesTable.fileType,
        category: notesTable.category,
        size: notesTable.size,
        addedAt: notesTable.addedAt,
        likes: notesTable.likes,
      })
      .from(notesTable)
      .orderBy(notesTable.addedAt);
    const comments = await db.select().from(commentsTable);

    const commentsByNote: Record<number, typeof comments> = {};
    for (const c of comments) {
      if (!commentsByNote[c.noteId]) commentsByNote[c.noteId] = [];
      commentsByNote[c.noteId].push(c);
    }

    const result = notes.map((n) => ({
      id: n.id,
      name: n.name,
      fileType: n.fileType,
      category: n.category,
      size: n.size,
      addedAt: Number(n.addedAt),
      likes: n.likes,
      comments: (commentsByNote[n.id] ?? []).map((c) => ({
        id: c.id,
        noteId: c.noteId,
        text: c.text,
        addedAt: Number(c.addedAt),
      })),
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to list notes");
    res.status(500).json({ error: "Failed to list notes" });
  }
});

// POST /api/notes — upload a new note (multipart/form-data)
router.post("/notes", requireAuth, requireOwnerPassword, parseUpload, async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No file provided" });
      return;
    }

    const name = (req.body.name as string) || req.file.originalname;
    const category = (req.body.category as string) || "Notes";
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    const isPdf = ext === "pdf" || req.file.mimetype === "application/pdf";
    const normalizedName = isPdf && !name.toLowerCase().endsWith(".pdf")
      ? `${name}.pdf`
      : name;
    const fileData = req.file.buffer.toString("base64");

    const [inserted] = await db
      .insert(notesTable)
      .values({
        name: normalizedName,
        fileType: isPdf ? "pdf" : ext,
        category,
        size: req.file.size,
        fileData,
        addedAt: Date.now(),
        likes: 0,
      })
      .returning();

    res.status(201).json({
      id: inserted.id,
      name: inserted.name,
      fileType: inserted.fileType,
      category: inserted.category,
      size: inserted.size,
      addedAt: Number(inserted.addedAt),
      likes: inserted.likes,
      comments: [],
    });
  } catch (err) {
    req.log.error({ err }, "Failed to upload note");
    res.status(500).json({ error: "Failed to upload note" });
  }
});

// GET /api/notes/:id/download — download raw file
router.get("/notes/:id/download", async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [note] = await db.select().from(notesTable).where(eq(notesTable.id, id));

    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }

    const buffer = Buffer.from(note.fileData, "base64");
    res.setHeader("Content-Disposition", `attachment; filename="${note.name}"`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err) {
    req.log.error({ err }, "Failed to download note");
    res.status(500).json({ error: "Failed to download note" });
  }
});

// DELETE /api/notes/:id
router.delete("/notes/:id", requireAuth, requireOwnerPassword, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    await db.delete(notesTable).where(eq(notesTable.id, id));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete note");
    res.status(500).json({ error: "Failed to delete note" });
  }
});

// POST /api/notes/:id/like — increment like
router.post("/notes/:id/like", requireAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const [note] = await db.select().from(notesTable).where(eq(notesTable.id, id));

    if (!note) {
      res.status(404).json({ error: "Note not found" });
      return;
    }

    const [updated] = await db
      .update(notesTable)
      .set({ likes: note.likes + 1 })
      .where(eq(notesTable.id, id))
      .returning({ id: notesTable.id, likes: notesTable.likes });

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to like note");
    res.status(500).json({ error: "Failed to like note" });
  }
});

// POST /api/notes/:id/comments
router.post("/notes/:id/comments", requireAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    const parsed = AddCommentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid comment" });
      return;
    }

    const [inserted] = await db
      .insert(commentsTable)
      .values({ noteId: id, text: parsed.data.text, addedAt: Date.now() })
      .returning();

    res.status(201).json({
      id: inserted.id,
      noteId: inserted.noteId,
      text: inserted.text,
      addedAt: Number(inserted.addedAt),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to add comment");
    res.status(500).json({ error: "Failed to add comment" });
  }
});

// DELETE /api/notes/:id/comments/:commentId
router.delete("/notes/:id/comments/:commentId", requireAuth, async (req, res) => {
  try {
    const commentId = parseInt(String(req.params.commentId), 10);
    await db.delete(commentsTable).where(eq(commentsTable.id, commentId));
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete comment");
    res.status(500).json({ error: "Failed to delete comment" });
  }
});

export default router;
