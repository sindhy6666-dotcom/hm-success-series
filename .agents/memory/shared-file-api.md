---
name: Shared file API storage
 description: Durable rules for shared uploaded-file endpoints.
---

Shared note list endpoints should return metadata and social data only; file bytes stay server-side and are fetched on demand for preview/download. Multipart parser errors should be converted into JSON responses so the client can show an actionable message.

**Why:** Large base64 file payloads in every list refresh make community sync fragile and can turn a successful upload into a visible list-refresh failure.

**How to apply:** Keep upload/download as separate binary routes, enforce an explicit upload size limit, and parse/display the server response in the upload UI.
