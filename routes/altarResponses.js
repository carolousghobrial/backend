const express = require("express");
const bp = require("body-parser");
const app = express();
const supabase = require("../config/config");

const getStripeClient = () => {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return null;
  }

  return require("stripe")(stripeSecretKey);
};

// Create a Stripe PaymentIntent for $5 registration fee
app.post("/createPaymentIntent", async (req, res) => {
  try {
    const stripe = getStripeClient();
    if (!stripe) {
      return res.status(503).json({
        success: false,
        message: "Stripe is not configured on the server",
      });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: 500, // $5.00 in cents
      currency: "usd",
      description: "Altar Responses Course Registration Fee",
    });

    return res.status(200).json({
      success: true,
      clientSecret: paymentIntent.client_secret,
    });
  } catch (err) {
    console.error("Error creating payment intent:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to initiate payment",
      error: err.message,
    });
  }
});

app.post("/addAltarResponse", async (req, res) => {
  try {
    const stripe = getStripeClient();
    if (!stripe) {
      return res.status(503).json({
        success: false,
        message: "Stripe is not configured on the server",
      });
    }

    const { full_name, phone_number, dob, church, payment_intent_id } =
      req.body;

    // Validate required fields
    if (!payment_intent_id) {
      return res.status(400).json({
        success: false,
        message: "Payment is required to complete registration",
      });
    }

    // Verify payment was successful with Stripe
    const paymentIntent =
      await stripe.paymentIntents.retrieve(payment_intent_id);
    if (!paymentIntent || paymentIntent.status !== "succeeded") {
      return res.status(402).json({
        success: false,
        message:
          "Payment not completed. Please complete payment before registering.",
      });
    }

    // Validate required fields
    if (!full_name || !phone_number || !dob || !church) {
      return res.status(400).json({
        success: false,
        message:
          "All fields (full_name, phone_number, dob, church) are required",
      });
    }

    // Validate phone number format (basic validation)
    if (!/^[\+]?[(]?[\d\s\-\(\)]{10,}$/.test(phone_number)) {
      return res.status(400).json({
        success: false,
        message: "Invalid phone number format",
      });
    }

    // Validate date format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      return res.status(400).json({
        success: false,
        message: "Date of birth must be in YYYY-MM-DD format",
      });
    }

    const altarResponse = {
      full_name: full_name.trim(),
      phone_number: phone_number.trim(),
      dob: dob,
      church: church.trim(),
      payment_intent_id: payment_intent_id,
    };

    const { data, error } = await supabase.supabase
      .from("altar_responses_course")
      .insert([altarResponse]);

    if (error) {
      console.error("Error inserting altar response:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to submit Altar Responses Course form",
        error: error.message,
      });
    }

    return res.status(201).json({
      success: true,
      message: "Altar Responses Course form submitted successfully",
      data: data,
    });
  } catch (err) {
    console.error("Error processing request:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while processing Altar Responses Course form",
      error: err.message,
    });
  }
});

app.get("/getAltarResponses", async (req, res) => {
  try {
    const { data, error } = await supabase.supabase
      .from("altar_responses_course")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Error fetching altar responses:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to fetch Altar Responses",
        error: error.message,
      });
    }

    return res.status(200).json({
      success: true,
      data: data,
    });
  } catch (err) {
    console.error("Error processing request:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while fetching Altar Responses",
      error: err.message,
    });
  }
});

app.delete("/deleteAltarResponse/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const { data, error } = await supabase.supabase
      .from("altar_responses_course")
      .delete()
      .eq("id", id);

    if (error) {
      console.error("Error deleting altar response:", error);
      return res.status(500).json({
        success: false,
        message: "Failed to delete Altar Response",
        error: error.message,
      });
    }

    return res.status(200).json({
      success: true,
      message: "Altar Response deleted successfully",
      data: data,
    });
  } catch (err) {
    console.error("Error processing request:", err);
    return res.status(500).json({
      success: false,
      message: "Server error while deleting Altar Response",
      error: err.message,
    });
  }
});

module.exports = app;
