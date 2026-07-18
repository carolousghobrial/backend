const express = require("express");
const bp = require("body-parser");
const app = express();
const multer = require("multer");
const path = require("path");

const fs = require("fs");
const supabase = require("../config/config");
const {
  authenticateToken,
  requireDeaconsSchoolWrite,
  requireTeacherAssignedToCourse,
  requireTeacherAssignedToCourseForBatch,
} = require("../middleware/auth");
const {
  classifyCourse,
  decideNextBracket,
  resolveCourse,
} = require("../utils/promotionRules");

// ── Stripe (re-enrollment fee) ────────────────────────────────────────────────
const REENROLLMENT_FEE_CENTS = 2500; // $25.00
const getStripeClient = () => {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return null;
  }
  return require("stripe")(stripeSecretKey);
};
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

// ─── Storage helpers ──────────────────────────────────────────────────────────
function extractStoragePath(publicUrl, bucketName) {
  if (!publicUrl) return null;
  const marker = `/object/public/${bucketName}/`;
  const idx = publicUrl.indexOf(marker);
  return idx === -1
    ? null
    : decodeURIComponent(publicUrl.slice(idx + marker.length));
}

async function deleteStorageFile(bucket, publicUrl) {
  const filePath = extractStoragePath(publicUrl, bucket);
  if (!filePath) return;
  await supabase.supabase.storage
    .from(bucket)
    .remove([filePath])
    .catch((err) =>
      console.warn(
        `Storage cleanup failed [${bucket}/${filePath}]:`,
        err.message,
      ),
    );
}

// ─── Pagination helper ────────────────────────────────────────────────────────
function parsePagination(query, defaultLimit = 50) {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(
    200,
    Math.max(1, parseInt(query.limit) || defaultLimit),
  );
  return { page, limit, from: (page - 1) * limit, to: page * limit - 1 };
}
const { supabase: supabaseTunes } = require("../config/config");

// Routes that handle their own auth (exempted from global mutation middleware)
const AUTH_EXEMPT_ROUTES = new Set([
  "/submitBatchScores",
  "/submitStudentScore",
  "/yearEnd/finalizeAllGrades",
  "/reenrollment/bulk",
  "/newYear/setupCourses",
  "/enrollStudent",
  "/unenrollStudent",
  "/selfEnroll",
  "/registrationRequest",
]);

app.use((req, res, next) => {
  const isMutation = ["POST", "PATCH", "PUT", "DELETE"].includes(req.method);
  if (!isMutation) {
    return next();
  }

  // Check if route starts with any exempt prefix
  const isExempt = [...AUTH_EXEMPT_ROUTES].some(
    (route) => req.path === route || req.path.startsWith(route + "/"),
  );
  if (isExempt) {
    return next();
  }

  return authenticateToken(req, res, () => {
    return requireDeaconsSchoolWrite(req, res, next);
  });
});

