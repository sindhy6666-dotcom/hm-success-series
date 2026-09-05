---
name: HM Success Series authentication boundary
description: Authentication and access policy for the shared notes app.
---

HM Success Series uses Replit-managed Clerk for browser authentication. The base landing page stays public, authenticated users enter the notes portal, and the browser relies on Clerk's same-origin session cookie rather than manually attaching bearer tokens.

The shared list and binary download endpoints remain readable without a session so existing public viewing/download behavior is preserved. Upload and file deletion require both an authenticated Clerk session and the existing owner password. The owner password is kept in the browser session after unlock and sent only as an owner-auth header for those operations. Like and comment mutations require an authenticated Clerk session.

**Why:** The product already supports shared reading while writes should be attributable to an account, and file management operations need the separate owner-only control that predates Clerk.

**How to apply:** Keep auth routing and cookie transport aligned with the canonical Clerk setup. If adding a new state-changing notes endpoint, put the server-side auth guard before parsing or mutating request data. File-management routes should also validate the owner password before parsing or mutating request data.