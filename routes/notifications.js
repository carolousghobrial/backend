const { Expo } = require("expo-server-sdk");
const express = require("express");
const bodyParser = require("body-parser");
const app = express();
const expo = new Expo({
  accessToken: "wRoom62gGBmplz16uA9Irz34uZeVvrBpvEcQT9Dk",
});

const supabase = require("../config/config");
// Parse application/json
app.use(bodyParser.json());

// Parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: true }));

app.post("/registerToken", async (req, res) => {
  tokenUser = {
    token: req.body.token,
    generalNotificationsAllowed: req.body.generalNotificationsAllowed,
    userId: req.body.userId,
  };
  const { data, error } = await supabase.supabase
    .from("user_tokens")
    .insert([tokenUser])
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      const myData = await getUserByToken(tokenUser.token);
      res.send(myData);
    } else {
      res.status(500).send(error.message);
    }
  } else {
    res.send(data);
  }
});

const getGeneralNotificationsToken = async () => {
  const { data, error } = await supabase.supabase
    .from("user_tokens")
    .select()
    .eq("generalNotificationsAllowed", true);
  if (error) {
    return error;
  } else {
    return data;
  }
};
const getSubscribedServiceNotificationsToken = async (service_id) => {
  const { data, error } = await supabase.supabase
    .from("user_tokens")
    .select("token")
    .contains("service_subscribed", [service_id]);

  if (error) {
    return error;
  } else {
    return data;
  }
};
const getUserByToken = async (token) => {
  const { data, error } = await supabase.supabase
    .from("user_tokens")
    .select()
    .eq("token", token)
    .single();
  if (error) {
    return error;
  } else {
    return data;
  }
};

app.post("/sendPushNotification", async (req, res) => {
  try {
    const tokens = await getGeneralNotificationsToken();
    const { title, body } = req.body;

    const notifications = tokens.map((token) => ({
      to: token.token,
      sound: "default",
      title,
      body,
    }));

    await Promise.all(
      notifications.map((notification) =>
        expo.sendPushNotificationsAsync([notification])
      )
    );

    res.sendStatus(200);
  } catch (error) {
    console.error("Error sending push notifications:", error);
    res.sendStatus(500);
  }
});
app.post(
  "/sendSubscribedServicePushNotification/:service_id",
  async (req, res) => {
    try {
      const service_id = req.params.service_id;
      const tokens = await getSubscribedServiceNotificationsToken(service_id);
      const { title, body } = req.body;

      const notifications = tokens.map((token) => ({
        to: token.token,
        sound: "default",
        title,
        body,
      }));
      console.log(notifications);
      await Promise.all(
        notifications.map((notification) =>
          expo.sendPushNotificationsAsync([notification])
        )
      );

      res.sendStatus(200);
    } catch (error) {
      res.sendStatus(500);
    }
  }
);

app.post("/updateTokenStatus", async (req, res) => {
  // const tokens = await getGeneralNotificationsToken();
  const tokenId = req.body.tokenId;
  const tokenObj = {
    generalNotificationsAllowed: req.body.generalNotificationsAllowed,
    userId: req.body.userId,
  };
  const { data, error } = await supabase.supabase
    .from("user_tokens")
    .update(tokenObj)
    .eq("token", tokenId)
    .select()
    .single();

  if (error) {
    res.status(500).send(error.message);
  } else {
    res.send(data);
  }
});
app.post("/updateNotificationServices", async (req, res) => {
  const { service_id, token, action } = req.body;

  try {
    const { data, error } = await supabase.supabase
      .from("user_tokens")
      .select("service_subscribed")
      .eq("token", token)
      .single();

    if (error) {
      throw new Error(error.message);
    }

    let existingArray = data.service_subscribed || [];

    if (action) {
      existingArray.push(service_id);
    } else {
      existingArray = existingArray.filter((item) => item !== service_id);
    }

    const { data: updatedData, updateError } = await supabase.supabase
      .from("user_tokens")
      .update({ service_subscribed: existingArray })
      .eq("token", token);

    if (updateError) {
      throw new Error(updateError.message);
    }

    res.send(updatedData);
  } catch (error) {
    res.status(500).send(error.message);
  }
});

app.get("/getNotificationsUser/:token", async (req, res) => {
  // const tokens = await getGeneralNotificationsToken();
  const token = req.params.token;
  const myData = await getUserByToken(token);
  res.send(myData);
});

module.exports = app;
