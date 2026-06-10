const express = require("express");
const app = express();
const bodyParser = require("body-parser");
const supabase = require("../config/config");

const getStripeClient = () => {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeSecretKey) {
    return null;
  }

  return require("stripe")(stripeSecretKey);
};

// Webhook signature secret (from Stripe Dashboard)
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Raw body for signature verification
app.post(
  "/webhook",
  bodyParser.raw({ type: "application/json" }),
  async (req, res) => {
    const stripe = getStripeClient();
    if (!stripe || !webhookSecret) {
      return res.status(503).json({
        success: false,
        error: "Stripe webhook is not configured on the server",
      });
    }

    const sig = req.headers["stripe-signature"];

    try {
      const event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        webhookSecret,
      );

      // Handle payment_intent.succeeded events
      if (event.type === "payment_intent.succeeded") {
        const paymentIntent = event.data.object;
        console.log("✅ Payment succeeded:", paymentIntent.id);

        // Update the registration with payment confirmation
        const { data, error } = await supabase.supabase
          .from("altar_responses_course")
          .update({
            payment_confirmed: true,
            payment_confirmed_at: new Date().toISOString(),
          })
          .eq("payment_intent_id", paymentIntent.id);

        if (error) {
          console.error("Error updating registration:", error);
          return res.status(500).json({ success: false, error: error.message });
        }

        return res
          .status(200)
          .json({ success: true, message: "Payment confirmed" });
      }

      // Handle payment_intent.payment_failed events
      if (event.type === "payment_intent.payment_failed") {
        const paymentIntent = event.data.object;
        console.log("❌ Payment failed:", paymentIntent.id);

        // Update registration with failure status
        const { data, error } = await supabase.supabase
          .from("altar_responses_course")
          .update({
            payment_status: "failed",
            payment_error: paymentIntent.last_payment_error?.message,
          })
          .eq("payment_intent_id", paymentIntent.id);

        if (error) {
          console.error("Error updating failed payment:", error);
        }

        return res.status(200).json({ success: true });
      }

      // Acknowledge receipt of the event
      return res.status(200).json({ received: true });
    } catch (err) {
      console.error("Webhook error:", err);
      return res.status(400).json({ error: err.message });
    }
  },
);

module.exports = app;
