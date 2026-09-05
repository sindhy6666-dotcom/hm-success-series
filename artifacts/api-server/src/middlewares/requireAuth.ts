import { clerkClient, getAuth } from "@clerk/express";
import type { RequestHandler } from "express";

export const requireAuth: RequestHandler = (req, res, next) => {
  const auth = getAuth(req);
  const userId = auth?.sessionClaims?.userId || auth?.userId;

  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  next();
};

const OWNER_PASSWORD = process.env.ZNOTES_OWNER_PASSWORD ?? "znotes@me";
const OWNER_EMAIL = "sindhy66.66@gmail.com";

export const requireOwnerPassword: RequestHandler = async (req, res, next) => {
  const providedPassword = req.get("x-owner-password");

  if (!providedPassword || providedPassword !== OWNER_PASSWORD) {
    res.status(401).json({ error: "Owner authentication required" });
    return;
  }

  const userId = getAuth(req)?.userId;
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const user = await clerkClient.users.getUser(userId);
    const email = user.primaryEmailAddress?.emailAddress.trim().toLowerCase();

    if (email !== OWNER_EMAIL) {
      res.status(403).json({ error: "Owner access required" });
      return;
    }

    next();
  } catch (error) {
    req.log?.error?.({ err: error }, "Failed to verify owner email");
    res.status(403).json({ error: "Owner access could not be verified" });
  }
};