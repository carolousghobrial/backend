require("dotenv").config();
const express = require("express");
const axios = require("axios");
const jwt = require("jsonwebtoken");
const bp = require("body-parser");
const app = express();

app.use(bp.json());
app.use(bp.urlencoded({ extended: true }));

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

async function fetchManifestFromRepo() {
  const response = await axios.get(repoUrl(`/contents/${MANIFEST_REPO_PATH}`), {
    headers: githubHeaders(),
  });
  const raw = Buffer.from(response.data.content, "base64").toString("utf-8");
  return {
    content: JSON.parse(raw),
    sha: response.data.sha,
  };
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
      files[id] = {
        path: item.path,
        sha: item.sha,
      };
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

  console.log(`Manifest updated: ${Object.keys(files).length} files.`);
  return newManifest;
}

// ─────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────

app.get("/auth/github", (req, res) => {
  const githubAuthUrl =
    `https://github.com/login/oauth/authorize` +
    `?client_id=${process.env.GITHUB_CLIENT_ID}` +
    `&scope=repo`;
  res.redirect(githubAuthUrl);
});

app.get("/auth/github/callback", async (req, res) => {
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

app.get("/", async (req, res) => {
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

app.get("/manifest", async (req, res) => {
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

app.get("/last-push", async (req, res) => {
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
// Called by GitHub Action on every push to main.
// ─────────────────────────────────────────────

app.post("/notify-push", pushSecretMiddleware, async (req, res) => {
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

app.get("/file/id/:id", async (req, res) => {
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

    const fileResponse = await axios.get(repoUrl(`/contents/${entry.path}`), {
      headers: githubHeaders(),
    });

    const raw = Buffer.from(fileResponse.data.content, "base64")
      .toString("utf-8")
      .replace(/^\uFEFF/, "")
      .trim();

    res.json({
      success: true,
      id,
      path: entry.path,
      sha: fileResponse.data.sha,
      size: fileResponse.data.size,
      json: JSON.parse(raw),
    });
  } catch (error) {
    console.error("File by ID error:", error.response?.data || error);
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || "Failed to fetch file",
    });
  }
});

// ─────────────────────────────────────────────
// GET FILE BY PATH
// ─────────────────────────────────────────────

app.get("/file", async (req, res) => {
  try {
    const filePath = req.query.path;

    if (!filePath) {
      return res
        .status(400)
        .json({ success: false, message: "Missing file path" });
    }

    if (filePath.includes("..")) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid file path" });
    }

    const response = await axios.get(repoUrl(`/contents/${filePath}`), {
      headers: githubHeaders(),
    });

    if (response.data.type !== "file") {
      return res
        .status(400)
        .json({ success: false, message: "Path is not a file" });
    }

    const raw = Buffer.from(response.data.content, "base64")
      .toString("utf-8")
      .replace(/^\uFEFF/, "")
      .trim();

    res.json({
      success: true,
      id: pathToId(filePath),
      path: filePath,
      sha: response.data.sha,
      size: response.data.size,
      json: JSON.parse(raw),
    });
  } catch (error) {
    console.error("File fetch error:", error.response?.data || error);
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || "Failed to fetch file",
    });
  }
});

// ─────────────────────────────────────────────
// BATCH FILES
// ─────────────────────────────────────────────

app.post("/files/batch", async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "ids must be a non-empty array" });
    }

    if (ids.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Maximum 100 files per batch request",
      });
    }

    const { content: manifest } = await fetchManifestFromRepo();

    const CONCURRENCY = 10;
    const results = {};
    const notFound = [];

    const chunks = [];
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      chunks.push(ids.slice(i, i + CONCURRENCY));
    }

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (id) => {
          const entry = manifest.files[id];
          if (!entry) {
            notFound.push(id);
            return;
          }
          try {
            const fileResponse = await axios.get(
              repoUrl(`/contents/${entry.path}`),
              { headers: githubHeaders() },
            );
            const raw = Buffer.from(fileResponse.data.content, "base64")
              .toString("utf-8")
              .replace(/^\uFEFF/, "")
              .trim();
            results[id] = {
              path: entry.path,
              sha: fileResponse.data.sha,
              json: JSON.parse(raw),
            };
          } catch (err) {
            console.error(`Failed to fetch file ${id}:`, err.message);
            notFound.push(id);
          }
        }),
      );
    }

    res.json({
      success: true,
      fetched: Object.keys(results).length,
      notFound,
      files: results,
    });
  } catch (error) {
    console.error("Batch fetch error:", error.response?.data || error);
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch batch files" });
  }
});

// ─────────────────────────────────────────────
// FOLDERS
// ─────────────────────────────────────────────

