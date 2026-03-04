require("dotenv").config();
const express = require("express");
const router = express.Router();
const axios = require("axios");
const jwt = require("jsonwebtoken");
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL_BOOKS,
  process.env.SUPABASE_SERVICE_KEY_BOOKS,
);

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function pathToId(filePath) {
  return filePath
    .replace(/\.json$/i, "")
    .split("/")
    .join("");
}

function repoUrl(subpath = "") {
  return `https://api.github.com/repos/${process.env.GITHUB_REPO_OWNER}/${process.env.GITHUB_REPO_NAME}${subpath}`;
}

function githubHeaders() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_PERSONAL_TOKEN}`,
    Accept: "application/vnd.github+json",
  };
}

function githubAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  const token = authHeader.split(" ")[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.githubToken = decoded.githubToken;
    next();
  } catch {
    return res.status(401).json({ success: false, message: "Invalid token" });
  }
}

function pushSecretMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (
    !authHeader ||
    authHeader !== `Bearer ${process.env.PUSH_NOTIFY_SECRET}`
  ) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  next();
}

// ─────────────────────────────────────────────
// MANIFEST
// ─────────────────────────────────────────────

const MANIFEST_REPO_PATH = "manifest.json";
let _manifestCache = null;

async function getManifest() {
  if (_manifestCache) return _manifestCache;
  console.log("[Manifest] Cache miss — fetching from GitHub…");
  const { content } = await fetchManifestFromRepo();
  _manifestCache = content;
  console.log(
    `[Manifest] Cached — ${Object.keys(content.files ?? {}).length} files.`,
  );
  return _manifestCache;
}

function invalidateManifestCache() {
  _manifestCache = null;
  console.log("[Manifest] Cache invalidated.");
}

async function fetchManifestFromRepo() {
  const response = await axios.get(repoUrl(`/contents/${MANIFEST_REPO_PATH}`), {
    headers: githubHeaders(),
  });
  const raw = Buffer.from(response.data.content, "base64").toString("utf-8");
  return { content: JSON.parse(raw), sha: response.data.sha };
}

async function regenerateAndCommitManifest() {
  const branch = process.env.GITHUB_BRANCH || "main";

  const treeResponse = await axios.get(
    repoUrl(`/git/trees/${branch}?recursive=1`),
    { headers: githubHeaders() },
  );

  if (treeResponse.data.truncated) {
    console.warn("Warning: GitHub tree response was truncated.");
  }

  const files = {};
  for (const item of treeResponse.data.tree) {
    if (
      item.type === "blob" &&
      item.path.endsWith(".json") &&
      item.path !== MANIFEST_REPO_PATH
    ) {
      const id = pathToId(item.path);
      files[id] = { path: item.path, sha: item.sha };
    }
  }

  const newManifest = {
    lastUpdated: new Date().toISOString(),
    fileCount: Object.keys(files).length,
    files,
  };

  const encoded = Buffer.from(JSON.stringify(newManifest, null, 2)).toString(
    "base64",
  );

  let currentSha = null;
  try {
    const { sha } = await fetchManifestFromRepo();
    currentSha = sha;
  } catch {
    console.log("No existing manifest.json — creating it for the first time.");
  }

  await axios.put(
    repoUrl(`/contents/${MANIFEST_REPO_PATH}`),
    {
      message: "chore: update manifest.json [skip ci]",
      content: encoded,
      branch,
      ...(currentSha && { sha: currentSha }),
    },
    { headers: githubHeaders() },
  );

  _manifestCache = newManifest;
  console.log(`Manifest updated: ${Object.keys(files).length} files.`);
  return newManifest;
}

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────

router.get("/auth/github", (req, res) => {
  const githubAuthUrl =
    `https://github.com/login/oauth/authorize` +
    `?client_id=${process.env.GITHUB_CLIENT_ID}` +
    `&scope=repo`;
  res.redirect(githubAuthUrl);
});

