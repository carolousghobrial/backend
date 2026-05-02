const express = require("express");
const bp = require("body-parser");
const app = express();
const supabase = require("../config/config");
const { decode } = require("base64-arraybuffer");
app.use(bp.json());
app.use(bp.urlencoded({ extended: true }));

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token)
    return res.status(401).json({ success: false, error: "Unauthorized" });
  try {
    const {
      data: { user },
      error,
    } = await supabase.supabase.auth.getUser(token);
    if (error || !user)
      return res
        .status(401)
        .json({ success: false, error: "Invalid or expired token" });
    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    return res
      .status(403)
      .json({ success: false, error: "Token verification failed" });
  }
};

app.post("/addMonthlyBlogArticle", authenticateToken, async (req, res) => {
  const {
    english_title,
    english_author,
    english_article,
    arabic_title,
    arabic_author,
    arabic_article,
    view_month,
    image_url,
  } = req.body;
  if (!english_title || !view_month) {
    return res
      .status(400)
      .json({
        success: false,
        error: "english_title and view_month are required",
      });
  }
  try {
    let finalImageUrl = typeof image_url === "string" ? image_url : null;

    const blog = {
      english_title,
      english_author,
      english_article,
      arabic_title,
      arabic_author,
      arabic_article,
      view_month,
    };
    const { data, error } = await supabase.supabase
      .from("monthly_blog_article")
      .insert([blog])
      .select()
      .single();
    if (error) throw error;

    if (image_url && typeof image_url !== "string") {
      const { error: uploadError } = await supabase.supabase.storage
        .from("monthly_blog_articles")
        .upload(`${data.id}`, decode(image_url), {
          contentType: "image/png",
          upsert: true,
        });
      if (!uploadError) {
        const { data: urlData } = supabase.supabase.storage
          .from("monthly_blog_articles")
          .getPublicUrl(`${data.id}`);
        finalImageUrl = urlData.publicUrl;
      }
    }

    if (finalImageUrl) {
      await supabase.supabase
        .from("monthly_blog_article")
        .update({ image_url: finalImageUrl })
        .eq("id", data.id);
    }

    res
      .status(201)
      .json({ success: true, data: { ...data, image_url: finalImageUrl } });
  } catch (error) {
    console.error("addMonthlyBlogArticle error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/updateMonthlyBlogArticle", authenticateToken, async (req, res) => {
  const {
    id,
    english_title,
    english_author,
    english_article,
    arabic_title,
    arabic_author,
    arabic_article,
    view_month,
    image_url,
  } = req.body;
  if (!id)
    return res.status(400).json({ success: false, error: "id is required" });
  try {
    let finalImageUrl = typeof image_url === "string" ? image_url : undefined;

    if (image_url && typeof image_url !== "string") {
      const { error: uploadError } = await supabase.supabase.storage
        .from("monthly_blog_articles")
        .upload(`${id}`, decode(image_url), {
          contentType: "image/png",
          upsert: true,
        });
      if (!uploadError) {
        const { data: urlData } = supabase.supabase.storage
          .from("monthly_blog_articles")
          .getPublicUrl(`${id}`);
        finalImageUrl = urlData.publicUrl;
      }
    }

    const updates = {
      english_title,
      english_author,
      english_article,
      arabic_title,
      arabic_author,
      arabic_article,
      view_month,
    };
    if (finalImageUrl !== undefined) updates.image_url = finalImageUrl;

    const { data, error } = await supabase.supabase
      .from("monthly_blog_article")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    console.error("updateMonthlyBlogArticle error:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/getMonthlyBlogArticle/:id", async (req, res) => {
  const { id } = req.params;
  const { data, error } = await supabase.supabase
    .from("monthly_blog_article")
    .select(
      "id, english_title, english_author, english_article, arabic_title, arabic_author, arabic_article, image_url, view_month",
    )
    .eq("id", id)
    .single();
  if (error)
    return res.status(404).json({ success: false, error: "Not found" });
  res.json({ success: true, data });
});

app.get("/getCurrentdMonthlyBlogArticle", async (req, res) => {
  const cur_month = String(new Date().getMonth());
  const { data, error } = await supabase.supabase
    .from("monthly_blog_article")
    .select(
      "id, english_title, english_author, english_article, arabic_title, arabic_author, arabic_article, image_url, view_month",
    )
    .eq("view_month", cur_month)
    .single();
  if (error)
    return res.status(404).json({ success: false, error: "Not found" });
  res.json({ success: true, data });
});

app.get("/getMonthlyBlogArticles", async (req, res) => {
  const { data, error } = await supabase.supabase
    .from("monthly_blog_article")
    .select(
      "id, english_title, english_author, arabic_title, arabic_author, image_url, view_month",
    )
    .order("view_month", { ascending: false });
  if (error)
    return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, data });
});

app.delete(
  "/deleteMonthlyBlogArticle/:id",
  authenticateToken,
  async (req, res) => {
    const { id } = req.params;
    // Remove image from storage (best-effort, don't fail if missing)
    await supabase.supabase.storage
      .from("monthly_blog_articles")
      .remove([`${id}`]);
    const { error } = await supabase.supabase
      .from("monthly_blog_article")
      .delete()
      .eq("id", id);
    if (error)
      return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true });
  },
);

module.exports = app;

module.exports = app;