app.get("/folders/*?", async (req, res) => {
  try {
    const folderPath = req.params[0] || "";
    const githubUrl = folderPath
      ? repoUrl(`/contents/${folderPath}`)
      : repoUrl("/contents");

    const response = await axios.get(githubUrl, { headers: githubHeaders() });

    if (!Array.isArray(response.data)) {
      const file = response.data;
      return res.json({
        success: true,
        type: "file",
        item: {
          name: file.name,
          path: file.path,
          id: pathToId(file.path),
          size: file.size,
          sha: file.sha,
          apiUrl: file.url,
          downloadUrl: file.download_url,
          htmlUrl: file.html_url,
        },
      });
    }

    const items = response.data.map((item) => ({
      name: item.name,
      path: item.path,
      id: item.type === "file" ? pathToId(item.path) : null,
      type: item.type,
      size: item.size || null,
      sha: item.sha,
      apiUrl: item.url,
      downloadUrl: item.download_url || null,
      htmlUrl: item.html_url,
    }));

    res.json({
      success: true,
      type: "folder",
      currentPath: folderPath || "root",
      count: items.length,
      items,
    });
  } catch (error) {
    console.error("GitHub contents error:", error.response?.data || error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch contents",
      error: error.response?.data || error.message,
    });
  }
});

// ─────────────────────────────────────────────
// SAVE FILE
// ─────────────────────────────────────────────

app.post("/file", async (req, res) => {
  try {
    const { json, sha, path } = req.body;

    if (!json || !sha || !path) {
      return res
        .status(400)
        .json({ success: false, message: "Missing json, sha, or path" });
    }

    if (path.includes("..")) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid file path" });
    }

    const encoded = Buffer.from(JSON.stringify(json, null, 2)).toString(
      "base64",
    );

    const response = await axios.put(
      repoUrl(`/contents/${path}`),
      {
        message: `Update ${path} via admin panel`,
        content: encoded,
        sha,
        branch: process.env.GITHUB_BRANCH || "main",
      },
      { headers: githubHeaders() },
    );

    // Fire-and-forget — update the manifest SHA for this file without blocking the save
    regenerateAndCommitManifest().catch((err) =>
      console.error("Manifest update after save failed:", err.message),
    );

    res.json({
      success: true,
      message: "File updated successfully",
      // Return new SHA so the editor can do subsequent saves without a 409
      sha: response.data.content?.sha,
    });
  } catch (error) {
    if (error.response?.status === 409) {
      return res.status(409).json({
        success: false,
        message: "File was updated by someone else. Refresh and try again.",
      });
    }
    console.error("GitHub save error:", error.response?.data || error);
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || "Failed to update file",
    });
  }
});

// ─────────────────────────────────────────────
// CREATE FOLDER
// ─────────────────────────────────────────────

app.post("/create-folder", async (req, res) => {
  try {
    const { path } = req.body;

    if (!path) {
      return res.status(400).json({ success: false, message: "Missing path" });
    }
    if (path.includes("..")) {
      return res.status(400).json({ success: false, message: "Invalid path" });
    }
    if (!path.endsWith("/.gitkeep")) {
      return res.status(400).json({
        success: false,
        message: "Folder path must end with /.gitkeep",
      });
    }

    try {
      await axios.get(repoUrl(`/contents/${path}`), {
        headers: githubHeaders(),
      });
      return res.status(409).json({
        success: false,
        message: "A folder with that name already exists.",
      });
    } catch (checkErr) {
      if (checkErr.response?.status !== 404) throw checkErr;
    }

    await axios.put(
      repoUrl(`/contents/${path}`),
      {
        message: `Create folder ${path.replace("/.gitkeep", "")} via admin panel`,
        content: Buffer.from("").toString("base64"),
        branch: process.env.GITHUB_BRANCH || "main",
      },
      { headers: githubHeaders() },
    );

    // .gitkeep isn't a JSON file so it won't change the manifest's file list,
    // but regenerate anyway to keep lastUpdated current
    regenerateAndCommitManifest().catch((err) =>
      console.error(
        "Manifest update after folder creation failed:",
        err.message,
      ),
    );

    res.json({
      success: true,
      message: "Folder created",
      path: path.replace("/.gitkeep", ""),
    });
  } catch (error) {
    console.error("Create folder error:", error.response?.data || error);
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || "Failed to create folder",
    });
  }
});

// ─────────────────────────────────────────────
// CREATE FILE
// ─────────────────────────────────────────────

app.post("/create-file", async (req, res) => {
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

    try {
      await axios.get(repoUrl(`/contents/${path}`), {
        headers: githubHeaders(),
      });
      return res.status(409).json({
        success: false,
        message: "A file with that name already exists.",
      });
    } catch (checkErr) {
      if (checkErr.response?.status !== 404) throw checkErr;
    }

    const content = json ?? { Hymn: [] };
    const encoded = Buffer.from(JSON.stringify(content, null, 2)).toString(
      "base64",
    );

    const response = await axios.put(
      repoUrl(`/contents/${path}`),
      {
        message: `Create ${path} via admin panel`,
        content: encoded,
        branch: process.env.GITHUB_BRANCH || "main",
      },
      { headers: githubHeaders() },
    );

    // ✅ Await this — the new file must be in the manifest before the
    // React Native app tries to fetch it
    try {
      await regenerateAndCommitManifest();
    } catch (manifestErr) {
      // Non-fatal: file exists, manifest will catch up on next push
      console.error(
        "Manifest update after file creation failed:",
        manifestErr.message,
      );
    }

    res.json({
      success: true,
      message: "File created",
      path,
      sha: response.data.content?.sha,
    });
  } catch (error) {
    console.error("Create file error:", error.response?.data || error);
    res.status(error.response?.status || 500).json({
      success: false,
      message: error.response?.data?.message || "Failed to create file",
    });
  }
});

module.exports = app;