router.get("/auth/github/callback", async (req, res) => {
  try {
    const { code } = req.query;
    const tokenResponse = await axios.post(
      "https://github.com/login/oauth/access_token",
      {
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      },
      { headers: { Accept: "application/json" } },
    );
    const accessToken = tokenResponse.data.access_token;
    const jwtToken = jwt.sign(
      { githubToken: accessToken },
      process.env.JWT_SECRET,
      { expiresIn: "1h" },
    );
    res.redirect(`${process.env.FRONTEND_URL}?token=${jwtToken}`);
  } catch (error) {
    console.error("GitHub OAuth error:", error.response?.data || error);
    res.status(500).json({ success: false, message: "OAuth failed" });
  }
});

// ─────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────

router.get("/health", async (req, res) => {
  try {
    const response = await axios.get(repoUrl(), { headers: githubHeaders() });
    res.json({
      success: true,
      message: "Connected to GitHub successfully",
      repo: response.data.full_name,
      private: response.data.private,
    });
  } catch (error) {
    console.error("GitHub connection error:", error.response?.data || error);
    res.status(500).json({
      success: false,
      message: "Failed to connect to GitHub",
      error: error.response?.data || error.message,
    });
  }
});

// ─────────────────────────────────────────────
// GET MANIFEST
// ─────────────────────────────────────────────