// ─── GET: All tune files from 7 Tunes project (for the picker) ───
app.get("/getTuneFiles", async (req, res) => {
  try {
    const search = (req.query.search || "").trim();
    let query = supabaseTunes
      .from("seven_tunes_books")
      .select("file_path, english_title, arabic_title, coptic_title")
      .order("file_path")
      .limit(80);

    if (search) {
      query = query.or(
        `file_path.ilike.%${search}%,` +
          `english_title.ilike.%${search}%,` +
          `arabic_title.ilike.%${search}%`,
      );
    }

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── GET: Hymn folders ───
app.get("/getHymnFolders", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("hymns_folders")
    .select("*")
    .order("name");
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data });
});
// ─── Create folder (with optional parent) ───
app.post("/createHymnFolder", async (req, res) => {
  try {
    const { name, parent_id } = req.body;
    if (!name?.trim())
      return res
        .status(400)
        .json({ success: false, error: "name is required" });

    const { data, error } = await supabase.supabase
      .from("hymns_folders")
      .insert([{ name: name.trim(), parent_id: parent_id || null }])
      .select()
      .single();

    if (error) throw new Error(error.message);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.post(
  "/createHymn",
  upload.fields([
    { name: "hymn_file", maxCount: 1 },
    { name: "hazzat_file", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const {
        hymn_name,
        hymn_recording,
        level_hymn_in,
        hymn_ritual,
        points,
        order_taught,
        folder_id,
        tune_file_path,
      } = req.body;

      if (!hymn_name?.trim()) {
        return res
          .status(400)
          .json({ success: false, error: "hymn_name is required" });
      }

      let finalHymnFileUrl = null;
      let finalHazzatUrl = null;

      const uploadTasks = [];

      if (req.files?.["hymn_file"]?.[0]) {
        uploadTasks.push(
          (async () => {
            const file = req.files["hymn_file"][0];
            const ext = path.extname(file.originalname);
            const filePath = `hymns_files_json/hymn_new_${Date.now()}${ext}`;
            const { error } = await supabase.supabase.storage
              .from("hymns_files_json")
              .upload(filePath, file.buffer, {
                contentType: file.mimetype,
                upsert: true,
              });
            if (!error) {
              const { data } = supabase.supabase.storage
                .from("hymns_files_json")
                .getPublicUrl(filePath);
              finalHymnFileUrl = data.publicUrl;
            }
          })(),
        );
      }

      if (req.files?.["hazzat_file"]?.[0]) {
        uploadTasks.push(
          (async () => {
            const file = req.files["hazzat_file"][0];
            const ext = path.extname(file.originalname);
            const filePath = `hazzat_files/hazzat_new_${Date.now()}${ext}`;
            const { error } = await supabase.supabase.storage
              .from("deacons_school_hymns_files")
              .upload(filePath, file.buffer, {
                contentType: file.mimetype,
                upsert: true,
              });
            if (!error) {
              const { data } = supabase.supabase.storage
                .from("deacons_school_hymns_files")
                .getPublicUrl(filePath);
              finalHazzatUrl = data.publicUrl;
            }
          })(),
        );
      }

      if (uploadTasks.length) await Promise.all(uploadTasks);

      const parsedTunePaths = tune_file_path
        ? Array.isArray(tune_file_path)
          ? tune_file_path
          : [tune_file_path]
        : [];

      const { data, error } = await supabase.supabase
        .from("deacons_school_hymns")
        .insert([
          {
            hymn_name: hymn_name.trim(),
            hymn_recording: hymn_recording || null,
            level_hymn_in: level_hymn_in || null,
            hymn_ritual: hymn_ritual || null,
            hymn_file_location: finalHymnFileUrl,
            hazzat: finalHazzatUrl,
            points: points ? parseInt(points) : 0,
            order_taught: order_taught ? parseInt(order_taught) : 0,
            folder_id: folder_id ? parseInt(folder_id) : null,
            tune_file_path: parsedTunePaths,
          },
        ])
        .select()
        .single();

      if (error) {
        console.error("DB insert error:", error.message);
        return res.status(500).json({ success: false, error: error.message });
      }

      // Sync tune_file_path to seven_tunes_books
      if (parsedTunePaths.length > 0) {
        await syncHymnIdToSevenTunes(parsedTunePaths, [], data.id);
      }

      res.json({ success: true, data, message: "Hymn created successfully" });
    } catch (err) {
      console.error("Error in createHymn:", err.message);
      res.status(500).json({ success: false, error: err.message });
    }
  },
);

// ─── Delete folder ───
app.delete("/deleteHymnFolder/:id", async (req, res) => {
  const { error } = await supabase.supabase
    .from("hymns_folders")
    .delete()
    .eq("id", req.params.id);
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true });
});

// ─── Update getHymnFolders to include parent_id ───
// (already returns * so no change needed — but confirm your select is .select('*'))
// ─── UPDATE: Patch tune_file_path and folder_id on a hymn ───
app.post("/syncAllHymnIdsToSevenTunes", async (req, res) => {
  try {
    // 1. Fetch all hymns that have a tune_file_path
    // AFTER
    const { data: rawHymns, error: hymnsError } = await supabase.supabase
      .from("deacons_school_hymns")
      .select("id, tune_file_path")
      .not("tune_file_path", "is", null);

    const hymns = (rawHymns || []).filter(
      (h) =>
        Array.isArray(h.tune_file_path) &&
        h.tune_file_path.filter(Boolean).length > 0,
    );

    if (hymnsError) throw new Error(hymnsError.message);

    // 2. Group hymn ids by file_path
    // { "agpeya/sixth-hour/kyrie.json": [1, 4, 17], ... }
    const filePathMap = {};
    for (const hymn of hymns) {
      for (const filePath of hymn.tune_file_path || []) {
        if (!filePathMap[filePath]) filePathMap[filePath] = [];
        filePathMap[filePath].push(hymn.id);
      }
    }

    const results = { updated: [], notFound: [], errors: [] };

    // 3. For each unique file_path, find the seven_tunes_books row and set hymn_ids
    for (const [filePath, hymnIds] of Object.entries(filePathMap)) {
      const { data: bookRow, error: fetchError } = await supabaseTunes
        .from("seven_tunes_books")
        .select("id, hymn_ids")
        .eq("file_path", filePath)
        .single();

      if (fetchError || !bookRow) {
        results.notFound.push(filePath);
        continue;
      }

      // Merge with any existing ids already on the row (in case some were set manually)
      const existing = bookRow.hymn_ids || [];
      const merged = [...new Set([...existing, ...hymnIds])];

      const { error: updateError } = await supabaseTunes
        .from("seven_tunes_books")
        .update({ hymn_ids: merged })
        .eq("id", bookRow.id);

      if (updateError) {
        results.errors.push({ filePath, error: updateError.message });
      } else {
        results.updated.push({ filePath, hymn_ids: merged });
      }
    }

    res.json({
      success: true,
      summary: {
        total_hymns: hymns.length,
        unique_files: Object.keys(filePathMap).length,
        updated: results.updated.length,
        not_found_in_seven_tunes: results.notFound.length,
        errors: results.errors.length,
      },
      details: results,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
// ─── GET: All hymns with media status flags (for filtered picker) ───
// Add this alongside your other hymn endpoints

app.get("/getHymnsWithMediaStatus", async (req, res) => {
  try {
    // 1. Fetch all hymns
    const { data: hymns, error: hymnsError } = await supabase.supabase
      .from("deacons_school_hymns")
      .select(
        "id, hymn_name, hymn_ritual, points, order_taught, level_hymn_in, folder_id, tune_file_path",
      )
      .order("order_taught");

    if (hymnsError) throw new Error(hymnsError.message);

    // 2. Fetch all recording hymn_ids (just the ids, no content needed)
    const { data: recordings, error: recError } = await supabase.supabase
      .from("deacons_school_hymn_recordings")
      .select("hymn_id");

    if (recError) throw new Error(recError.message);

    // 3. Fetch all hazzat hymn_ids
    const { data: hazzat, error: hazError } = await supabase.supabase
      .from("deacons_school_hymn_hazzat")
      .select("hymn_id");

    if (hazError) throw new Error(hazError.message);

    // 4. Build sets for O(1) lookup
    const hymnIdsWithRecordings = new Set(recordings.map((r) => r.hymn_id));
    const hymnIdsWithHazzat = new Set(hazzat.map((h) => h.hymn_id));

    // 5. Attach flags to each hymn
    const enriched = hymns.map((hymn) => ({
      ...hymn,
      has_recordings: hymnIdsWithRecordings.has(hymn.id),
      has_hazzat: hymnIdsWithHazzat.has(hymn.id),
      has_tune_file:
        Array.isArray(hymn.tune_file_path) &&
        hymn.tune_file_path.filter(Boolean).length > 0,
    }));

    res.json({ success: true, data: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
app.patch("/updateHymnMeta/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { add_tune_path, remove_tune_path, folder_id, ...coreFields } =
      req.body;

    // ── Tune-path mutations (append or remove one item) ───────────────────────
    if (add_tune_path !== undefined || remove_tune_path !== undefined) {
      // Fetch the current array first
      const { data: current, error: fetchErr } = await supabase.supabase
        .from("deacons_school_hymns")
        .select("tune_file_path")
        .eq("id", id)
        .single();

      if (fetchErr) throw new Error(fetchErr.message);

      const oldPaths = Array.isArray(current.tune_file_path)
        ? current.tune_file_path.filter(Boolean)
        : [];
      let newPaths = [...oldPaths];

      if (add_tune_path && !newPaths.includes(add_tune_path)) {
        newPaths.push(add_tune_path);
      }

      if (remove_tune_path) {
        newPaths = newPaths.filter((p) => p !== remove_tune_path);
      }

      const { data, error } = await supabase.supabase
        .from("deacons_school_hymns")
        .update({ tune_file_path: newPaths })
        .eq("id", id)
        .select()
        .single();

      if (error) throw new Error(error.message);

      // Sync diff to seven_tunes_books
      await syncHymnIdToSevenTunes(newPaths, oldPaths, id);

      // Delete removed tune file from storage (best-effort)
      if (remove_tune_path) {
        await supabase.supabase.storage
          .from("hymns_files_json")
          .remove([remove_tune_path])
          .catch((err) =>
            console.warn("Tune file storage cleanup failed:", err.message),
          );
      }

      return res.json({ success: true, data });
    }

    // ── Other meta fields (folder_id, core auto-save fields) ─────────────────
    const updates = {};
    if (folder_id !== undefined) updates.folder_id = folder_id || null;

    const allowedCore = [
      "hymn_name",
      "hymn_ritual",
      "level_hymn_in",
      "points",
      "order_taught",
    ];
    for (const field of allowedCore) {
      if (coreFields[field] !== undefined) updates[field] = coreFields[field];
    }

    if (Object.keys(updates).length === 0) {
      return res.json({ success: true, data: null });
    }

    const { data, error } = await supabase.supabase
      .from("deacons_school_hymns")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw new Error(error.message);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── RECORDINGS ───────────────────────────────────────────────

app.get("/getHymnRecordings/:hymnId", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("deacons_school_hymn_recordings")
    .select("*")
    .eq("hymn_id", req.params.hymnId)
    .order("created_at", { ascending: false });
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

app.post("/addHymnRecording", async (req, res) => {
  const { hymn_id, title, url, type } = req.body;
  if (!hymn_id || !title || !url)
    return res
      .status(400)
      .json({ success: false, error: "hymn_id, title, url required" });

  const { data, error } = await supabase.supabase
    .from("deacons_school_hymn_recordings")
    .insert([{ hymn_id, title, url, type: type || "youtube" }])
    .select()
    .single();
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

app.put("/updateHymnRecording/:id", async (req, res) => {
  const { title, url, type } = req.body;
  const { data, error } = await supabase.supabase
    .from("deacons_school_hymn_recordings")
    .update({ title, url, type })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

app.delete("/deleteHymnRecording/:id", async (req, res) => {
  const { error } = await supabase.supabase
    .from("deacons_school_hymn_recordings")
    .delete()
    .eq("id", req.params.id);
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true });
});
app.get("/getTuneContent", async (req, res) => {
  try {
    const filePath = (req.query.path || "").trim();
    if (!filePath)
      return res
        .status(400)
        .json({ success: false, error: "path is required" });

    const { data, error } = await supabaseTunes
      .from("seven_tunes_books")
      .select("content") // ← whatever your JSON column is named
      .eq("file_path", filePath)
      .single();
    console.log(data);
    if (error) throw new Error(error.message);
    res.json(data.content);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
// ─── HAZZAT ───────────────────────────────────────────────────
app.get("/getHymnsByFolder/:folderId", async (req, res) => {
  const { folderId } = req.params;
  const { data, error } = await supabase.supabase
    .from("deacons_school_hymns")
    .select("*")
    .eq("folder_id", folderId)
    .order("order_taught");
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

app.get("/getHymnsWithNoFolder", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("deacons_school_hymns")
    .select("*")
    .is("folder_id", null)
    .order("order_taught");
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data });
});
app.get("/getHymnHazzat/:hymnId", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("deacons_school_hymn_hazzat")
    .select("*")
    .eq("hymn_id", req.params.hymnId)
    .order("created_at", { ascending: false });
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

app.post("/addHymnHazzat", upload.single("hazzat_file"), async (req, res) => {
  try {
    const { hymn_id, title, type } = req.body;
    if (!hymn_id || !title)
      return res
        .status(400)
        .json({ success: false, error: "hymn_id and title required" });

    let url = req.body.url || "";

    if (req.file) {
      const ext = path.extname(req.file.originalname);
      const fp = `hazzat_files/hymn_${hymn_id}_${Date.now()}${ext}`;
      const { error: upErr } = await supabase.supabase.storage
        .from("deacons_school_hymns_files")
        .upload(fp, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: true,
        });
      if (upErr) throw new Error(upErr.message);
      const { data: urlData } = supabase.supabase.storage
        .from("deacons_school_hymns_files")
        .getPublicUrl(fp);
      url = urlData.publicUrl;
    }

    if (!url)
      return res
        .status(400)
        .json({ success: false, error: "Provide a file or URL" });

    const { data, error } = await supabase.supabase
      .from("deacons_school_hymn_hazzat")
      .insert([{ hymn_id, title, url, type: type || "pdf" }])
      .select()
      .single();
    if (error) throw new Error(error.message);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete("/deleteHymnHazzat/:id", async (req, res) => {
  const { data: hazzat, error: fetchErr } = await supabase.supabase
    .from("deacons_school_hymn_hazzat")
    .select("url")
    .eq("id", req.params.id)
    .single();

  if (fetchErr)
    return res.status(500).json({ success: false, error: fetchErr.message });

  const { error } = await supabase.supabase
    .from("deacons_school_hymn_hazzat")
    .delete()
    .eq("id", req.params.id);

  if (error)
    return res.status(500).json({ success: false, error: error.message });

  // Clean up storage file (best-effort — DB record already deleted)
  if (hazzat?.url) {
    await deleteStorageFile("deacons_school_hymns_files", hazzat.url);
  }

  res.json({ success: true });
});
const daysOfWeek = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
app.get("/", (req, res) => {
  res.send("Hello World!");
});

app.get("/getEvent/:id", async (req, res) => {
  let { data: deacons_school_hymns, error } = await supabase.supabase
    .from("deacons_school_hymns")
    .select("*")
    .eq("id", req.params.id);
  res.send(deacons_school_hymns);
});
app.get("/", (req, res) => {
  res.send("Hello, Announcment!");
});
app.get("/getHymns", async (req, res) => {
  let { data: deacons_school_hymns, error } = await supabase.supabase
    .from("deacons_school_hymns")
    .select("*");

  res.send(deacons_school_hymns);
});
app.get("/getCourses", async (req, res) => {
  let { data: deacons_school_hymns, error } = await supabase.supabase
    .from("ds_courses")
    .select("*");

  res.send(deacons_school_hymns);
});
app.put(
  "/updateHymn/:id",
  upload.fields([
    { name: "hymn_file", maxCount: 1 },
    { name: "hazzat_file", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { id } = req.params;

      const {
        hymn_name,
        hymn_recording,
        level_hymn_in,
        hymn_file_location,
        hymn_ritual,
        points,
        hazzat,
        order_taught,
        tune_file_path,
        folder_id,
        _old_tune_file_path,
      } = req.body;

      // ── Fetch existing record so we can clean up old storage files ──────────
      const { data: existingHymn } = await supabase.supabase
        .from("deacons_school_hymns")
        .select("hymn_file_location, hazzat")
        .eq("id", id)
        .single();

      // ── Parallel file uploads ─────────────────────────────────────────────
      let finalHymnFileUrl = hymn_file_location || null;
      let finalHazzatUrl = hazzat || null;

      const uploadTasks = [];

      if (req.files?.["hymn_file"]?.[0]) {
        uploadTasks.push(
          (async () => {
            const file = req.files["hymn_file"][0];
            const ext = path.extname(file.originalname);
            const filePath = `hymns_files_json/hymn_${id}${ext}`;
            const { error } = await supabase.supabase.storage
              .from("hymns_files_json")
              .upload(filePath, file.buffer, {
                contentType: file.mimetype,
                upsert: true,
              });
            if (!error) {
              const { data } = supabase.supabase.storage
                .from("hymns_files_json")
                .getPublicUrl(filePath);
              finalHymnFileUrl = data.publicUrl;
              // Delete old file if the extension changed (different storage path)
              const oldPath = extractStoragePath(
                existingHymn?.hymn_file_location,
                "hymns_files_json",
              );
              if (oldPath && oldPath !== filePath) {
                await deleteStorageFile(
                  "hymns_files_json",
                  existingHymn.hymn_file_location,
                );
              }
            } else {
              console.error("Hymn file upload error:", error.message);
            }
          })(),
        );
      }

      if (req.files?.["hazzat_file"]?.[0]) {
        uploadTasks.push(
          (async () => {
            const file = req.files["hazzat_file"][0];
            const ext = path.extname(file.originalname);
            const filePath = `hazzat_files/hazzat_${id}${ext}`;
            const { error } = await supabase.supabase.storage
              .from("deacons_school_hymns_files")
              .upload(filePath, file.buffer, {
                contentType: file.mimetype,
                upsert: true,
              });
            if (!error) {
              const { data } = supabase.supabase.storage
                .from("deacons_school_hymns_files")
                .getPublicUrl(filePath);
              finalHazzatUrl = data.publicUrl;
              // Delete old hazzat file if the extension changed
              const oldPath = extractStoragePath(
                existingHymn?.hazzat,
                "deacons_school_hymns_files",
              );
              if (oldPath && oldPath !== filePath) {
                await deleteStorageFile(
                  "deacons_school_hymns_files",
                  existingHymn.hazzat,
                );
              }
            } else {
              console.error("Hazzat file upload error:", error.message);
            }
          })(),
        );
      }

      if (uploadTasks.length) await Promise.all(uploadTasks);

      // ── DB write ──────────────────────────────────────────────────────────
      const updateData = {
        hymn_name: hymn_name || null,
        hymn_recording: hymn_recording || null,
        level_hymn_in: level_hymn_in || null,
        hymn_ritual: hymn_ritual || null,
        hymn_file_location: finalHymnFileUrl,
        hazzat: finalHazzatUrl,
        points: points ? parseInt(points) : 0,
        order_taught: order_taught ? parseInt(order_taught) : 0,
        folder_id: folder_id ? parseInt(folder_id) : null,
        // Never pass created_at — let Postgres keep the original value
      };

      const { data, error } = await supabase.supabase
        .from("deacons_school_hymns")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (error) {
        console.error("DB update error:", error.message);
        return res
          .status(500)
          .json({ error: "Error updating hymn", details: error.message });
      }

      // ── Sync tune_file_path to seven_tunes_books ──────────────────────────
      if (tune_file_path !== undefined) {
        await syncHymnIdToSevenTunes(
          tune_file_path || null,
          _old_tune_file_path || null,
          parseInt(id),
        );
      }

      res.json({ ok: true, data, message: "Hymn updated successfully" });
    } catch (err) {
      console.error("Error in updateHymn:", err.message);
      res
        .status(500)
        .json({ error: "An error occurred", details: err.message });
    }
  },
);
app.get("/getHymnsByLevel/:level", async (req, res) => {
  const level = req.params.level;
  let { data: data, error } = await supabase.supabase
    .from("deacons_school_hymns")
    .select("*")
    .eq("level_hymn_in", level);
  res.send(data);
});
app.get("/getAllHymns", async (req, res) => {
  const { page, limit, from, to } = parsePagination(req.query, 100);
  const { data, error, count } = await supabase.supabase
    .from("deacons_school_hymns")
    .select("*", { count: "exact" })
    .order("order_taught", { ascending: true })
    .range(from, to);
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.json({
    success: true,
    data,
    pagination: {
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
    },
  });
});
app.get("/getHymn/:id", async (req, res) => {
  const id = req.params.id;
  let { data: data, error } = await supabase.supabase
    .from("deacons_school_hymns")
    .select("*")
    .eq("id", id)
    .single();

  res.send(data);
});
app.get("/getRitualsByLevel/:level", async (req, res) => {
  const level = req.params.level;
  let { data: data, error } = await supabase.supabase
    .from("deacons_school_rituals")
    .select("*")
    .eq("level", level);

  res.send(data);
  //res.ok();
});
app.get("/getCopticByLevel/:level", async (req, res) => {
  const level = req.params.level;
  console.log(level);
  let { data: data, error } = await supabase.supabase
    .from("deacons_school_coptic")
    .select("*")
    .eq("level", level);

  res.send(data);
  //res.ok();
});
app.get("/getAltarResponses", async (req, res) => {
  let { data: deacons_school_hymns, error } = await supabase.supabase
    .from("deacons_school_altar_responses")
    .select("*");

  res.send(deacons_school_hymns);
});
app.get("/getAltarResponsesByLevel/:level", async (req, res) => {
  const level = req.params.level;
  let { data: data, error } = await supabase.supabase
    .from("deacons_school_altar_responses")
    .select("*")
    .eq("level", level);

  res.send(data);
  //res.ok();
});
app.get("/getAltarResponse/:id", async (req, res) => {
  const id = req.params.id;
  let { data: data, error } = await supabase.supabase
    .from("deacons_school_altar_responses")
    .select("*")
    .eq("id", id)
    .single();

  res.send(data);
});
app.get("/getMyCoursesTaught/:id", async (req, res) => {
  const portal_id = req.params.id;
  const { data, error } = await supabase.supabase.rpc(
    "get_ds_teacher_courses_by_portal_id",
    {
      p_user_id: portal_id,
    },
  );
  console.log(data);
  console.log(error);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
app.post("/addCoursesToCalendar", async (req, res) => {
  const levelMap = {
    1: "ds_level_alpha",
    2: "ds_level_beta",
    3: "ds_level_1",
    4: "ds_level_2",
    5: "ds_level_3",
    6: "ds_level_4",
    7: "ds_level_5",
    8: "ds_level_6",
    9: "ds_level_7",
    10: "ds_level_8",
    11: "ds_level_9",
    12: "ds_level_10",
    13: "ds_level_graduates",
    14: "ds_level_graduates",
  };

  try {
    const results = [];

    for (let index = 1; index <= 14; index++) {
      const level = levelMap[index];
      console.log(`Updating index ${index} to ${level}`);

      // Get all courses for this level
      const { data: courses, error: coursesError } = await supabase.supabase
        .from("ds_courses")
        .select("course_id")
        .eq("level", level);

      if (coursesError) {
        console.error(`Error fetching courses for ${level}:`, coursesError);
        results.push({ level, error: coursesError.message });
        continue; // skip this level, move to next
      }

      if (!courses || courses.length === 0) {
        console.warn(`No courses found for ${level}`);
        results.push({ level, message: "No courses found" });
        continue;
      }

      // Extract course_ids into an array
      const courseIds = courses.map((c) => c.course_id);
      console.log(`Course IDs for ${level}:`, courseIds);

      // Update calendar with array of course_ids
      const { data: updateData, error: updateError } = await supabase.supabase
        .from("ds_calendar_week")
        .update({
          courses_id: courseIds, // assumes courses_id column is an array type
        })
        .eq("level", level)
        .select();

      if (updateError) {
        console.error(`Error updating calendar for ${level}:`, updateError);
        results.push({ level, error: updateError.message });
      } else {
        results.push({ level, updated: updateData });
      }
    }

    // Return all results after loop finishes
    return res.json(results);
  } catch (err) {
    console.error("Unexpected error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/getStudentCourses/:id", async (req, res) => {
  const portal_id = req.params.id;
  const { data, error } = await supabase.supabase.rpc(
    "get_ds_student_courses_by_portal_id",
    {
      p_user_id: portal_id,
    },
  );
  console.log(data);
  console.log(error);
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
app.get("/getMemorization", async (req, res) => {
  let { data: deacons_school_hymns, error } = await supabase.supabase
    .from("deacons_school_memorization")
    .select("*");

  res.send(deacons_school_hymns);
});
app.get("/getMemorizationByLevel/:level", async (req, res) => {
  const level = req.params.level;
  let { data: data, error } = await supabase.supabase
    .from("deacons_school_memorization")
    .select()
    .eq("level", level);
  console.log(data);
  res.send(data);
  //res.ok();
});
app.get("/getMemorization/:id", async (req, res) => {
  const id = req.params.id;
  let { data: data, error } = await supabase.supabase
    .from("deacons_school_memorization")
    .select("*")
    .eq("id", id)
    .single();

  console.log(data);
  res.send(data);
});
app.get("/getdeaconsschoolextrasbycourse/:course_id", async (req, res) => {
  const course_id = req.params.course_id;

  try {
    // Step 1: get course level from ds_courses
    const { data: courseData, error: courseError } = await supabase.supabase
      .from("ds_courses")
      .select("level")
      .eq("course_id", course_id)
      .single(); // since course_id is unique

    if (courseError) {
      console.error("Error fetching course level:", courseError);
      return res.status(500).json({ error: courseError.message });
    }

    if (!courseData) {
      return res.status(404).json({ message: "No course found with that ID" });
    }

    const level = courseData.level;

    // Step 2: call your RPC function with the level
    const { data: extrasData, error: extrasError } =
      await supabase.supabase.rpc("get_deacons_school_extras_by_level", {
        level_param: level,
      });

    if (extrasError) {
      console.error("Error fetching extras:", extrasError);
      return res.status(500).json({ error: extrasError.message });
    }

    return res.json(extrasData);
  } catch (err) {
    console.error("Unexpected error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});
// Example using Express.js and PostgreSQL
// Behavior Report Endpoint - Add this to your routes file

// Behavior Report Endpoint - Add this to your routes file

/**
 * GET /getBehaviorReport
 * Query parameters: start_date, end_date, course_id (optional)
 * Returns behavior records with student and session information
 */
app.get("/getBehaviorReport", async (req, res) => {
  try {
    const { start_date, end_date, course_id } = req.query;

    // Validate required parameters
    if (!start_date || !end_date) {
      return res.status(400).json({
        success: false,
        error: "start_date and end_date are required",
      });
    }

    console.log("Fetching behavior report:", {
      start_date,
      end_date,
      course_id,
    });

    // Build the query
    let query = supabase.supabase
      .from("ds_attendance")
      .select(
        `
        *,
        users:student_id (
          id,
          portal_id,
          first_name,
          last_name,
          email
        ),
        ds_class_sessions:session_id (
          session_id,
          course_id,
          session_date,
          topic,
          notes,
          ds_courses:course_id (
            course_id,
            class_name
          )
        )
      `,
      )
      .eq("present", true) // Only get records where student was present
      .gte("ds_class_sessions.session_date", start_date)
      .lte("ds_class_sessions.session_date", end_date);

    // Add course filter if provided
    if (course_id) {
      query = query.eq("ds_class_sessions.course_id", course_id);
    }

    // Order by date descending, then by student name
    query = query.order("ds_class_sessions(session_date)", {
      ascending: false,
    });

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching behavior records:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }

    console.log(`Found ${data?.length || 0} behavior records`);

    // Transform data to match expected format
    const behaviorRecords = data.map((record) => ({
      attendance_id: record.attendance_id,
      student_id: record.student_id,
      session_id: record.session_id,
      present: record.present,
      good_behavior: record.good_behavior,
      notes: record.notes,
      recorded_by: record.recorded_by,
      recorded_at: record.recorded_at,
      updated_at: record.updated_at,
      course_id: record.ds_class_sessions?.course_id || null,
      session_date: record.ds_class_sessions?.session_date || null,
      session_topic: record.ds_class_sessions?.topic || null,
      session_notes: record.ds_class_sessions?.notes || null,
      course_name: record.ds_class_sessions?.ds_courses?.class_name || null,
      student: record.users
        ? {
            id: record.users.id,
            portal_id: record.users.portal_id,
            first_name: record.users.first_name,
            last_name: record.users.last_name,
            email: record.users.email,
            profile_pic: record.users.profile_pic,
          }
        : null,
    }));

    res.json({
      success: true,
      data: behaviorRecords,
      count: behaviorRecords.length,
      filters: {
        start_date,
        end_date,
        course_id: course_id || "all",
      },
    });
  } catch (error) {
    console.error("Get behavior report error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: error.message,
    });
  }
});

/**
 * Alternative version with better filtering using join conditions
 * This version might work better if the above filtering doesn't work as expected
 */
app.get("/getBehaviorReportAlt", async (req, res) => {
  try {
    const { start_date, end_date, course_id } = req.query;

    if (!start_date || !end_date) {
      return res.status(400).json({
        success: false,
        error: "start_date and end_date are required",
      });
    }

    console.log("Fetching behavior report (alt):", {
      start_date,
      end_date,
      course_id,
    });

    // First, get sessions in the date range
    let sessionQuery = supabase.supabase
      .from("ds_class_sessions")
      .select("session_id, course_id, session_date, topic, notes")
      .gte("session_date", start_date)
      .lte("session_date", end_date);

    if (course_id) {
      sessionQuery = sessionQuery.eq("course_id", course_id);
    }

    const { data: sessions, error: sessionError } = await sessionQuery;

    if (sessionError) {
      console.error("Error fetching sessions:", sessionError);
      return res.status(500).json({
        success: false,
        error: sessionError.message,
      });
    }

    if (!sessions || sessions.length === 0) {
      return res.json({
        success: true,
        data: [],
        count: 0,
        filters: { start_date, end_date, course_id: course_id || "all" },
      });
    }

    // Get session IDs
    const sessionIds = sessions.map((s) => s.session_id);

    // Now get attendance records for these sessions
    const { data: attendanceData, error: attendanceError } =
      await supabase.supabase
        .from("ds_attendance")
        .select(
          `
        *,
        users:student_id (
          id,
          portal_id,
          first_name,
          last_name,
          email
        )
      `,
        )
        .in("session_id", sessionIds)
        .eq("present", true)
        .order("created_at", { ascending: false });

    if (attendanceError) {
      console.error("Error fetching attendance records:", attendanceError);
      return res.status(500).json({
        success: false,
        error: attendanceError.message,
      });
    }

    // Get course information
    const courseIds = [...new Set(sessions.map((s) => s.course_id))];
    const { data: courses, error: courseError } = await supabase.supabase
      .from("ds_courses")
      .select("course_id, class_name")
      .in("course_id", courseIds);

    if (courseError) {
      console.error("Error fetching courses:", courseError);
    }

    // Create lookup maps
    const sessionMap = new Map(sessions.map((s) => [s.session_id, s]));
    const courseMap = new Map((courses || []).map((c) => [c.course_id, c]));

    // Transform and combine data
    const behaviorRecords = attendanceData.map((record) => {
      const session = sessionMap.get(record.session_id);
      const course = session ? courseMap.get(session.course_id) : null;

      return {
        attendance_id: record.attendance_id,
        student_id: record.student_id,
        session_id: record.session_id,
        present: record.present,
        good_behavior: record.good_behavior,
        notes: record.notes,
        recorded_by: record.recorded_by,
        recorded_at: record.recorded_at,
        updated_at: record.updated_at,
        course_id: session?.course_id || null,
        session_date: session?.session_date || null,
        session_topic: session?.topic || null,
        session_notes: session?.notes || null,
        course_name: course?.class_name || null,
        student: record.users
          ? {
              id: record.users.id,
              portal_id: record.users.portal_id,
              first_name: record.users.first_name,
              last_name: record.users.last_name,
              email: record.users.email,
            }
          : null,
      };
    });

    // Sort by session date (newest first), then by student name
    behaviorRecords.sort((a, b) => {
      const dateCompare = new Date(b.session_date) - new Date(a.session_date);
      if (dateCompare !== 0) return dateCompare;

      const aName = `${a.student?.last_name || ""} ${
        a.student?.first_name || ""
      }`;
      const bName = `${b.student?.last_name || ""} ${
        b.student?.first_name || ""
      }`;
      return aName.localeCompare(bName);
    });

    console.log(`Found ${behaviorRecords.length} behavior records`);

    res.json({
      success: true,
      data: behaviorRecords,
      count: behaviorRecords.length,
      filters: {
        start_date,
        end_date,
        course_id: course_id || "all",
      },
    });
  } catch (error) {
    console.error("Get behavior report error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      message: error.message,
    });
  }
});

/**
 * GET /getBehaviorReportByCourse/:course_id
 * Get all behavior records for a specific course (no date filter)
 */
app.get("/getBehaviorRecordByCourse/:course_id", async (req, res) => {
  try {
    const { course_id } = req.params;

    if (!course_id) {
      return res.status(400).json({
        success: false,
        error: "course_id ID is required",
      });
    }

    const { data, error } = await supabase.supabase
      .from("ds_attendance")
      .select(
        `
        *,
        users:student_id (
          id,
          first_name,
          last_name,
          email
        ),
        ds_class_sessions:session_id (
          session_id,
          course_id,
          session_date,
          topic
        )
      `,
      )
      .eq("course_id", course_id)
      .order("users(first_name)", { ascending: true });
    console.log(data);
    if (error) {
      console.error("Error fetching attendance records:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }

    // Transform data to match AttendanceRecord class
    const attendanceRecords = data.map((record) => ({
      student_id: record.student_id,
      session_id: record.session_id,
      present: record.present,
      good_behavior: record.good_behavior,
      notes: record.notes,
      recorded_by: record.recorded_by,
      recorded_at: record.recorded_at,
      updated_at: record.updated_at,
      student: record.users
        ? {
            id: record.users.id,
            first_name: record.users.first_name,
            last_name: record.users.last_name,
            email: record.users.email,
          }
        : null,
      session: record.ds_class_sessions
        ? {
            session_id: record.ds_class_sessions.session_id,
            course_id: record.ds_class_sessions.course_id,
            session_date: record.ds_class_sessions.session_date,
            topic: record.ds_class_sessions.topic,
          }
        : null,
    }));

    res.send(attendanceRecords);
  } catch (error) {
    console.error("Get attendance by session error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * GET /getStudentBehaviorHistory/:student_id
 * Get behavior history for a specific student
 */
app.get("/getStudentBehaviorHistory/:student_id", async (req, res) => {
  try {
    const { student_id } = req.params;
    const { start_date, end_date, course_id } = req.query;

    if (!student_id) {
      return res.status(400).json({
        success: false,
        error: "student_id is required",
      });
    }

    console.log("Fetching behavior history for student:", student_id);

    let query = supabase.supabase
      .from("ds_attendance")
      .select(
        `
        *,
        ds_class_sessions:session_id (
          session_id,
          course_id,
          session_date,
          topic,
          ds_courses:course_id (
            course_id,
            class_name
          )
        )
      `,
      )
      .eq("student_id", student_id)
      .eq("present", true);

    if (start_date && end_date) {
      query = query
        .gte("ds_class_sessions.session_date", start_date)
        .lte("ds_class_sessions.session_date", end_date);
    }

    if (course_id) {
      query = query.eq("ds_class_sessions.course_id", course_id);
    }

    query = query.order("ds_class_sessions(session_date)", {
      ascending: false,
    });

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching student behavior history:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }

    const behaviorHistory = data.map((record) => ({
      attendance_id: record.attendance_id,
      session_id: record.session_id,
      good_behavior: record.good_behavior,
      notes: record.notes,
      session_date: record.ds_class_sessions?.session_date || null,
      session_topic: record.ds_class_sessions?.topic || null,
      course_id: record.ds_class_sessions?.course_id || null,
      course_name: record.ds_class_sessions?.ds_courses?.class_name || null,
      recorded_at: record.recorded_at,
    }));

    // Calculate statistics
    const totalRecords = behaviorHistory.length;
    const goodBehaviorCount = behaviorHistory.filter(
      (r) => r.good_behavior === true,
    ).length;
    const badBehaviorCount = behaviorHistory.filter(
      (r) => r.good_behavior === false,
    ).length;
    const goodPercentage =
      totalRecords > 0
        ? Math.round((goodBehaviorCount / totalRecords) * 100)
        : 0;

    res.json({
      success: true,
      data: {
        student_id,
        records: behaviorHistory,
        statistics: {
          total_records: totalRecords,
          good_behavior: goodBehaviorCount,
          bad_behavior: badBehaviorCount,
          good_percentage: goodPercentage,
        },
      },
      count: totalRecords,
    });
  } catch (error) {
    console.error("Get student behavior history error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});
app.post("/addDSCalendarForLevel/:level", async (req, res) => {
  try {
    const level = req.params.level;
    const { hymn_id, calendar_day, week_num, others_id, others_tablename } =
      req.body;

    console.log("Received data:", {
      level,
      hymn_id,
      calendar_day,
      week_num,
      others_id,
      others_tablename,
    });

    if (!level || !calendar_day || !week_num) {
      return res.status(400).json({
        success: false,
        message: "Level, calendar_day, and week_num are required",
      });
    }

    const calendarRow = {
      hymn_id: hymn_id || null,
      calendar_day: calendar_day,
      week_num: parseInt(week_num, 10),
      others_id: others_id || null,
      others_tablename: others_tablename || null,
      level: level,
    };

    // Try delete first, then insert (simple upsert alternative)
    const { data, error } = await supabase.supabase
      .from("ds_calendar_week")
      .upsert(
        [calendarRow],
        { onConflict: ["calendar_day", "level"] }, // Ensures uniqueness
      )
      .select();

    if (error) {
      console.error("Database error:", error);
      return res.status(500).json({
        success: false,
        message: `Database error: ${error.message}`,
        details: error,
      });
    }

    console.log("Successfully saved:", data);

    res.json({
      success: true,
      message: "Calendar updated successfully",
      data: data,
    });
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});
app.post("/saveTeacherAssignments", async (req, res) => {
  try {
    const assignmentData = req.body;

    // Validate required fields
    if (!assignmentData.calendar_id || !assignmentData.course_id) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields: calendar_id and course_id",
      });
    }

    const { data, error } = await supabase.supabase
      .from("ds_calendar_teacher_assignments")
      .upsert(
        assignmentData, // Don't wrap in another object
        {
          onConflict: "calendar_id,course_id",
          ignoreDuplicates: false,
        },
      )
      .select();

    if (error) {
      console.error("Supabase error:", error);
      return res.status(400).json({
        success: false,
        message: "Failed to save assignment",
        error: error.message,
      });
    }

    return res.json({
      success: true,
      message: "Assignment saved successfully",
      data: data,
    });
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
});
app.post("/addDSTeacher", async (req, res) => {
  try {
    const { teacher_id, course_id, role } = req.body;

    // Validate required fields
    if (!teacher_id || !course_id) {
      return res.status(400).json({
        error: "teacher_id and course_id are required",
      });
    }

    // Check if teacher is already assigned to this course
    const { data: existing, error: checkError } = await supabase.supabase
      .from("ds_course_teachers")
      .select("*")
      .eq("teacher_id", teacher_id)
      .eq("course_id", course_id);

    if (checkError) {
      console.error("Error checking existing assignment:", checkError);
      return res.status(500).json({ error: checkError.message });
    }
    console.log(existing);
    if (existing && existing.length > 0) {
      // Teacher already assigned, update their role and make active
      const { data, error } = await supabase.supabase
        .from("ds_course_teachers")
        .update({
          role: role,
          is_active: true,
          assigned_date: new Date().toISOString().split("T")[0],
        })
        .eq("teacher_id", teacher_id)
        .eq("course_id", course_id)
        .select();

      if (error) {
        console.error("Supabase update error:", error);
        return res.status(500).json({ error: error.message });
      }

      return res.json({
        message: "Teacher assignment updated successfully",
        data: data,
      });
    } else {
      // New assignment
      const body = {
        teacher_id: teacher_id,
        course_id: course_id,
        role: role,
        assigned_date: new Date().toISOString().split("T")[0],
        is_active: true,
      };

      console.log("Inserting teacher assignment:", body);

      const { data, error } = await supabase.supabase
        .from("ds_course_teachers")
        .insert([body])
        .select();

      if (error) {
        console.error("Supabase insert error:", error);
        return res.status(500).json({ error: error.message });
      }

      return res.json({
        message: "Teacher assigned successfully",
        data: data,
      });
    }
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * Get students enrolled in a specific course
 * GET /getStudentsByCourse/:courseId
 */
/**
 * Get students enrolled in a specific course
 * GET /getStudentsByCourse/:courseId
 */
app.get("/getStudentsByCourse/:courseId", async (req, res) => {
  try {
    const { courseId } = req.params;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        error: "Course ID is required",
      });
    }

    const { page, limit, from, to } = parsePagination(req.query, 100);

    const { data, error, count } = await supabase.supabase
      .from("ds_student_enrollment")
      .select(
        `course_id,
        is_active,
        role,
        profiles:student_id (
          portal_id,
          first_name,
          last_name,
          email,
          cellphone,
          grade_level,
          gender
        )`,
        { count: "exact" },
      )
      .eq("course_id", courseId)
      .eq("is_active", true)
      .order("profiles(first_name)", { ascending: true })
      .range(from, to);

    if (error) {
      console.error("Error fetching students:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }

    // Fetch profile images for each student
    const studentsWithImages = await Promise.all(
      data.map(async (enrollment) => {
        let profileImageUrl = null;

        try {
          // Using built-in fetch (Node.js 18+)
          const imageResponse = await fetch(
            `https://api.suscopts.org/image/${enrollment.profiles.portal_id}`,
          );

          if (imageResponse.ok) {
            // Convert to base64 or get the blob URL
            const imageBuffer = await imageResponse.arrayBuffer();
            const base64Image = Buffer.from(imageBuffer).toString("base64");
            profileImageUrl = `data:${imageResponse.headers.get(
              "content-type",
            )};base64,${base64Image}`;
          }
        } catch (imageError) {
          console.warn(
            `Failed to fetch image for portal_id ${enrollment.profiles.portal_id}:`,
            imageError.message,
          );
          // Continue without image - don't fail the entire request
        }

        return {
          portal_id: enrollment.profiles.portal_id,
          first_name: enrollment.profiles.first_name || "",
          last_name: enrollment.profiles.last_name || "",
          email: enrollment.profiles.email,
          cellphone: enrollment.profiles.cellphone,
          enrollment_id: enrollment.enrollment_id,
          is_active: enrollment.is_active,
          profile_pic: profileImageUrl,
          grade_level: enrollment.profiles.grade_level || null,
          gender: enrollment.profiles.gender || null,
        };
      }),
    );

    res.json({
      success: true,
      data: studentsWithImages,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    console.error("Get students by course error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});
app.get("/getTeachersByCourse/:courseId", async (req, res) => {
  try {
    const { courseId } = req.params;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        error: "Course ID is required",
      });
    }

    const { data, error } = await supabase.supabase
      .from("ds_course_teachers")
      .select(
        `course_id,
        is_active,
        role,
        profiles:teacher_id (
          portal_id,
          first_name,
          last_name,
          email,
          cellphone
        )`,
      )
      .eq("course_id", courseId)
      .eq("is_active", true)
      .order("profiles(first_name)", { ascending: true });

    if (error) {
      console.error("Error fetching students:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }

    // Fetch profile images for each student
    const studentsWithImages = await Promise.all(
      data.map(async (enrollment) => {
        let profileImageUrl = null;

        try {
          // Using built-in fetch (Node.js 18+)
          const imageResponse = await fetch(
            `https://api.suscopts.org/image/${enrollment.profiles.portal_id}`,
          );

          if (imageResponse.ok) {
            // Convert to base64 or get the blob URL
            const imageBuffer = await imageResponse.arrayBuffer();
            const base64Image = Buffer.from(imageBuffer).toString("base64");
            profileImageUrl = `data:${imageResponse.headers.get(
              "content-type",
            )};base64,${base64Image}`;
          }
        } catch (imageError) {
          console.warn(
            `Failed to fetch image for portal_id ${enrollment.profiles.portal_id}:`,
            imageError.message,
          );
          // Continue without image - don't fail the entire request
        }

        return {
          portal_id: enrollment.profiles.portal_id,
          first_name: enrollment.profiles.first_name || "",
          last_name: enrollment.profiles.last_name || "",
          email: enrollment.profiles.email,
          cellphone: enrollment.profiles.cellphone,
          enrollment_id: enrollment.enrollment_id,
          is_active: enrollment.is_active,
          profile_pic: profileImageUrl,
        };
      }),
    );

    res.json({
      success: true,
      data: studentsWithImages,
      count: studentsWithImages.length,
    });
  } catch (error) {
    console.error("Get students by course error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

// Alternative implementation using axios (if you prefer)
// First install: npm install axios

const axios = require("axios");

app.get("/getStudentsByCourse/:courseId", async (req, res) => {
  try {
    const { courseId } = req.params;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        error: "Course ID is required",
      });
    }

    const { data, error } = await supabase.supabase
      .from("ds_student_enrollment")
      .select(
        `course_id,
        is_active,
        role,
        profiles:student_id (
          portal_id,
          first_name,
          last_name,
          email,
          cellphone,
          grade_level,
          gender
        )`,
      )
      .eq("course_id", courseId)
      .eq("is_active", true)
      .order("profiles(first_name)", { ascending: true });

    if (error) {
      console.error("Error fetching students:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }

    // Fetch profile images for each student using axios
    const studentsWithImages = await Promise.all(
      data.map(async (enrollment) => {
        let profileImageUrl = null;

        try {
          const imageResponse = await axios.get(
            `https://api.suscopts.org/image/${enrollment.profiles.portal_id}`,
            { responseType: "arraybuffer" },
          );

          const base64Image = Buffer.from(imageResponse.data).toString(
            "base64",
          );
          const contentType =
            imageResponse.headers["content-type"] || "image/jpeg";
          profileImageUrl = `data:${contentType};base64,${base64Image}`;
        } catch (imageError) {
          console.warn(
            `Failed to fetch image for portal_id ${enrollment.profiles.portal_id}:`,
            imageError.message,
          );
        }

        return {
          portal_id: enrollment.profiles.portal_id,
          first_name: enrollment.profiles.first_name || "",
          last_name: enrollment.profiles.last_name || "",
          email: enrollment.profiles.email,
          cellphone: enrollment.profiles.cellphone,
          enrollment_id: enrollment.enrollment_id,
          is_active: enrollment.is_active,
          profile_pic: profileImageUrl,
          grade_level: enrollment.profiles.grade_level || null,
          gender: enrollment.profiles.gender || null,
        };
      }),
    );

    res.json({
      success: true,
      data: studentsWithImages,
      count: studentsWithImages.length,
    });
  } catch (error) {
    console.error("Get students by course error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * Get class session for specific course and date
 * GET /getClassSession/:courseId/:date
 */
app.get("/getClassSession/:courseId/:date", async (req, res) => {
  try {
    const { courseId, date } = req.params;

    if (!courseId || !date) {
      return res.status(400).json({
        success: false,
        error: "Course ID and date are required",
      });
    }

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({
        success: false,
        error: "Invalid date format. Use YYYY-MM-DD",
      });
    }

    const { data, error } = await supabase.supabase
      .from("ds_class_sessions")
      .select("*")
      .eq("course_id", courseId)
      .eq("session_date", date)
      .single();
    console.log(data);
    if (error && error.code !== "PGRST116") {
      console.error("Error fetching class session:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
    res.send(data);

    // PGRST116 means no rows found, which is normal for new sessions
  } catch (error) {
    console.error("Get class session error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});
app.get("/getTeacherAssignments/:course_id/:calendar_id", async (req, res) => {
  try {
    const { course_id, calendar_id } = req.params;
    console.log(course_id);
    console.log(calendar_id);
    if (!course_id || !calendar_id) {
      return res.status(400).json({
        success: false,
        error: "Course ID and date are required",
      });
    }

    const { data, error } = await supabase.supabase
      .from("ds_calendar_teacher_assignments")
      .select("*")
      .eq("course_id", course_id)
      .eq("calendar_id", calendar_id)
      .single();
    console.log(data);
    if (error && error.code !== "PGRST116") {
      console.error("Error fetching class session:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
    res.send(data);

    // PGRST116 means no rows found, which is normal for new sessions
  } catch (error) {
    console.error("Get class session error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * Get attendance records for a specific session
 * GET /getAttendanceBySession/:sessionId
 */
app.get("/getAttendanceBySession/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: "Session ID is required",
      });
    }

    const { data, error } = await supabase.supabase
      .from("ds_attendance")
      .select(
        `
        *,
        users:student_id (
          id,
          first_name,
          last_name,
          email
        ),
        ds_class_sessions:session_id (
          session_id,
          course_id,
          session_date,
          topic
        )
      `,
      )
      .eq("session_id", sessionId)
      .order("users(first_name)", { ascending: true });
    console.log(data);
    if (error) {
      console.error("Error fetching attendance records:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }

    // Transform data to match AttendanceRecord class
    const attendanceRecords = data.map((record) => ({
      student_id: record.student_id,
      session_id: record.session_id,
      present: record.present,
      good_behavior: record.good_behavior,
      notes: record.notes,
      recorded_by: record.recorded_by,
      recorded_at: record.recorded_at,
      updated_at: record.updated_at,
      student: record.users
        ? {
            id: record.users.id,
            first_name: record.users.first_name,
            last_name: record.users.last_name,
            email: record.users.email,
          }
        : null,
      session: record.ds_class_sessions
        ? {
            session_id: record.ds_class_sessions.session_id,
            course_id: record.ds_class_sessions.course_id,
            session_date: record.ds_class_sessions.session_date,
            topic: record.ds_class_sessions.topic,
          }
        : null,
    }));

    res.json({
      success: true,
      data: attendanceRecords,
      count: attendanceRecords.length,
    });
  } catch (error) {
    console.error("Get attendance by session error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});
app.get("/getAttendanceRecordByCourse/:course_id", async (req, res) => {
  try {
    const { course_id } = req.params;

    if (!course_id) {
      return res.status(400).json({
        success: false,
        error: "course_id ID is required",
      });
    }

    const { page, limit, from, to } = parsePagination(req.query);

    const { data, error, count } = await supabase.supabase
      .from("ds_attendance")
      .select(
        `
        *,
        users:student_id (
          id,
          first_name,
          last_name,
          email
        ),
        ds_class_sessions:session_id (
          session_id,
          course_id,
          session_date,
          topic
        )
      `,
        { count: "exact" },
      )
      .eq("course_id", course_id)
      .order("users(first_name)", { ascending: true })
      .range(from, to);

    if (error) {
      console.error("Error fetching attendance records:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }

    // Transform data to match AttendanceRecord class
    const attendanceRecords = data.map((record) => ({
      student_id: record.student_id,
      session_id: record.session_id,
      present: record.present,
      good_behavior: record.good_behavior,
      notes: record.notes,
      recorded_by: record.recorded_by,
      recorded_at: record.recorded_at,
      updated_at: record.updated_at,
      student: record.users
        ? {
            id: record.users.id,
            first_name: record.users.first_name,
            last_name: record.users.last_name,
            email: record.users.email,
          }
        : null,
      session: record.ds_class_sessions
        ? {
            session_id: record.ds_class_sessions.session_id,
            course_id: record.ds_class_sessions.course_id,
            session_date: record.ds_class_sessions.session_date,
            topic: record.ds_class_sessions.topic,
          }
        : null,
    }));

    res.json({
      success: true,
      data: attendanceRecords,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (error) {
    console.error("Get attendance by session error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});
/**
 * Create new attendance session with records
 * POST /createAttendance
 */
app.post(
  "/createAttendance",
  requireTeacherAssignedToCourse,
  async (req, res) => {
    try {
      const {
        course_id,
        session_date,
        topic,
        notes,
        recorded_by,
        attendance_records,
      } = req.body;

      // Validation
      if (!course_id || !session_date || !Array.isArray(attendance_records)) {
        return res.status(400).json({
          success: false,
          error: "Course ID, session date, and attendance records are required",
        });
      }

      if (attendance_records.length === 0) {
        return res.status(400).json({
          success: false,
          error: "At least one attendance record is required",
        });
      }

      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(session_date)) {
        return res.status(400).json({
          success: false,
          error: "Invalid date format. Use YYYY-MM-DD",
        });
      }

      // First, create the class session
      const sessionBody = {
        course_id: course_id,
        session_date: session_date,
        topic: topic || null,
        notes: notes || null,
        recorded_by: recorded_by,
        created_at: new Date().toISOString(),
      };

      console.log("Creating session with data:", sessionBody);

      const { data: sessionData, error: sessionError } = await supabase.supabase
        .from("ds_class_sessions")
        .insert([sessionBody])
        .select()
        .single();

      if (sessionError) {
        console.error("Error creating session:", sessionError);
        return res.status(500).json({
          success: false,
          error: "Failed to create class session",
          details: sessionError.message,
        });
      }

      console.log("Session created:", sessionData);

      // Validate and prepare attendance records
      const validatedRecords = [];
      for (const record of attendance_records) {
        if (!record.student_id || record.present === undefined) {
          return res.status(400).json({
            success: false,
            error:
              "Each attendance record must have student_id and present status",
          });
        }
        console.log(course_id);
        validatedRecords.push({
          course_id: course_id,
          student_id: record.student_id,
          session_id: sessionData.session_id, // Use the created session ID
          good_behavior: record.good_behavior, // Use 'present' field, not 'status'
          present: record.present, // Use 'present' field, not 'status'
          notes: record.notes || null,
          recorded_by: recorded_by,
          recorded_at: new Date().toISOString(),
        });
      }

      console.log("Creating attendance records:", validatedRecords);

      // Insert attendance records
      const { data: attendanceData, error: attendanceError } =
        await supabase.supabase
          .from("ds_attendance")
          .insert(validatedRecords)
          .select();

      if (attendanceError) {
        console.error("Error creating attendance records:", attendanceError);

        // Cleanup: delete the session if attendance insertion failed
        await supabase.supabase
          .from("ds_class_sessions")
          .delete()
          .eq("session_id", sessionData.session_id);

        return res.status(500).json({
          success: false,
          error: "Failed to create attendance records",
          details: attendanceError.message,
        });
      }

      res.json({
        success: true,
        message: "Attendance created successfully",
        data: {
          session: sessionData,
          attendance_records: attendanceData,
          total_records: attendanceData.length,
        },
      });
    } catch (error) {
      console.error("Create attendance error:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  },
);
app.post(
  "/createTeacherAttendance",
  requireTeacherAssignedToCourse,
  async (req, res) => {
    try {
      const {
        course_id,
        session_date,
        topic,
        notes,
        recorded_by,
        attendance_records,
      } = req.body;

      // Validation
      if (!course_id || !session_date || !Array.isArray(attendance_records)) {
        return res.status(400).json({
          success: false,
          error: "Course ID, session date, and attendance records are required",
        });
      }

      if (attendance_records.length === 0) {
        return res.status(400).json({
          success: false,
          error: "At least one attendance record is required",
        });
      }

      // Validate date format
      if (!/^\d{4}-\d{2}-\d{2}$/.test(session_date)) {
        return res.status(400).json({
          success: false,
          error: "Invalid date format. Use YYYY-MM-DD",
        });
      }

      // First, create the class session
      const sessionBody = {
        course_id: course_id,
        session_date: session_date,
        topic: topic || null,
        notes: notes || null,
        recorded_by: recorded_by,
        created_at: new Date().toISOString(),
      };

      console.log("Creating session with data:", sessionBody);

      const { data: sessionData, error: sessionError } = await supabase.supabase
        .from("ds_class_sessions")
        .insert([sessionBody])
        .select()
        .single();

      if (sessionError) {
        console.error("Error creating session:", sessionError);
        return res.status(500).json({
          success: false,
          error: "Failed to create class session",
          details: sessionError.message,
        });
      }

      console.log("Session created:", sessionData);

      // Validate and prepare attendance records
      const validatedRecords = [];
      for (const record of attendance_records) {
        if (!record.student_id || record.present === undefined) {
          return res.status(400).json({
            success: false,
            error:
              "Each attendance record must have student_id and present status",
          });
        }
        console.log(course_id);
        validatedRecords.push({
          course_id: course_id,
          teacher_id: record.teacher_id,
          session_id: sessionData.session_id, // Use the created session ID
          good_behavior: record.good_behavior, // Use 'present' field, not 'status'
          present: record.present, // Use 'present' field, not 'status'
          notes: record.notes || null,
          recorded_by: recorded_by,
          recorded_at: new Date().toISOString(),
        });
      }

      console.log("Creating attendance records:", validatedRecords);

      // Insert attendance records
      const { data: attendanceData, error: attendanceError } =
        await supabase.supabase
          .from("ds_teacher_attendance")
          .insert(validatedRecords)
          .select();

      if (attendanceError) {
        console.error("Error creating attendance records:", attendanceError);

        // Cleanup: delete the session if attendance insertion failed
        await supabase.supabase
          .from("ds_class_sessions")
          .delete()
          .eq("session_id", sessionData.session_id);

        return res.status(500).json({
          success: false,
          error: "Failed to create attendance records",
          details: attendanceError.message,
        });
      }

      res.json({
        success: true,
        message: "Attendance created successfully",
        data: {
          session: sessionData,
          attendance_records: attendanceData,
          total_records: attendanceData.length,
        },
      });
    } catch (error) {
      console.error("Create attendance error:", error);
      res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  },
);

/**
 * Update existing attendance session and records
 * PUT /updateAttendance/:sessionId
 */
app.put(
  "/updateAttendance/:sessionId",
  requireTeacherAssignedToCourse,
  async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { topic, notes, recorded_by, attendance_records, course_id } =
        req.body;

      if (!sessionId) {
        return res
          .status(400)
          .json({ success: false, error: "Session ID is required" });
      }

      if (!Array.isArray(attendance_records)) {
        return res.status(400).json({
          success: false,
          error: "Attendance records array is required",
        });
      }

      // Update session info
      const { error: sessionError } = await supabase.supabase
        .from("ds_class_sessions")
        .update({
          topic: topic || null,
          notes: notes || null,
          updated_at: new Date().toISOString(),
        })
        .eq("session_id", sessionId);

      if (sessionError) {
        console.error("Error updating session:", sessionError);
        return res
          .status(500)
          .json({ success: false, error: "Failed to update session" });
      }

      // Validate and prepare attendance records
      const validatedRecords = attendance_records.map((record) => ({
        course_id,
        student_id: record.student_id,
        session_id: sessionId,
        present: record.present,
        good_behavior: record.good_behavior,
        notes: record.notes || null,
        recorded_by,
        recorded_at: new Date().toISOString(),
      }));
      console.log(validatedRecords);
      // Insert/update attendance
      // First, delete existing attendance for this session
      await supabase.supabase
        .from("ds_attendance")
        .delete()
        .eq("session_id", sessionId);

      // Then insert the new records
      const { data: attendanceData, error: attendanceError } =
        await supabase.supabase
          .from("ds_attendance")
          .insert(validatedRecords)
          .select();

      console.log("Attendance upsert result:", {
        attendanceData,
        attendanceError,
      });

      if (attendanceError) {
        return res.status(500).json({
          success: false,
          error: "Failed to update attendance records",
        });
      }

      res.json({
        success: true,
        message: "Attendance updated successfully",
        data: {
          attendance_records: attendanceData,
          total_records: attendanceData?.length || 0,
        },
      });
    } catch (error) {
      console.error("Update attendance error:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);
app.put(
  "/updateTeacherAttendance/:sessionId",
  requireTeacherAssignedToCourse,
  async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { topic, notes, recorded_by, attendance_records, course_id } =
        req.body;

      if (!sessionId) {
        return res
          .status(400)
          .json({ success: false, error: "Session ID is required" });
      }

      if (!Array.isArray(attendance_records)) {
        return res.status(400).json({
          success: false,
          error: "Attendance records array is required",
        });
      }

      // Update session info
      const { error: sessionError } = await supabase.supabase
        .from("ds_class_sessions")
        .update({
          topic: topic || null,
          notes: notes || null,
          updated_at: new Date().toISOString(),
        })
        .eq("session_id", sessionId);

      if (sessionError) {
        console.error("Error updating session:", sessionError);
        return res
          .status(500)
          .json({ success: false, error: "Failed to update session" });
      }

      // Validate and prepare attendance records
      const validatedRecords = attendance_records.map((record) => ({
        course_id,
        teacher_id: record.teacher_id,
        session_id: sessionId,
        present: record.present,
        good_behavior: record.good_behavior,
        notes: record.notes || null,
        recorded_by,
        recorded_at: new Date().toISOString(),
      }));
      console.log(validatedRecords);
      // Insert/update attendance
      // First, delete existing attendance for this session
      await supabase.supabase
        .from("ds_teacher_attendance")
        .delete()
        .eq("session_id", sessionId);

      // Then insert the new records
      const { data: attendanceData, error: attendanceError } =
        await supabase.supabase
          .from("ds_teacher_attendance")
          .insert(validatedRecords)
          .select();

      console.log("Attendance upsert result:", {
        attendanceData,
        attendanceError,
      });

      if (attendanceError) {
        return res.status(500).json({
          success: false,
          error: "Failed to update attendance records",
        });
      }

      res.json({
        success: true,
        message: "Attendance updated successfully",
        data: {
          attendance_records: attendanceData,
          total_records: attendanceData?.length || 0,
        },
      });
    } catch (error) {
      console.error("Update attendance error:", error);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

/**
 * Get current user information
 * GET /getCurrentUser
 */
app.get("/getCurrentUser", async (req, res) => {
  try {
    // This depends on your authentication middleware
    // Adjust based on how you handle user authentication
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "User not authenticated",
      });
    }

    const { data, error } = await supabase
      .from("users")
      .select("id, first_name, last_name, email")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("Error fetching current user:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to fetch user information",
      });
    }

    res.json({
      success: true,
      data: data,
    });
  } catch (error) {
    console.error("Get current user error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * Get attendance statistics for a course
 * GET /getAttendanceStats/:courseId
 */
app.get("/getAttendanceScores/:studentId/:courseId", async (req, res) => {
  try {
    const { studentId, courseId } = req.params;

    if (!courseId) {
      return res.status(400).json({
        success: false,
        error: "Course ID is required",
      });
    }

    let query = supabase.supabase
      .from("ds_attendance")
      .select(
        `
        status,
        ds_class_sessions!inner (
          course_id,
          session_date
        )
      `,
      )
      .eq("ds_class_sessions.course_id", courseId);

    // Add date filters if provided
    if (startDate) {
      query = query.gte("ds_class_sessions.session_date", startDate);
    }
    if (endDate) {
      query = query.lte("ds_class_sessions.session_date", endDate);
    }

    const { data, error } = await query;

    if (error) {
      console.error("Error fetching attendance stats:", error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }

    // Calculate statistics
    const stats = {
      total: data.length,
      present: data.filter((record) => record.status === "present").length,
      absent: data.filter((record) => record.status === "absent").length,
      late: data.filter((record) => record.status === "late").length,
      excused: data.filter((record) => record.status === "excused").length,
      attendance_rate: 0,
    };

    if (stats.total > 0) {
      stats.attendance_rate = Math.round(
        ((stats.present + stats.excused) / stats.total) * 100,
      );
    }

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Get attendance stats error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * Delete attendance session and all related records
 * DELETE /deleteAttendanceSession/:sessionId
 */
app.delete("/deleteAttendanceSession/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: "Session ID is required",
      });
    }

    // Delete attendance records first (due to foreign key constraint)
    const { error: attendanceError } = await supabase.supabase
      .from("ds_attendance")
      .delete()
      .eq("session_id", sessionId);

    if (attendanceError) {
      console.error("Error deleting attendance records:", attendanceError);
      return res.status(500).json({
        success: false,
        error: "Failed to delete attendance records",
      });
    }

    // Delete the session
    const { error: sessionError } = await supabase.supabase
      .from("ds_class_sessions")
      .delete()
      .eq("session_id", sessionId);

    if (sessionError) {
      console.error("Error deleting session:", sessionError);
      return res.status(500).json({
        success: false,
        error: "Failed to delete session",
      });
    }

    res.json({
      success: true,
      message: "Attendance session deleted successfully",
    });
  } catch (error) {
    console.error("Delete attendance session error:", error);
    res.status(500).json({
      success: false,
      error: "Internal server error",
    });
  }
});

/**
 * Student Enrollment endpoint
 */
app.post("/enrollStudent", async (req, res) => {
  try {
    const { student_id, course_id } = req.body;

    if (!student_id || !course_id) {
      return res.status(400).json({
        success: false,
        error: "student_id and course_id are required",
      });
    }

    // Resolve the current academic year
    const { data: currentYear, error: yearError } = await supabase.supabase
      .from("ds_academic_years")
      .select("year_label")
      .eq("is_current", true)
      .single();

    if (yearError || !currentYear) {
      return res
        .status(500)
        .json({ success: false, error: "No active academic year found" });
    }
    const academic_year = currentYear.year_label;

    // Check if student is already enrolled in this course for this year
    const { data: existing, error: checkError } = await supabase.supabase
      .from("ds_student_enrollment")
      .select("enrollment_id, is_active")
      .eq("student_id", student_id)
      .eq("course_id", course_id)
      .eq("academic_year", academic_year)
      .maybeSingle();

    if (checkError) {
      return res
        .status(500)
        .json({ success: false, error: checkError.message });
    }

    if (existing) {
      if (existing.is_active) {
        return res.status(409).json({
          success: false,
          error: "Student is already actively enrolled in this course",
        });
      }
      // Re-activate a previously inactive enrollment
      const { data, error } = await supabase.supabase
        .from("ds_student_enrollment")
        .update({
          is_active: true,
          enrolled_date: new Date().toISOString().split("T")[0],
        })
        .eq("enrollment_id", existing.enrollment_id)
        .select()
        .single();

      if (error)
        return res.status(500).json({ success: false, error: error.message });
      return res.json({
        success: true,
        message: "Student re-enrolled successfully",
        data,
        reactivated: true,
      });
    }

    // New enrollment
    const { data, error } = await supabase.supabase
      .from("ds_student_enrollment")
      .insert([
        {
          student_id,
          course_id,
          academic_year,
          enrolled_date: new Date().toISOString().split("T")[0],
          is_active: true,
        },
      ])
      .select()
      .single();

    if (error)
      return res.status(500).json({ success: false, error: error.message });
    return res.json({
      success: true,
      message: "Student enrolled successfully",
      data,
      reactivated: false,
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
app.post("/unenrollStudent", async (req, res) => {
  try {
    const { student_id, course_id } = req.body;

    // Validate input
    if (!student_id || !course_id) {
      return res.status(400).json({
        error: "Both student_id and course_id are required",
      });
    }

    // Check enrollment
    const { data: existing, error: checkError } = await supabase.supabase
      .from("ds_student_enrollment")
      .select("enrollment_id")
      .eq("student_id", student_id)
      .eq("course_id", course_id)
      .maybeSingle(); // returns null if none found

    if (checkError) {
      console.error("Error checking enrollment:", checkError);
      return res.status(500).json({ error: checkError.message });
    }

    if (!existing) {
      return res.status(404).json({
        error: "Student is not enrolled in this course",
      });
    }

    // Mark enrollment inactive
    const { data, error } = await supabase.supabase
      .from("ds_student_enrollment")
      .update({ is_active: false })
      .eq("student_id", student_id)
      .eq("course_id", course_id)
      .select();

    if (error) {
      console.error("Supabase unenrollStudent error:", error);
      return res.status(500).json({ error: error.message });
    }

    return res.json({
      message: "Student unenrolled successfully",
      data,
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// ── Suggested next course: computes the level a student is headed into for
// the current (registration-open) academic year, based on their most recent
// prior enrollment, final grade, and profile gender/grade_level. Does NOT
// enroll anyone — the student still submits the registration form themselves.
app.get("/suggestedNextCourse/:portalId", async (req, res) => {
  try {
    const { portalId } = req.params;

    const { data: profile, error: profileErr } = await supabase.supabase
      .from("profiles")
      .select("portal_id, gender, grade_level")
      .eq("portal_id", portalId)
      .single();
    if (profileErr || !profile) {
      return res
        .status(404)
        .json({ success: false, error: "Student profile not found" });
    }

    // The class the student most recently completed — their latest active
    // enrollment, whichever academic year that happens to be.
    const { data: recentEnrollments, error: enrollErr } = await supabase.supabase
      .from("ds_student_enrollment")
      .select(
        `enrollment_id, student_id, course_id, academic_year, enrolled_date, is_active,
         ds_courses:course_id ( course_id, class_name, level, academic_year )`,
      )
      .eq("student_id", portalId)
      .eq("is_active", true)
      .order("enrolled_date", { ascending: false })
      .limit(1);
    if (enrollErr) {
      return res.status(500).json({ success: false, error: enrollErr.message });
    }

    const previous = recentEnrollments && recentEnrollments[0];
    if (!previous || !previous.ds_courses) {
      return res.json({
        success: true,
        data: { suggested_course_id: null, reason: "new_student" },
      });
    }
    const completedYear =
      previous.ds_courses.academic_year || previous.academic_year || "";

    // The "upcoming" year is the next academic year after the one just
    // completed. year_label is a fixed "YYYY-YYYY" format, so a plain string
    // comparison orders the years correctly.
    const { data: allYears } = await supabase.supabase
      .from("ds_academic_years")
      .select("year_label");
    const upcomingYear = (allYears || [])
      .map((y) => y.year_label)
      .filter((label) => label > completedYear)
      .sort()[0];

    // Final grade for the completed course (drives pass/fail promotion).
    const { data: grade } = await supabase.supabase
      .from("ds_student_final_grades")
      .select("is_passing_year, weighted_percentage")
      .eq("student_id", portalId)
      .eq("course_id", previous.course_id)
      .maybeSingle();

    const baseData = {
      previous_class_name: previous.ds_courses.class_name,
      previous_academic_year: completedYear,
      upcoming_academic_year: upcomingYear || null,
      is_passing_year: grade?.is_passing_year ?? null,
      final_grade: grade?.weighted_percentage ?? null,
    };

    if (!upcomingYear) {
      return res.json({
        success: true,
        data: { ...baseData, suggested_course_id: null, reason: "no_upcoming_year" },
      });
    }

    const bracket = classifyCourse(previous.ds_courses);
    if (bracket === "graduates") {
      return res.json({
        success: true,
        data: { ...baseData, suggested_course_id: null, reason: "graduated" },
      });
    }

    const decision = decideNextBracket({
      bracket,
      gender: profile.gender || "",
      gradeLevel: profile.grade_level || "",
      passed: !!grade?.is_passing_year,
    });

    if (!decision) {
      return res.json({
        success: true,
        data: { ...baseData, suggested_course_id: null, reason: "no_suggestion" },
      });
    }

    const { data: targetCourses, error: targetErr } = await supabase.supabase
      .from("ds_courses")
      .select("course_id, class_name, level, academic_year")
      .eq("academic_year", upcomingYear)
      .eq("is_active", true);
    if (targetErr) {
      return res.status(500).json({ success: false, error: targetErr.message });
    }

    const match = resolveCourse(targetCourses, decision);

    return res.json({
      success: true,
      data: {
        ...baseData,
        suggested_course_id: match ? match.course_id : null,
        suggested_class_name: match ? match.class_name : null,
        reason: match ? (grade?.is_passing_year ? "promoted" : "repeated") : "no_match",
      },
    });
  } catch (err) {
    console.error("suggestedNextCourse error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ── Create a Stripe PaymentIntent for the $25 re-enrollment fee ────────────────
app.post("/createReenrollmentPaymentIntent", authenticateToken, async (req, res) => {
  try {
    const stripe = getStripeClient();
    if (!stripe) {
      return res.status(503).json({
        success: false,
        error: "Stripe is not configured on the server",
      });
    }

    const { student_id } = req.body;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: REENROLLMENT_FEE_CENTS,
      currency: "usd",
      description: "Deacons School Re-enrollment Fee",
      metadata: {
        purpose: "ds_reenrollment",
        student_id: student_id ? String(student_id) : "",
      },
    });

    return res.status(200).json({
      success: true,
      clientSecret: paymentIntent.client_secret,
    });
  } catch (err) {
    console.error("Error creating re-enrollment payment intent:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to initiate payment",
    });
  }
});

// ── Self-enrollment: student enrolls themselves for the current academic year ──
app.post("/selfEnroll", authenticateToken, async (req, res) => {
  try {
    const { student_id, course_id, payment_intent_id } = req.body;

    if (!student_id || !course_id) {
      return res.status(400).json({
        success: false,
        error: "student_id and course_id are required",
      });
    }

    // A successful $25 re-enrollment payment is required before enrolling.
    const stripe = getStripeClient();
    if (!stripe) {
      return res.status(503).json({
        success: false,
        error: "Stripe is not configured on the server",
      });
    }
    if (!payment_intent_id) {
      return res.status(402).json({
        success: false,
        error: "Payment is required to complete re-enrollment",
      });
    }

    let paymentIntent;
    try {
      paymentIntent = await stripe.paymentIntents.retrieve(payment_intent_id);
    } catch (e) {
      return res.status(402).json({
        success: false,
        error: "Could not verify payment. Please try again.",
      });
    }
    if (
      !paymentIntent ||
      paymentIntent.status !== "succeeded" ||
      paymentIntent.amount !== REENROLLMENT_FEE_CENTS ||
      paymentIntent.currency !== "usd" ||
      paymentIntent.metadata?.purpose !== "ds_reenrollment" ||
      String(paymentIntent.metadata?.student_id || "") !== String(student_id)
    ) {
      return res.status(402).json({
        success: false,
        error:
          "Payment not completed or invalid. Please complete the $25 fee before re-enrolling.",
      });
    }

    // Security: verify student_id belongs to the authenticated user or one of their family members
    const { data: authProfiles, error: profileError } = await supabase.supabase
      .from("profiles")
      .select("portal_id")
      .eq("id", req.user.id);

    if (profileError || !authProfiles?.length) {
      return res
        .status(403)
        .json({ success: false, error: "User profile not found" });
    }

    const authPortalIds = authProfiles.map((p) => p.portal_id);

    const { data: familyMembers, error: familyError } =
      await supabase.supabase.rpc("get_family_children", {
        portal_id_in: authPortalIds,
      });

    if (familyError) {
      return res
        .status(500)
        .json({ success: false, error: "Could not verify family membership" });
    }

    const allowedPortalIds = new Set(
      (familyMembers || []).map((m) => String(m.portal_id)),
    );
    if (!allowedPortalIds.has(String(student_id))) {
      return res.status(403).json({
        success: false,
        error: "You can only enroll yourself or a family member",
      });
    }

    // Enroll into the academic year the chosen course actually belongs to
    // (e.g. the upcoming year), falling back to the current year if the course
    // has none recorded.
    const { data: course, error: courseError } = await supabase.supabase
      .from("ds_courses")
      .select("academic_year")
      .eq("course_id", course_id)
      .single();

    if (courseError || !course) {
      return res
        .status(404)
        .json({ success: false, error: "Course not found" });
    }

    let academic_year = course.academic_year;
    if (!academic_year) {
      const { data: currentYear } = await supabase.supabase
        .from("ds_academic_years")
        .select("year_label")
        .eq("is_current", true)
        .single();
      academic_year = currentYear?.year_label;
    }
    if (!academic_year) {
      return res
        .status(500)
        .json({ success: false, error: "No active academic year found" });
    }

    // Check if already actively enrolled in ANY course this year
    const { data: existingActive } = await supabase.supabase
      .from("ds_student_enrollment")
      .select("enrollment_id, course_id")
      .eq("student_id", student_id)
      .eq("academic_year", academic_year)
      .eq("is_active", true)
      .maybeSingle();

    if (existingActive) {
      return res.status(409).json({
        success: false,
        error: "You are already enrolled for this academic year",
        existingEnrollment: existingActive,
      });
    }

    // Check for a previously inactive enrollment for this specific course + year
    const { data: existingInactive } = await supabase.supabase
      .from("ds_student_enrollment")
      .select("enrollment_id")
      .eq("student_id", student_id)
      .eq("course_id", course_id)
      .eq("academic_year", academic_year)
      .eq("is_active", false)
      .maybeSingle();

    if (existingInactive) {
      const { data, error } = await supabase.supabase
        .from("ds_student_enrollment")
        .update({
          is_active: true,
          enrolled_date: new Date().toISOString().split("T")[0],
        })
        .eq("enrollment_id", existingInactive.enrollment_id)
        .select()
        .single();

      if (error)
        return res.status(500).json({ success: false, error: error.message });
      return res.json({
        success: true,
        message: "Enrolled successfully",
        data,
      });
    }

    // New enrollment
    const { data, error } = await supabase.supabase
      .from("ds_student_enrollment")
      .insert([
        {
          student_id,
          course_id,
          academic_year,
          enrolled_date: new Date().toISOString().split("T")[0],
          is_active: true,
          role: "deacon_school_student",
        },
      ])
      .select()
      .single();

    if (error)
      return res.status(500).json({ success: false, error: error.message });
    return res.json({ success: true, message: "Enrolled successfully", data });
  } catch (err) {
    console.error("selfEnroll error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ─── DS REGISTRATION REQUESTS (manual "I'm new / connect my account") ─────────
// Public submission when the DOB+last-name lookup finds no directory record.
// A coordinator later links the request to a portal profile or rejects it.

// Public: submit a manual registration request.
app.post("/registrationRequest", async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      dob,
      cellphone,
      email,
      previous_level,
      notes,
    } = req.body || {};

    if (!first_name?.trim() || !last_name?.trim() || !dob) {
      return res.status(400).json({
        success: false,
        error: "First name, last name, and date of birth are required",
      });
    }
    if (!email?.trim() && !cellphone?.trim()) {
      return res.status(400).json({
        success: false,
        error: "Please provide an email or a phone number so we can reach you",
      });
    }

    const { data, error } = await supabase.supabase
      .from("ds_registration_requests")
      .insert([
        {
          first_name: first_name.trim(),
          last_name: last_name.trim(),
          dob,
          cellphone: cellphone?.trim() || null,
          email: email?.trim()?.toLowerCase() || null,
          previous_level: previous_level?.trim() || null,
          notes: notes?.trim() || null,
          status: "pending",
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("registrationRequest insert error:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    return res.json({
      success: true,
      message:
        "Thanks! We received your information and will connect your account shortly.",
      data,
    });
  } catch (err) {
    console.error("registrationRequest error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Admin: list registration requests (GET is not caught by the mutation guard,
// so authenticate + authorize explicitly here).
app.get(
  "/registrationRequests",
  authenticateToken,
  requireDeaconsSchoolWrite,
  async (req, res) => {
    try {
      const status = (req.query.status || "pending").trim();
      const { page, limit, from, to } = parsePagination(req.query, 50);
      let query = supabase.supabase
        .from("ds_registration_requests")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (status && status !== "all") query = query.eq("status", status);

      const { data, error, count } = await query;
      if (error)
        return res.status(500).json({ success: false, error: error.message });
      res.json({
        success: true,
        data,
        pagination: {
          total: count,
          page,
          limit,
          totalPages: Math.ceil((count || 0) / limit),
        },
      });
    } catch (err) {
      console.error("list registrationRequests error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

// Admin: link a request to a portal profile (mutation → auto-guarded).
app.post("/registrationRequests/:id/link", async (req, res) => {
  try {
    const { id } = req.params;
    const { portal_id } = req.body || {};
    if (!portal_id) {
      return res
        .status(400)
        .json({ success: false, error: "portal_id is required" });
    }

    // Make sure the portal profile actually exists.
    const { data: profile, error: profErr } = await supabase.supabase
      .from("profiles")
      .select("portal_id")
      .eq("portal_id", portal_id)
      .maybeSingle();
    if (profErr)
      return res.status(500).json({ success: false, error: profErr.message });
    if (!profile)
      return res
        .status(404)
        .json({ success: false, error: "No profile with that portal_id" });

    const { data, error } = await supabase.supabase
      .from("ds_registration_requests")
      .update({
        status: "linked",
        linked_portal_id: portal_id,
        reviewed_by: req.authPortalId || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();

    if (error)
      return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    console.error("link registrationRequest error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Admin: reject a request (mutation → auto-guarded).
app.post("/registrationRequests/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;
    const { data, error } = await supabase.supabase
      .from("ds_registration_requests")
      .update({
        status: "rejected",
        reviewed_by: req.authPortalId || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select()
      .single();
    if (error)
      return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    console.error("reject registrationRequest error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

app.get("/getEnrolledDSStudents/:course_id", async (req, res) => {
  const { course_id } = req.params;
  const { page, limit, from, to } = parsePagination(req.query, 100);
  const { data, error, count } = await supabase.supabase
    .from("ds_student_enrollment")
    .select("*", { count: "exact" })
    .eq("course_id", course_id)
    .range(from, to);
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.json({
    success: true,
    data,
    pagination: {
      total: count,
      page,
      limit,
      totalPages: Math.ceil(count / limit),
    },
  });
});

app.put("/updateAllLevels", async (req, res) => {
  const levelMap = {
    1: "ds_level_alpha",
    2: "ds_level_beta",
    3: "ds_level_1",
    4: "ds_level_2",
    5: "ds_level_3",
    6: "ds_level_4",
    7: "ds_level_5",
    8: "ds_level_6",
    9: "ds_level_7",
    10: "ds_level_8",
    11: "ds_level_9",
    12: "ds_level_10",
    13: "ds_level_graduates",
    14: "ds_level_graduates",
  };

  try {
    for (let index = 1; index <= 14; index++) {
      console.log(`Updating index ${index} to ${levelMap[index]}`);

      const { data, error } = await supabase.supabase
        .from("deacons_school_altar_responses")
        .update({ level: levelMap[index] })
        .eq("level", index.toString()) // match the original value
        .select();

      if (error) {
        console.error(`Error updating index ${index}:`, error);
      } else {
        console.log(`Updated ${data.length} rows for index ${index}`);
      }
    }

    res.status(200).send("DONE");
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).send("Server error");
  }
});

// ─── Academic Year Management ──────────────────────────────────────────────────

app.get("/academicYears", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("ds_academic_years")
    .select("*")
    .order("start_date", { ascending: false });
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

app.get("/academicYears/current", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("ds_academic_years")
    .select("*")
    .eq("is_current", true)
    .single();
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

app.post("/academicYears", async (req, res) => {
  try {
    const { year_label, start_date, end_date } = req.body;
    if (!year_label || !start_date || !end_date) {
      return res.status(400).json({
        success: false,
        error: "year_label, start_date, and end_date are required",
      });
    }
    if (!/^\d{4}-\d{4}$/.test(year_label)) {
      return res.status(400).json({
        success: false,
        error: "year_label must be in YYYY-YYYY format",
      });
    }
    const { data, error } = await supabase.supabase
      .from("ds_academic_years")
      .insert([{ year_label, start_date, end_date, is_current: false }])
      .select()
      .single();
    if (error)
      return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

app.patch("/academicYears/:yearId/setCurrent", async (req, res) => {
  try {
    const { yearId } = req.params;

    // Clear current flag from all years, then set the target
    const { error: clearErr } = await supabase.supabase
      .from("ds_academic_years")
      .update({ is_current: false })
      .neq("year_id", yearId);
    if (clearErr)
      return res.status(500).json({ success: false, error: clearErr.message });

    const { data, error } = await supabase.supabase
      .from("ds_academic_years")
      .update({ is_current: true })
      .eq("year_id", yearId)
      .select()
      .single();
    if (error)
      return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

app.delete("/academicYears/:yearId", async (req, res) => {
  try {
    const { yearId } = req.params;

    // Prevent deleting the current year
    const { data: year } = await supabase.supabase
      .from("ds_academic_years")
      .select("is_current")
      .eq("year_id", yearId)
      .single();

    if (year?.is_current) {
      return res.status(400).json({
        success: false,
        error: "Cannot delete the current academic year",
      });
    }

    const { error } = await supabase.supabase
      .from("ds_academic_years")
      .delete()
      .eq("year_id", yearId);

    if (error)
      return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ─── Year-End Close-Out & Re-enrollment ───────────────────────────────────────

// POST /yearEnd/finalizeAllGrades/:academicYear
// Collects all existing final grades for active enrollments in the given year
// from ds_student_final_grades. No grade recalculation is performed.
app.post("/yearEnd/finalizeAllGrades/:academicYear", async (req, res) => {
  try {
    const { academicYear } = req.params;

    // Get all active enrollments for this year
    const { data: enrollments, error: enrollErr } = await supabase.supabase
      .from("ds_student_enrollment")
      .select("student_id, course_id")
      .eq("academic_year", academicYear)
      .eq("is_active", true);

    if (enrollErr)
      return res.status(500).json({ success: false, error: enrollErr.message });

    if (!enrollments || enrollments.length === 0) {
      return res.json({
        success: true,
        message: "No active enrollments found",
        total_enrollments: 0,
        grades_found: 0,
        missing_grades: 0,
      });
    }

    // Fetch all existing final grades matching enrolled student/course pairs
    const enrolledStudentIds = [
      ...new Set(enrollments.map((e) => e.student_id)),
    ];
    const enrolledCourseIds = [...new Set(enrollments.map((e) => e.course_id))];

    const { data: finalGrades, error: gradesErr } = await supabase.supabase
      .from("ds_student_final_grades")
      .select("student_id, course_id")
      .in("student_id", enrolledStudentIds)
      .in("course_id", enrolledCourseIds);

    if (gradesErr)
      return res.status(500).json({ success: false, error: gradesErr.message });

    const gradeMap = new Set(
      (finalGrades || []).map((g) => `${g.student_id}__${g.course_id}`),
    );

    const gradesFound = enrollments.filter((e) =>
      gradeMap.has(`${e.student_id}__${e.course_id}`),
    ).length;

    res.json({
      success: true,
      message: `Found grades for ${gradesFound} of ${enrollments.length} active enrollments`,
      total_enrollments: enrollments.length,
      grades_found: gradesFound,
      missing_grades: enrollments.length - gradesFound,
    });
  } catch (err) {
    console.error("finalizeAllGrades error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /yearEnd/summary/:academicYear
// Returns every student enrolled in the given year with their final grade info.
// Uses the same ds_student_final_grades query that getStudentGrades already uses —
// bulk fetch by student_id list, same fields, same table, no academic_year filter needed.
app.get("/yearEnd/summary/:academicYear", async (req, res) => {
  try {
    const { academicYear } = req.params;

    // Enrollments with course info
    const { data: enrollments, error: enrollErr } = await supabase.supabase
      .from("ds_student_enrollment")
      .select(
        `
          enrollment_id,
          student_id,
          course_id,
          is_active,
          ds_courses:course_id (course_id, class_name, level)
        `,
      )
      .eq("academic_year", academicYear)
      .eq("is_active", true);

    if (enrollErr) {
      console.error("yearEnd summary enrollment error:", enrollErr);
      return res.status(500).json({ success: false, error: enrollErr.message });
    }

    if (!enrollments || enrollments.length === 0) {
      return res.json({ success: true, data: [] });
    }

    // Bulk fetch final grades from ds_student_final_grades by student_id list —
    // same table and same fields as GET /getStudentGrades/:studentId/:courseId.
    const studentIds = [...new Set(enrollments.map((e) => e.student_id))];

    const { data: finalGrades, error: gradesErr } = await supabase.supabase
      .from("ds_student_final_grades")
      .select(
        "student_id, course_id, weighted_percentage, is_passing_year, calculated_at",
      )
      .in("student_id", studentIds);

    if (gradesErr) {
      console.error("yearEnd summary grades error:", gradesErr);
    }

    // Build lookup map by "student_id__course_id" — same as the working grade panel
    const gradeMap = {};
    (finalGrades || []).forEach((g) => {
      gradeMap[`${g.student_id}__${g.course_id}`] = g;
    });

    // Student profiles
    const { data: profiles } = await supabase.supabase
      .from("profiles")
      .select("portal_id, first_name, last_name, email")
      .in("portal_id", studentIds);

    const profileMap = {};
    (profiles || []).forEach((p) => {
      profileMap[p.portal_id] = p;
    });

    const summary = enrollments.map((e) => {
      const grade = gradeMap[`${e.student_id}__${e.course_id}`] || null;
      const profile = profileMap[e.student_id] || {};
      return {
        enrollment_id: e.enrollment_id,
        student_id: e.student_id,
        first_name: profile.first_name || "",
        last_name: profile.last_name || "",
        email: profile.email || "",
        course_id: e.course_id,
        class_name: e.ds_courses?.class_name || "",
        level: e.ds_courses?.level || "",
        weighted_percentage: grade?.weighted_percentage ?? null,
        is_passing_year: grade?.is_passing_year ?? null,
        grade_calculated: !!grade,
        calculated_at: grade?.calculated_at ?? null,
      };
    });

    res.json({ success: true, data: summary });
  } catch (err) {
    console.error("yearEnd summary error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// PATCH /yearEnd/closeYear/:yearId
// Marks the academic year as closed — no further grade/attendance writes allowed.
app.patch("/yearEnd/closeYear/:yearId", async (req, res) => {
  try {
    const { yearId } = req.params;

    const { data, error } = await supabase.supabase
      .from("ds_academic_years")
      .update({ is_closed: true, is_current: false })
      .eq("year_id", yearId)
      .select()
      .single();

    if (error)
      return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /bulkUpdateGradeLevels
// Updates grade_level for multiple students in the profiles table
app.post("/bulkUpdateGradeLevels", async (req, res) => {
  try {
    const { updates } = req.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid request: updates array is required",
      });
    }

    // Validate each update has required fields
    for (const update of updates) {
      if (!update.portal_id || !update.grade_level) {
        return res.status(400).json({
          success: false,
          error: "Each update must have portal_id and grade_level",
        });
      }
    }

    const results = [];
    const errors = [];

    // Update each student's grade level
    for (const update of updates) {
      const { data, error } = await supabase.supabase
        .from("profiles")
        .update({ grade_level: update.grade_level })
        .eq("portal_id", update.portal_id)
        .select()
        .single();

      if (error) {
        errors.push({
          portal_id: update.portal_id,
          error: error.message,
        });
      } else {
        results.push(data);
      }
    }

    if (errors.length > 0) {
      return res.status(207).json({
        success: true,
        data: results,
        partial: true,
        errors,
        message: `Updated ${results.length} of ${updates.length} students`,
      });
    }

    res.json({
      success: true,
      data: results,
      message: `Successfully updated ${results.length} student(s)`,
    });
  } catch (err) {
    console.error("bulkUpdateGradeLevels error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /bulkUpdateGender
// Updates gender for multiple students in the profiles table
app.post("/bulkUpdateGender", async (req, res) => {
  try {
    const { updates } = req.body;

    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Invalid request: updates array is required",
      });
    }

    // Validate each update has required fields
    for (const update of updates) {
      if (!update.portal_id || !update.gender) {
        return res.status(400).json({
          success: false,
          error: "Each update must have portal_id and gender",
        });
      }
      if (!["male", "female"].includes(update.gender)) {
        return res.status(400).json({
          success: false,
          error: "gender must be 'male' or 'female'",
        });
      }
    }

    const results = [];
    const errors = [];

    // Update each student's gender
    for (const update of updates) {
      const { data, error } = await supabase.supabase
        .from("profiles")
        .update({ gender: update.gender })
        .eq("portal_id", update.portal_id)
        .select()
        .single();

      if (error) {
        errors.push({
          portal_id: update.portal_id,
          error: error.message,
        });
      } else {
        results.push(data);
      }
    }

    if (errors.length > 0) {
      return res.status(207).json({
        success: true,
        data: results,
        partial: true,
        errors,
        message: `Updated ${results.length} of ${updates.length} students`,
      });
    }

    res.json({
      success: true,
      data: results,
      message: `Successfully updated ${results.length} student(s)`,
    });
  } catch (err) {
    console.error("bulkUpdateGender error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// GET /reenrollment/candidates/:academicYear
// Returns all students enrolled in the given year with their final grade info,
// ready for the admin to decide their next course enrollment.
app.get("/reenrollment/candidates/:academicYear", async (req, res) => {
  try {
    const { academicYear } = req.params;

    const { data: enrollments, error: enrollErr } = await supabase.supabase
      .from("ds_student_enrollment")
      .select(
        `
        enrollment_id,
        student_id,
        course_id,
        ds_courses:course_id (course_id, class_name, level)
      `,
      )
      .eq("academic_year", academicYear)
      .eq("is_active", true);

    if (enrollErr)
      return res.status(500).json({ success: false, error: enrollErr.message });

    const { data: finalGrades } = await supabase.supabase
      .from("ds_student_final_grades")
      .select("student_id, course_id, weighted_percentage, is_passing_year")
      .eq("academic_year", academicYear);

    const gradeMap = {};
    (finalGrades || []).forEach((g) => {
      gradeMap[`${g.student_id}__${g.course_id}`] = g;
    });

    const studentIds = [
      ...new Set((enrollments || []).map((e) => e.student_id)),
    ];
    const { data: profiles } = await supabase.supabase
      .from("profiles")
      .select("portal_id, first_name, last_name, email")
      .in("portal_id", studentIds);

    const profileMap = {};
    (profiles || []).forEach((p) => {
      profileMap[p.portal_id] = p;
    });

    const candidates = (enrollments || []).map((e) => {
      const grade = gradeMap[`${e.student_id}__${e.course_id}`] || null;
      const profile = profileMap[e.student_id] || {};
      return {
        student_id: e.student_id,
        first_name: profile.first_name || "",
        last_name: profile.last_name || "",
        email: profile.email || "",
        current_course_id: e.course_id,
        current_class_name: e.ds_courses?.class_name || "",
        current_level: e.ds_courses?.level || "",
        weighted_percentage: grade?.weighted_percentage ?? null,
        is_passing_year: grade?.is_passing_year ?? null,
        grade_calculated: !!grade,
      };
    });

    res.json({ success: true, data: candidates });
  } catch (err) {
    console.error("reenrollment candidates error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /reenrollment/bulk
// Enrolls a list of students into specified courses for the current academic year.
// Body: { enrollments: [{ student_id, course_id }], academic_year }
app.post("/reenrollment/bulk", async (req, res) => {
  try {
    const { enrollments, academic_year } = req.body;

    if (
      !enrollments ||
      !Array.isArray(enrollments) ||
      enrollments.length === 0
    ) {
      return res
        .status(400)
        .json({ success: false, error: "enrollments array is required" });
    }
    if (!academic_year) {
      return res
        .status(400)
        .json({ success: false, error: "academic_year is required" });
    }

    const results = [];
    const errors = [];

    for (const item of enrollments) {
      const { student_id, course_id } = item;
      if (!student_id || !course_id) {
        errors.push({
          student_id,
          course_id,
          error: "student_id and course_id are required",
        });
        continue;
      }

      // Check if already enrolled for this year
      const { data: existing } = await supabase.supabase
        .from("ds_student_enrollment")
        .select("enrollment_id, is_active")
        .eq("student_id", student_id)
        .eq("course_id", course_id)
        .eq("academic_year", academic_year)
        .maybeSingle();

      if (existing) {
        if (!existing.is_active) {
          // Reactivate
          const { error } = await supabase.supabase
            .from("ds_student_enrollment")
            .update({ is_active: true })
            .eq("enrollment_id", existing.enrollment_id);
          if (error) {
            errors.push({ student_id, course_id, error: error.message });
            continue;
          }
          results.push({ student_id, course_id, action: "reactivated" });
        } else {
          results.push({ student_id, course_id, action: "already_enrolled" });
        }
        continue;
      }

      // New enrollment
      const { error } = await supabase.supabase
        .from("ds_student_enrollment")
        .insert([
          {
            student_id,
            course_id,
            academic_year,
            enrolled_date: new Date().toISOString().split("T")[0],
            is_active: true,
            role: "deacon_school_student",
          },
        ]);

      if (error) {
        errors.push({ student_id, course_id, error: error.message });
      } else {
        results.push({ student_id, course_id, action: "enrolled" });
      }
    }

    res.json({
      success: true,
      message: `Enrolled ${results.filter((r) => r.action === "enrolled").length}, reactivated ${results.filter((r) => r.action === "reactivated").length}, skipped ${results.filter((r) => r.action === "already_enrolled").length}, errors ${errors.length}`,
      results,
      errors,
    });
  } catch (err) {
    console.error("reenrollment bulk error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// POST /newYear/setupCourses
// Creates a ds_courses row for each provided level in the new academic year.
// Body: { academic_year, courses: [{ class_name, level }] }
app.post("/newYear/setupCourses", async (req, res) => {
  try {
    const { academic_year, courses } = req.body;

    if (
      !academic_year ||
      !courses ||
      !Array.isArray(courses) ||
      courses.length === 0
    ) {
      return res.status(400).json({
        success: false,
        error: "academic_year and courses array are required",
      });
    }

    // Check for existing courses for this year to avoid duplicates
    const { data: existing } = await supabase.supabase
      .from("ds_courses")
      .select("level")
      .eq("academic_year", academic_year);

    const existingLevels = new Set((existing || []).map((c) => c.level));

    const toInsert = courses
      .filter((c) => !existingLevels.has(c.level))
      .map((c) => ({
        class_name: c.class_name,
        level: c.level,
        is_active: true,
        academic_year,
      }));

    if (toInsert.length === 0) {
      return res.json({
        success: true,
        message: "All courses already exist for this year",
        created: [],
      });
    }

    const { data, error } = await supabase.supabase
      .from("ds_courses")
      .insert(toInsert)
      .select();

    if (error)
      return res.status(500).json({ success: false, error: error.message });

    res.json({
      success: true,
      message: `Created ${data.length} courses for ${academic_year}`,
      created: data,
      skipped: courses.length - toInsert.length,
    });
  } catch (err) {
    console.error("setupCourses error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// ─── End Year-End Close-Out & Re-enrollment ────────────────────────────────────

app.get("/getCalendarByCourse/:course_id", async (req, res) => {
  const course_id = req.params.course_id;
  console.log(course_id);
  let { data, error } = await supabase.supabase
    .from("ds_calendar_week")
    .select("*")
    .contains("courses_id", [course_id]); // course_id must be inside an array
  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
app.get("/getCalendarByCurrentWeekAndCourse/:course_id", async (req, res) => {
  const { course_id } = req.params;
  console.log(course_id);
  try {
    const { data, error } = await supabase.supabase.rpc(
      "get_current_week_calendar_by_course",
      {
        p_course_id: course_id,
      },
    );
    console.log(data);
    const uniqueData = Array.from(
      new Map(data.map((item) => [item.content_id, item])).values(),
    );

    console.log(uniqueData);
    if (error) {
      console.error("Database error:", error);
      return res.status(500).json({
        error: "Database query failed",
        details: error.message,
      });
    }

    res.send(uniqueData);
  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({
      error: "Internal server error",
      details: err.message,
    });
  }
});

// Get all grading categories
app.get("/getGradingCategories", async (req, res) => {
  try {
    const { data, error } = await supabase.supabase
      .from("ds_grading_categories")
      .select("*")
      .eq("is_active", true)
      .order("category_name");

    if (error) {
      console.error("Error fetching grading categories:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Get quarters/terms
app.get("/getQuarters", async (req, res) => {
  try {
    const { data, error } = await supabase.supabase
      .from("ds_quarters")
      .select("*")
      .eq("is_active", true)
      .order("start_date", { ascending: false });

    if (error) {
      console.error("Error fetching quarters:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Get assessment items by category
app.get("/getAssessmentItems/:categoryId/:course_id", async (req, res) => {
  try {
    const { categoryId, course_id } = req.params;

    const { data, error } = await supabase.supabase
      .from("ds_assessment_items")
      .select(
        `
        *,
        ds_grading_categories:category_id (
          category_name,
          weight_percentage
        )
      `,
      )
      .eq("category_id", categoryId)
      .eq("course_id", course_id)
      .eq("is_active", true)
      .order("item_name");

    if (error) {
      console.error("Error fetching assessment items:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
// Get assessment items by category
app.get("/getAssessmentItemsByCourse/:course_id", async (req, res) => {
  try {
    const { course_id } = req.params;
    const { page, limit, from, to } = parsePagination(req.query);

    const { data, error, count } = await supabase.supabase
      .from("ds_assessment_items")
      .select(
        `
        *,
        ds_grading_categories:category_id (
          category_name,
          weight_percentage
        )
      `,
        { count: "exact" },
      )
      .eq("course_id", course_id)
      .eq("is_active", true)
      .order("item_name")
      .range(from, to);

    if (error) {
      console.error("Error fetching assessment items:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({
      success: true,
      data,
      pagination: {
        total: count,
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
app.get(
  "/getAssessmentItemsByCourseAndCategory/:course_id/:category_id",
  async (req, res) => {
    try {
      const { course_id, category_id } = req.params;

      const { data, error } = await supabase.supabase
        .from("ds_assessment_items")
        .select(
          `
        *,
        ds_grading_categories:category_id (
          category_name,
          weight_percentage
        )
      `,
        )
        .eq("course_id", course_id)
        .eq("category_id", category_id)
        .eq("is_active", true)
        .order("item_name");

      if (error) {
        console.error("Error fetching assessment items:", error);
        return res.status(500).json({ success: false, error: error.message });
      }

      res.json({ success: true, data });
    } catch (err) {
      console.error("Unexpected error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

// Get available hymns/rituals/etc for assessment creation
app.get("/getAvailableItems/:category", async (req, res) => {
  try {
    const { category } = req.params;
    let tableName;
    let selectFields = "id, *";

    switch (category) {
      case "hymns":
        tableName = "deacons_school_hymns";
        selectFields = "id, name, points, level_hymn_in";
        break;
      case "rituals":
        tableName = "deacons_school_rituals";
        selectFields = "id, name, level";
        break;
      case "memorization":
        tableName = "deacons_school_memorization";
        selectFields = "id, name, level";
        break;
      case "altar_responses":
        tableName = "deacons_school_altar_responses";
        selectFields = "id, name, level";
        break;
      default:
        return res
          .status(400)
          .json({ success: false, error: "Invalid category" });
    }

    const { data, error } = await supabase.supabase
      .from(tableName)
      .select(selectFields)
      .order("name");

    if (error) {
      console.error(`Error fetching ${category}:`, error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Create assessment item
app.post("/createAssessmentItem", async (req, res) => {
  try {
    const {
      category_id,
      course_id,
      max_points,
      item_name,
      item_reference,
      reference_id,
    } = req.body;
    console.log(course_id);
    console.log(item_name);
    console.log(course_id);
    if (!category_id || !item_name || !course_id) {
      return res.status(400).json({
        success: false,
        error: "Category ID and item name are required",
      });
    }

    const { data, error } = await supabase.supabase
      .from("ds_assessment_items")
      .insert([
        {
          category_id,
          course_id,
          max_points,
          item_name,
          item_reference: item_reference || null,
          reference_id: reference_id || null,
          is_active: true,
        },
      ])
      .select();

    if (error) {
      console.error("Error creating assessment item:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, data: data[0] });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Get student scores
app.get("/getStudentScores/:studentId/:courseId", async (req, res) => {
  try {
    const { studentId, courseId } = req.params;

    const { data, error } = await supabase.supabase.rpc(
      "get_student_all_scores",
      {
        p_student_id: studentId,
        p_course_id: courseId,
      },
    );
    console.log(data);
    if (error) {
      console.error("Error fetching scores:", error);
    } else {
      console.log("All Scores (including attendance & behavior):", data);
    }

    if (error) {
      console.error("Error fetching student scores:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
// Get student scores
app.get("/getStudentsScoresByCourse/:courseId", async (req, res) => {
  try {
    const { courseId } = req.params;

    const { data, error } = await supabase.supabase.rpc(
      "get_all_students_scores_by_course",
      {
        p_course_id: courseId,
      },
    );
    console.log(data);
    if (error) {
      console.error("Error fetching scores:", error);
    } else {
      console.log("All Scores (including attendance & behavior):", data);
    }

    if (error) {
      console.error("Error fetching student scores:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({ success: true, data });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Submit student score
app.post("/submitStudentScore", async (req, res) => {
  try {
    const {
      student_id,
      course_id,
      quarter_id,
      item_id,
      points_earned,
      scored_by,
      notes,
    } = req.body;

    // Validation
    if (
      !student_id ||
      !course_id ||
      !quarter_id ||
      !item_id ||
      points_earned === undefined
    ) {
      return res.status(400).json({
        success: false,
        error: "All required fields must be provided",
      });
    }

    // Get points possible (will be set by trigger, but we can calculate for response)
    const { data: itemData } = await supabase.supabase
      .from("ds_assessment_items")
      .select("item_reference, reference_id")
      .eq("item_id", item_id)
      .single();

    let points_possible = 100; // default
    if (
      itemData?.item_reference === "deacons_school_hymns" &&
      itemData?.reference_id
    ) {
      const { data: hymnData } = await supabase.supabase
        .from("deacons_school_hymns")
        .select("points")
        .eq("id", itemData.reference_id)
        .single();
      points_possible = hymnData?.points || 100;
    }

    const { data, error } = await supabase.supabase
      .from("ds_student_scores")
      .upsert(
        [
          {
            student_id,
            course_id,
            quarter_id,
            item_id,
            points_earned: parseFloat(points_earned),
            points_possible,
            scored_by,
            notes: notes || null,
            scored_date: new Date().toISOString().split("T")[0],
          },
        ],
        {
          onConflict: "student_id,course_id,quarter_id,item_id",
        },
      )
      .select();

    if (error) {
      console.error("Error submitting student score:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({
      success: true,
      message: "Score submitted successfully",
      data: data[0],
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Submit multiple scores (batch)
app.post("/submitBatchScores", async (req, res) => {
  try {
    const { scores, scored_by } = req.body;
    const NUMERIC_8_2_MAX = 999999.99;

    if (!Array.isArray(scores) || scores.length === 0) {
      return res.status(400).json({
        success: false,
        error: "Scores array is required",
      });
    }

    const itemIds = [...new Set(scores.map((s) => s?.item_id).filter(Boolean))];
    const { data: assessmentItems, error: assessmentItemsError } =
      await supabase.supabase
        .from("ds_assessment_items")
        .select(
          "item_id, item_reference, reference_id, max_points, is_extra_credit",
        )
        .in("item_id", itemIds);

    if (assessmentItemsError) {
      console.error(
        "Error fetching assessment items for batch scores:",
        assessmentItemsError,
      );
      return res
        .status(500)
        .json({ success: false, error: assessmentItemsError.message });
    }

    const assessmentItemMap = new Map(
      (assessmentItems || []).map((item) => [item.item_id, item]),
    );

    const hymnReferenceIds = [
      ...new Set(
        (assessmentItems || [])
          .filter(
            (item) =>
              item.item_reference === "deacons_school_hymns" &&
              typeof item.reference_id === "string" &&
              item.reference_id.trim().length > 0,
          )
          .map((item) => item.reference_id),
      ),
    ];

    let hymnPointsMap = new Map();
    if (hymnReferenceIds.length > 0) {
      const { data: hymnPoints, error: hymnPointsError } =
        await supabase.supabase
          .from("deacons_school_hymns")
          .select("id, points")
          .in("id", hymnReferenceIds);

      if (hymnPointsError) {
        console.error(
          "Error fetching hymn points for batch scores:",
          hymnPointsError,
        );
        return res
          .status(500)
          .json({ success: false, error: hymnPointsError.message });
      }

      hymnPointsMap = new Map(
        (hymnPoints || []).map((hymn) => [hymn.id, hymn.points]),
      );
    }

    const skippedRows = [];

    // Prepare scores with scored_by and date
    const processedScores = scores.reduce((acc, score, index) => {
      const hasRequiredIds =
        score?.student_id && score?.course_id && score?.item_id;
      const rawPointsEarned = score?.points_earned;
      const isBlankPointsEarned =
        rawPointsEarned === undefined ||
        rawPointsEarned === null ||
        `${rawPointsEarned}`.trim() === "";

      // Frontend sometimes sends placeholder rows or untouched cells in bulk payload.
      // Skip them instead of failing the entire batch.
      if (!hasRequiredIds || isBlankPointsEarned) {
        skippedRows.push({
          index,
          item_id: score?.item_id || null,
          reason: "Missing required identifiers or empty points_earned",
        });
        return acc;
      }

      const parsedPointsEarned = Number.parseFloat(rawPointsEarned);
      if (!Number.isFinite(parsedPointsEarned)) {
        skippedRows.push({
          index,
          item_id: score.item_id,
          reason: "points_earned must be a valid number",
        });
        return acc;
      }

      if (Math.abs(parsedPointsEarned) > NUMERIC_8_2_MAX) {
        skippedRows.push({
          index,
          item_id: score.item_id,
          reason: `points_earned is out of range for numeric(8,2). Max allowed is ${NUMERIC_8_2_MAX}`,
        });
        return acc;
      }

      const itemMeta = assessmentItemMap.get(score.item_id);
      const hymnPoints = itemMeta?.reference_id
        ? hymnPointsMap.get(itemMeta.reference_id)
        : null;

      const normalizedPointsPossibleInput =
        score.points_possible !== undefined && score.points_possible !== null
          ? Number.parseFloat(score.points_possible)
          : null;

      let pointsPossible = null;
      if (Number.isFinite(normalizedPointsPossibleInput)) {
        pointsPossible = normalizedPointsPossibleInput;
      } else if (
        itemMeta?.max_points !== undefined &&
        itemMeta?.max_points !== null
      ) {
        const maxPoints = Number.parseFloat(itemMeta.max_points);
        if (Number.isFinite(maxPoints)) {
          pointsPossible = maxPoints;
        }
      } else if (hymnPoints !== undefined && hymnPoints !== null) {
        const hymnNumericPoints = Number.parseFloat(hymnPoints);
        if (Number.isFinite(hymnNumericPoints)) {
          pointsPossible = hymnNumericPoints;
        }
      }

      if (!Number.isFinite(pointsPossible)) {
        // Keep compatibility with older clients that don't send points_possible.
        pointsPossible = Math.max(100, parsedPointsEarned);
      }

      if (!Number.isFinite(pointsPossible) || pointsPossible <= 0) {
        skippedRows.push({
          index,
          item_id: score.item_id,
          reason: "points_possible must be a positive number",
        });
        return acc;
      }

      if (Math.abs(pointsPossible) > NUMERIC_8_2_MAX) {
        skippedRows.push({
          index,
          item_id: score.item_id,
          reason: `points_possible is out of range for numeric(8,2). Max allowed is ${NUMERIC_8_2_MAX}`,
        });
        return acc;
      }

      if (!itemMeta?.is_extra_credit && parsedPointsEarned > pointsPossible) {
        skippedRows.push({
          index,
          item_id: score.item_id,
          reason:
            "points_earned cannot exceed points_possible for non-extra-credit items",
        });
        return acc;
      }

      const roundedPointsEarned = Math.round(parsedPointsEarned * 100) / 100;
      const roundedPointsPossible = Math.round(pointsPossible * 100) / 100;
      const resolvedScoredBy = score?.scored_by || scored_by || "system";

      acc.push({
        ...score,
        quarter_id: score?.quarter_id || null,
        points_earned: roundedPointsEarned,
        points_possible: roundedPointsPossible,
        scored_by: resolvedScoredBy,
        scored_date: new Date().toISOString().split("T")[0],
      });

      return acc;
    }, []);

    if (processedScores.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No valid scores were provided",
        details: skippedRows.slice(0, 25),
      });
    }

    const { data, error } = await supabase.supabase
      .from("ds_student_scores")
      .upsert(processedScores, {
        onConflict: "student_id,course_id,item_id",
      })
      .select();

    if (error) {
      console.error("Error submitting batch scores:", error);

      if (error.message && error.message.includes("numeric field overflow")) {
        const savedRows = [];

        for (let i = 0; i < processedScores.length; i++) {
          const row = processedScores[i];
          const { data: rowData, error: rowError } = await supabase.supabase
            .from("ds_student_scores")
            .upsert([row], {
              onConflict: "student_id,course_id,item_id",
            })
            .select();

          if (rowError) {
            skippedRows.push({
              index: i,
              item_id: row.item_id,
              reason: rowError.message,
            });
            continue;
          }

          if (rowData && rowData[0]) {
            savedRows.push(rowData[0]);
          }
        }

        if (savedRows.length === 0) {
          return res.status(400).json({
            success: false,
            error:
              "All score rows failed to save. Please verify score values and item setup.",
            details: skippedRows.slice(0, 25),
          });
        }

        return res.json({
          success: true,
          message: `${savedRows.length} scores submitted successfully`,
          skipped_count: skippedRows.length,
          skipped_details: skippedRows.slice(0, 10),
          data: savedRows,
        });
      }

      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({
      success: true,
      message: `${data.length} scores submitted successfully`,
      skipped_count: skippedRows.length,
      skipped_details: skippedRows.slice(0, 10),
      data,
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Get student final grades
app.get("/getStudentGrades/:studentId/:courseId/", async (req, res) => {
  try {
    const { studentId, courseId } = req.params;

    const { data, error } = await supabase.supabase
      .from("ds_student_final_grades")
      .select("*")
      .eq("student_id", studentId)
      .eq("course_id", courseId)
      .single();
    if (error && error.code !== "PGRST116") {
      // PGRST116 = no rows found
      console.error("Error fetching student grades:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
    console.log(data);
    res.json({ success: true, data: data || null });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
// Get student final grades
app.get("/getStudentsGradesByCourse/:courseId/", async (req, res) => {
  try {
    const { courseId } = req.params; // Only extract courseId
    console.log(courseId);
    const { data, error } = await supabase.supabase.rpc(
      "get_course_students_grades",
      {
        p_course_id: courseId,
      },
    );

    if (error) {
      console.error("Error fetching student grades:", error);
      return res.status(500).json({ success: false, error: error.message });
    }
    res.json({ success: true, data: data || [] }); // Return empty array if no data
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Get yearly progress for student
app.get(
  "/getYearlyProgress/:studentId/:courseId/:academicYear",
  async (req, res) => {
    try {
      const { studentId, courseId, academicYear } = req.params;

      // Get yearly requirement
      const { data: requirement } = await supabase.supabase
        .from("ds_yearly_requirements")
        .select("total_points_to_pass")
        .eq("course_id", courseId)
        .eq("academic_year", academicYear)
        .single();

      // Get student's yearly totals
      const { data: yearlyGrades } = await supabase.supabase
        .from("ds_student_final_grades")
        .select("total_raw_points, yearly_total_points, is_passing_year")
        .eq("student_id", studentId)
        .eq("course_id", courseId)
        .eq("academic_year", academicYear);

      let totalPoints = 0;
      let isPassingYear = false;

      if (yearlyGrades && yearlyGrades.length > 0) {
        totalPoints = yearlyGrades.reduce(
          (sum, grade) => sum + (grade.total_raw_points || 0),
          0,
        );
        isPassingYear = yearlyGrades.some((grade) => grade.is_passing_year);
      }

      res.json({
        success: true,
        data: {
          academic_year: academicYear,
          total_points_earned: totalPoints,
          points_required: requirement?.total_points_to_pass || 0,
          is_passing: isPassingYear,
          quarters: yearlyGrades || [],
        },
      });
    } catch (err) {
      console.error("Unexpected error:", err);
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  },
);

// Get class average for assignment
app.get("/getClassAverage/:courseId/:quarterId/:itemId", async (req, res) => {
  try {
    const { courseId, quarterId, itemId } = req.params;

    const { data, error } = await supabase.supabase
      .from("ds_student_scores")
      .select("points_earned, points_possible")
      .eq("course_id", courseId)
      .eq("quarter_id", quarterId)
      .eq("item_id", itemId);

    if (error) {
      console.error("Error fetching class average:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    if (!data || data.length === 0) {
      return res.json({
        success: true,
        data: {
          average_percentage: 0,
          total_students: 0,
          scores_entered: 0,
        },
      });
    }

    const scores = data.map(
      (score) => (score.points_earned / score.points_possible) * 100,
    );
    const average =
      scores.reduce((sum, score) => sum + score, 0) / scores.length;

    res.json({
      success: true,
      data: {
        average_percentage: Math.round(average * 100) / 100,
        total_students: data.length,
        scores_entered: data.filter((score) => score.points_earned > 0).length,
      },
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Recalculate student grade manually
app.post("/recalculateGrade", async (req, res) => {
  try {
    const { student_id, course_id, quarter_id } = req.body;

    if (!student_id || !course_id || !quarter_id) {
      return res.status(400).json({
        success: false,
        error: "Student ID, course ID, and quarter ID are required",
      });
    }

    // Call the calculation function
    const { error } = await supabase.supabase.rpc("calculate_student_grade", {
      p_student_id: student_id,
      p_course_id: course_id,
      p_quarter_id: quarter_id,
    });

    if (error) {
      console.error("Error recalculating grade:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({
      success: true,
      message: "Grade recalculated successfully",
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Delete assessment item
app.delete("/deleteAssessmentItem/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;

    if (!itemId) {
      return res.status(400).json({
        success: false,
        error: "Item ID is required",
      });
    }

    // Check if there are any scores for this item
    const { data: existingScores } = await supabase.supabase
      .from("ds_student_scores")
      .select("score_id")
      .eq("item_id", itemId)
      .limit(1);

    if (existingScores && existingScores.length > 0) {
      return res.status(400).json({
        success: false,
        error:
          "Cannot delete assessment item that has student scores. Please deactivate instead.",
      });
    }

    const { error } = await supabase.supabase
      .from("ds_assessment_items")
      .delete()
      .eq("item_id", itemId);

    if (error) {
      console.error("Error deleting assessment item:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({
      success: true,
      message: "Assessment item deleted successfully",
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

// Update assessment item
// Update assessment item
app.put("/updateAssessmentItem/:itemId", async (req, res) => {
  try {
    const { itemId } = req.params;
    const updates = req.body;

    console.log("Updating assessment item:", itemId);
    console.log("Updates:", updates);

    if (!itemId) {
      return res.status(400).json({
        success: false,
        error: "Item ID is required",
      });
    }

    // First check if the item exists
    const { data: existingItem, error: checkError } = await supabase.supabase
      .from("ds_assessment_items")
      .select("item_id")
      .eq("item_id", itemId)
      .maybeSingle();

    if (checkError) {
      console.error("Error checking item existence:", checkError);
      return res
        .status(500)
        .json({ success: false, error: checkError.message });
    }

    if (!existingItem) {
      return res.status(404).json({
        success: false,
        error: `Assessment item with ID ${itemId} not found`,
      });
    }

    // Now perform the update
    const { data, error } = await supabase.supabase
      .from("ds_assessment_items")
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq("item_id", itemId)
      .select();

    if (error) {
      console.error("Error updating assessment item:", error);
      return res.status(500).json({ success: false, error: error.message });
    }

    res.json({
      success: true,
      message: "Assessment item updated successfully",
      data: data[0], // Return first item from array
    });
  } catch (err) {
    console.error("Unexpected error:", err);
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});
// PATCH /renameHymnFolder/:id
app.patch("/renameHymnFolder/:id", async (req, res) => {
  b;
  const { name } = req.body;
  const { data, error } = await supabase.supabase
    .from("hymns_folder")
    .update({ name })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

// PATCH /assignHymnFolder
app.patch("/assignHymnFolder", async (req, res) => {
  const { file_path, folder_id } = req.body;
  const { data, error } = await supabase.supabase
    .from("deacons_school_hymns")
    .update({ folder_id: folder_id ?? null })
    .eq("tune_file_path", file_path)
    .select()
    .single();
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data });
});
app.get("/getTuneFiles", async (req, res) => {
  try {
    const search = (req.query.search || "").trim();

    const { data, error } = await supabaseTunes.rpc("search_tune_files", {
      search_query: search,
    });

    if (error) throw new Error(error.message);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
async function syncHymnIdToSevenTunes(newPaths, oldPaths, hymnId) {
  const safeNew = Array.isArray(newPaths) ? newPaths : [];
  const safeOld = Array.isArray(oldPaths) ? oldPaths : [];

  const pathsToRemove = safeOld.filter((p) => !safeNew.includes(p));
  const pathsToAdd = safeNew.filter((p) => !safeOld.includes(p));

  // Remove hymnId from any paths that were unlinked
  for (const filePath of pathsToRemove) {
    const { data: row } = await supabaseTunes
      .from("seven_tunes_books")
      .select("id, hymn_ids")
      .eq("file_path", filePath)
      .single();

    if (row) {
      await supabaseTunes
        .from("seven_tunes_books")
        .update({
          hymn_ids: (row.hymn_ids || []).filter((id) => id !== hymnId),
        })
        .eq("id", row.id);
    }
  }

  // Add hymnId to any paths that were newly linked
  for (const filePath of pathsToAdd) {
    const { data: row } = await supabaseTunes
      .from("seven_tunes_books")
      .select("id, hymn_ids")
      .eq("file_path", filePath)
      .single();

    if (row) {
      const existing = row.hymn_ids || [];
      if (!existing.includes(hymnId)) {
        await supabaseTunes
          .from("seven_tunes_books")
          .update({ hymn_ids: [...existing, hymnId] })
          .eq("id", row.id);
      }
    }
  }
}

const BUCKET = "deacons_school_hymns_files";

app.get("/download-hazzat", async (req, res) => {
  try {
    const allFiles = await listAllFiles();

    if (allFiles.length === 0) {
      return res.status(404).json({ error: "No files found in bucket" });
    }

    const outputDir = path.join(__dirname, "downloads", BUCKET);
    const results = { success: [], failed: [] };

    for (const filePath of allFiles) {
      try {
        const { data, error } = await supabase.supabase.storage
          .from(BUCKET)
          .download(filePath);

        if (error) throw error;

        const localPath = path.join(outputDir, filePath);
        fs.mkdirSync(path.dirname(localPath), { recursive: true });

        const buffer = Buffer.from(await data.arrayBuffer());
        fs.writeFileSync(localPath, buffer);

        results.success.push(filePath);
        console.log(`✓ ${filePath}`);
      } catch (err) {
        console.error(`✗ ${filePath}:`, err.message);
        results.failed.push({ file: filePath, error: err.message });
      }
    }

    return res.json({
      total: allFiles.length,
      downloaded: results.success.length,
      failed: results.failed.length,
      savedTo: outputDir,
      results,
    });
  } catch (err) {
    console.error("Download error:", err);
    return res.status(500).json({ error: err.message });
  }
});

async function listAllFiles(folder = "") {
  const { data, error } = await supabase.supabase.storage
    .from(BUCKET)
    .list(folder, { limit: 1000, offset: 0 });

  if (error) throw error;
  if (!data) return [];

  let files = [];

  for (const item of data) {
    const itemPath = folder ? `${folder}/${item.name}` : item.name;

    if (item.metadata) {
      files.push(itemPath);
    } else {
      const nested = await listAllFiles(itemPath);
      files = files.concat(nested);
    }
  }

  return files;
}

module.exports = app;