router.get("/manifest", async (req, res) => {
  try {
    const { content } = await fetchManifestFromRepo();
    res.json({ success: true, ...content });
  } catch (error) {
    if (error.response?.status === 404) {
      try {
        const manifest = await regenerateAndCommitManifest();
        return res.json({ success: true, ...manifest });
      } catch (genError) {
        console.error(
          "Manifest generation error:",
          genError.response?.data || genError,
        );
        return res
          .status(500)
          .json({ success: false, message: "Failed to generate manifest" });
      }
    }
    console.error("Manifest fetch error:", error.response?.data || error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch manifest" });
  }
});

// ─────────────────────────────────────────────
// LAST PUSH
// ─────────────────────────────────────────────

router.get("/last-push", async (req, res) => {
  try {
    const { content } = await fetchManifestFromRepo();
    res.json({ success: true, lastPushAt: content.lastUpdated || null });
  } catch (error) {
    if (error.response?.status === 404) {
      return res.json({
        success: true,
        lastPushAt: null,
        message: "No manifest yet",
      });
    }
    console.error("Last push error:", error.response?.data || error);
    res
      .status(500)
      .json({ success: false, message: "Failed to get last push time" });
  }
});

// ─────────────────────────────────────────────
// NOTIFY PUSH
// ─────────────────────────────────────────────

router.post("/notify-push", pushSecretMiddleware, async (req, res) => {
  try {
    const manifest = await regenerateAndCommitManifest();
    res.json({
      success: true,
      message: "Manifest regenerated and committed to repo",
      lastUpdated: manifest.lastUpdated,
      fileCount: manifest.fileCount,
    });
  } catch (error) {
    console.error("Notify push error:", error.response?.data || error);
    res
      .status(500)
      .json({ success: false, message: "Failed to regenerate manifest" });
  }
});

// ─────────────────────────────────────────────
// GET FILE BY APP ID
// ─────────────────────────────────────────────

router.get("/file/id/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid file ID" });
    }

    const { content: manifest } = await fetchManifestFromRepo();
    const entry = manifest.files[id];

    if (!entry) {
      return res
        .status(404)
        .json({ success: false, message: `File ID '${id}' not found` });
    }

    const filePath = entry.path.replace(/\.json$/i, "");

    const { data, error } = await supabase
      .from("seven_tunes_books")
      .select("*")
      .eq("file_path", filePath)
      .single();

    if (error || !data) {
      return res
        .status(404)
        .json({ success: false, message: "File not found in database" });
    }

    res.json({
      success: true,
      id,
      path: entry.path,
      json: data.content,
      updated_at: data.updated_at,
    });
  } catch (error) {
    console.error("File by ID error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────
// GET FILE BY PATH
// ─────────────────────────────────────────────

router.get("/file", async (req, res) => {
  try {
    const filePath = (req.query.path || "").replace(/\.json$/i, "");

    if (!filePath) {
      return res.status(400).json({ success: false, message: "Missing path" });
    }
    if (filePath.includes("..")) {
      return res.status(400).json({ success: false, message: "Invalid path" });
    }

    const { data, error } = await supabase
      .from("seven_tunes_books")
      .select("*")
      .eq("file_path", filePath)
      .single();

    if (error || !data) {
      return res
        .status(404)
        .json({ success: false, message: "File not found" });
    }

    res.json({
      success: true,
      id: data.file_path.split("/").join(""),
      path: data.file_path,
      json: data.content,
      updated_at: data.updated_at,
    });
  } catch (error) {
    console.error("File fetch error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────
// BATCH FILES
// ─────────────────────────────────────────────

router.post("/files/batch", async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "ids must be a non-empty array" });
    }
    if (ids.length > 100) {
      return res
        .status(400)
        .json({ success: false, message: "Maximum 100 files per batch" });
    }

    let manifest;
    try {
      manifest = await getManifest();
    } catch (err) {
      return res
        .status(500)
        .json({ success: false, message: "Manifest load failed" });
    }

    const idToPath = {};
    const notFound = [];

    for (const id of ids) {
      const entry = manifest.files[id];
      if (!entry) {
        notFound.push(id);
      } else {
        idToPath[id] = entry.path.replace(/\.json$/i, "");
      }
    }

    const filePaths = Object.values(idToPath);

    const { data, error } = await supabase
      .from("seven_tunes_books")
      .select("file_path, content, updated_at")
      .in("file_path", filePaths);

    if (error) throw new Error(error.message);

    const pathToRow = {};
    for (const row of data) {
      pathToRow[row.file_path] = row;
    }

    const files = {};
    for (const [id, path] of Object.entries(idToPath)) {
      const row = pathToRow[path];
      if (row) {
        files[id] = {
          path: path + ".json",
          json: row.content,
          updated_at: row.updated_at,
        };
      } else {
        notFound.push(id);
      }
    }

    console.log(
      `[Batch] fetched: ${Object.keys(files).length}, notFound: ${notFound.length}`,
    );

    res.json({
      success: true,
      fetched: Object.keys(files).length,
      notFound,
      files,
    });
  } catch (error) {
    console.error("[Batch] error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────
// FOLDERS
// ─────────────────────────────────────────────

router.get("/folders/*?", async (req, res) => {
  try {
    const folderPath = (req.params[0] || "").replace(/\/$/, "");
    const prefix = folderPath ? folderPath + "/" : "";

    let query = supabase
      .from("seven_tunes_books")
      .select("file_path, english_title, arabic_title, coptic_title");

    if (prefix) {
      query = query.like("file_path", `${prefix}%`);
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    if (data.length === 0 && folderPath) {
      return res
        .status(404)
        .json({ success: false, message: "Folder not found" });
    }

    const subfolders = new Set();
    const files = [];

    for (const row of data) {
      const relative = row.file_path.slice(prefix.length);
      const parts = relative.split("/");

      if (parts.length === 1) {
        files.push({
          name: parts[0],
          path: row.file_path,
          id: row.file_path.split("/").join(""),
          type: "file",
          english_title: row.english_title,
          arabic_title: row.arabic_title,
          coptic_title: row.coptic_title,
        });
      } else {
        subfolders.add(parts[0]);
      }
    }

    const items = [
      ...[...subfolders].map((name) => ({
        name,
        path: prefix + name,
        id: null,
        type: "dir",
      })),
      ...files,
    ];

    res.json({
      success: true,
      type: "folder",
      currentPath: folderPath || "root",
      count: items.length,
      items,
    });
  } catch (error) {
    console.error("Folders error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────
// SAVE FILE
// ─────────────────────────────────────────────

router.post("/file", async (req, res) => {
  try {
    const { json, path } = req.body;

    if (!json || !path) {
      return res
        .status(400)
        .json({ success: false, message: "Missing json or path" });
    }
    if (path.includes("..")) {
      return res.status(400).json({ success: false, message: "Invalid path" });
    }

    const filePath = path.replace(/\.json$/i, "");

    const { error } = await supabase
      .from("seven_tunes_books")
      .update({
        content: json,
        english_title: json.EnglishTitle ?? null,
        arabic_title: json.ArabicTitle ?? null,
        coptic_title: json.CopticTitle ?? null,
      })
      .eq("file_path", filePath);

    if (error) throw new Error(error.message);

    res.json({
      success: true,
      message: "File updated successfully",
      path: filePath,
    });
  } catch (error) {
    console.error("File save error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────
// CREATE FOLDER
// ─────────────────────────────────────────────

router.post("/create-folder", async (req, res) => {
  try {
    const { path } = req.body;
    if (!path) {
      return res.status(400).json({ success: false, message: "Missing path" });
    }
    const folderPath = path.replace(/\/.gitkeep$/, "");
    res.json({ success: true, message: "Folder ready", path: folderPath });
  } catch (error) {
    console.error("Create folder error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────
// CREATE FILE
// ─────────────────────────────────────────────

router.post("/create-file", async (req, res) => {
  try {
    const { path, json } = req.body;

    if (!path) {
      return res.status(400).json({ success: false, message: "Missing path" });
    }
    if (path.includes("..")) {
      return res.status(400).json({ success: false, message: "Invalid path" });
    }
    if (!path.endsWith(".json")) {
      return res
        .status(400)
        .json({ success: false, message: "File must be a .json file" });
    }

    const filePath = path.replace(/\.json$/i, "");
    const content = json ?? { Hymn: [] };

    const { error } = await supabase.from("seven_tunes_books").insert({
      file_path: filePath,
      english_title: content.EnglishTitle ?? null,
      arabic_title: content.ArabicTitle ?? null,
      coptic_title: content.CopticTitle ?? null,
      content,
    });

    if (error) {
      if (error.code === "23505") {
        return res
          .status(409)
          .json({
            success: false,
            message: "A file with that name already exists.",
          });
      }
      throw new Error(error.message);
    }

    res.json({ success: true, message: "File created", path: filePath });
  } catch (error) {
    console.error("Create file error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────
// RENAME FILE
// ─────────────────────────────────────────────

router.patch("/rename-file", async (req, res) => {
  try {
    const { oldPath, newPath } = req.body;

    if (!oldPath || !newPath) {
      return res
        .status(400)
        .json({ success: false, message: "Missing oldPath or newPath" });
    }
    if (oldPath.includes("..") || newPath.includes("..")) {
      return res.status(400).json({ success: false, message: "Invalid path" });
    }

    const oldFilePath = oldPath.replace(/\.json$/i, "");
    const newFilePath = newPath.replace(/\.json$/i, "");

    // Check new path doesn't already exist
    const { data: existing } = await supabase
      .from("seven_tunes_books")
      .select("id")
      .eq("file_path", newFilePath)
      .maybeSingle();

    if (existing) {
      return res
        .status(409)
        .json({
          success: false,
          message: "A file with that name already exists.",
        });
    }

    const { error } = await supabase
      .from("seven_tunes_books")
      .update({ file_path: newFilePath })
      .eq("file_path", oldFilePath);

    if (error) throw new Error(error.message);

    res.json({
      success: true,
      message: "File renamed",
      oldPath: oldFilePath,
      newPath: newFilePath,
    });
  } catch (error) {
    console.error("Rename file error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────
// RENAME FOLDER
// Updates file_path prefix for ALL files under the folder.
// ─────────────────────────────────────────────

router.patch("/rename-folder", async (req, res) => {
  try {
    const { oldPath, newPath } = req.body;

    if (!oldPath || !newPath) {
      return res
        .status(400)
        .json({ success: false, message: "Missing oldPath or newPath" });
    }
    if (oldPath.includes("..") || newPath.includes("..")) {
      return res.status(400).json({ success: false, message: "Invalid path" });
    }

    // Fetch all files under old folder prefix
    const { data: files, error: fetchError } = await supabase
      .from("seven_tunes_books")
      .select("id, file_path")
      .like("file_path", `${oldPath}/%`);

    if (fetchError) throw new Error(fetchError.message);

    if (!files || files.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No files found under that folder." });
    }

    // Remap each file_path: swap old prefix for new prefix
    const updates = files.map((file) => ({
      id: file.id,
      file_path: newPath + file.file_path.slice(oldPath.length),
    }));

    const { error: updateError } = await supabase
      .from("seven_tunes_books")
      .upsert(updates, { onConflict: "id" });

    if (updateError) throw new Error(updateError.message);

    res.json({
      success: true,
      message: `Folder renamed — ${files.length} file(s) updated`,
      oldPath,
      newPath,
      filesUpdated: files.length,
    });
  } catch (error) {
    console.error("Rename folder error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────
// SEARCH PREVIEW
// Searches content across files, returns matches + snippets.
// No writes — use before applying replace.
// ─────────────────────────────────────────────

router.post("/search-preview", async (req, res) => {
  try {
    const { search, scope, scopePath, caseSensitive } = req.body;

    if (!search || !search.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Search text cannot be empty." });
    }

    let query = supabase.from("seven_tunes_books").select("file_path, content");

    if (scope === "current" && scopePath) {
      query = query.like("file_path", `${scopePath}/%`);
    }

    const { data: files, error } = await query;
    if (error) throw new Error(error.message);

    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const flags = caseSensitive ? "g" : "gi";
    const regex = new RegExp(escapedSearch, flags);

    const matches = [];

    for (const file of files) {
      const contentStr = JSON.stringify(file.content);
      const found = contentStr.match(regex);
      if (!found) continue;

      const matchCount = found.length;
      const idx = caseSensitive
        ? contentStr.indexOf(search)
        : contentStr.toLowerCase().indexOf(search.toLowerCase());
      const start = Math.max(0, idx - 40);
      const end = Math.min(contentStr.length, idx + search.length + 40);
      const preview = "…" + contentStr.slice(start, end) + "…";

      matches.push({ file_path: file.file_path, matchCount, preview });
    }

    matches.sort((a, b) => b.matchCount - a.matchCount);

    res.json({ success: true, matches, totalFiles: files.length });
  } catch (error) {
    console.error("Search preview error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────
// SEARCH & REPLACE
// Applies find/replace across file content in Supabase.
// Skips any file where replacement would produce invalid JSON.
// ─────────────────────────────────────────────

router.post("/search-replace", async (req, res) => {
  try {
    const { search, replace, scope, scopePath, caseSensitive } = req.body;

    if (!search || !search.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Search text cannot be empty." });
    }

    let query = supabase
      .from("seven_tunes_books")
      .select("id, file_path, content");

    if (scope === "current" && scopePath) {
      query = query.like("file_path", `${scopePath}/%`);
    }

    const { data: files, error: fetchError } = await query;
    if (fetchError) throw new Error(fetchError.message);

    const replaceWith = replace ?? "";
    const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const flags = caseSensitive ? "g" : "gi";
    const regex = new RegExp(escapedSearch, flags);

    const toUpdate = [];

    for (const file of files) {
      const original = JSON.stringify(file.content);
      const updated = original.replace(regex, replaceWith);
      if (updated === original) continue;

      try {
        toUpdate.push({
          id: file.id,
          file_path: file.file_path,
          content: JSON.parse(updated),
        });
      } catch {
        console.warn(
          `[Search-Replace] Skipped ${file.file_path} — replacement produced invalid JSON.`,
        );
      }
    }

    if (toUpdate.length === 0) {
      return res.json({
        success: true,
        updated: 0,
        message: "No matches found.",
      });
    }

    const BATCH = 50;
    for (let i = 0; i < toUpdate.length; i += BATCH) {
      const batch = toUpdate.slice(i, i + BATCH);
      const { error: updateError } = await supabase
        .from("seven_tunes_books")
        .upsert(batch, { onConflict: "id" });
      if (updateError) throw new Error(updateError.message);
    }

    console.log(
      `[Search-Replace] "${search}" → "${replaceWith}" in ${toUpdate.length} file(s).`,
    );

    res.json({
      success: true,
      updated: toUpdate.length,
      message: `Replaced in ${toUpdate.length} file(s).`,
    });
  } catch (error) {
    console.error("Search-replace error:", error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

// ─────────────────────────────────────────────
// MIGRATE
// One-time seed from GitHub → Supabase.
// Delete after use.
// ─────────────────────────────────────────────

router.post("/migrate", async (req, res) => {
  const { startFrom = null, dryRun = false } = req.body ?? {};

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Transfer-Encoding", "chunked");

  const log = (msg) => {
    console.log(msg);
    res.write(JSON.stringify({ log: msg }) + "\n");
  };

  try {
    const branch = process.env.GITHUB_BRANCH || "main";
    log(`[Migration] Fetching repo tree (branch: ${branch})…`);

    const treeResponse = await axios.get(
      repoUrl(`/git/trees/${branch}?recursive=1`),
      { headers: githubHeaders() },
    );

    if (treeResponse.data.truncated) {
      log(
        "[Migration] ⚠️  GitHub tree was truncated — some files may be missed.",
      );
    }

    let filePaths = treeResponse.data.tree
      .filter(
        (item) =>
          item.type === "blob" &&
          item.path.endsWith(".json") &&
          item.path !== MANIFEST_REPO_PATH,
      )
      .map((item) => item.path);

    log(`[Migration] Found ${filePaths.length} JSON files.`);

    if (startFrom) {
      const idx = filePaths.indexOf(startFrom);
      if (idx === -1) {
        log(`[Migration] ⚠️  startFrom not found — starting from beginning.`);
      } else {
        filePaths = filePaths.slice(idx);
        log(
          `[Migration] Resuming from "${startFrom}" (${filePaths.length} remaining).`,
        );
      }
    }

    if (dryRun) log(`[Migration] DRY RUN — nothing will be written.`);

    const CONCURRENCY = 5;
    const DELAY_MS = 300;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let succeeded = 0;
    let failed = 0;
    const errors = [];

    const chunks = [];
    for (let i = 0; i < filePaths.length; i += CONCURRENCY) {
      chunks.push(filePaths.slice(i, i + CONCURRENCY));
    }

    for (let ci = 0; ci < chunks.length; ci++) {
      log(`[Migration] Chunk ${ci + 1}/${chunks.length}`);

      await Promise.all(
        chunks[ci].map(async (filePath) => {
          try {
            const fileResponse = await axios.get(
              repoUrl(`/contents/${filePath}`),
              { headers: githubHeaders() },
            );

            const raw = Buffer.from(fileResponse.data.content, "base64")
              .toString("utf-8")
              .replace(/^\uFEFF/, "")
              .trim();

            const content = JSON.parse(raw);

            const row = {
              file_path: filePath.replace(/\.json$/i, ""),
              english_title: content.EnglishTitle ?? null,
              arabic_title: content.ArabicTitle ?? null,
              coptic_title: content.CopticTitle ?? null,
              content,
            };

            if (!dryRun) {
              const { error } = await supabase
                .from("seven_tunes_books")
                .upsert(row, { onConflict: "file_path" });
              if (error) throw new Error(error.message);
            }

            log(`  ✓ ${filePath}`);
            succeeded++;
          } catch (err) {
            const msg = err.message || String(err);
            log(`  ✗ ${filePath} — ${msg}`);
            errors.push({ path: filePath, error: msg });
            failed++;
          }
        }),
      );

      if (ci < chunks.length - 1) await sleep(DELAY_MS);
    }

    log(`[Migration] Done — ✓ ${succeeded} succeeded, ✗ ${failed} failed.`);
    if (failed > 0) {
      log(`[Migration] Resume with: { "startFrom": "${errors[0].path}" }`);
    }

    res.end(
      JSON.stringify({
        success: true,
        dryRun,
        total: filePaths.length,
        succeeded,
        failed,
        ...(errors.length > 0 && { errors }),
      }),
    );
  } catch (error) {
    const msg = error.response?.data?.message || error.message;
    log(`[Migration] Fatal: ${msg}`);
    res.end(JSON.stringify({ success: false, error: msg }));
  }
});

module.exports = router;
