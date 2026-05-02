---
description: "Use when creating, editing, or reviewing Express routes, middleware, Supabase queries, or backend Node.js code. Covers route patterns, auth, Supabase client usage, error handling, and response format."
applyTo: "**/*.js"
---

# Backend (Express + Supabase) Conventions

## Route File Pattern
```js
const express = require('express');
const bp = require('body-parser');
const app = express();
const supabase = require('../config/config');

app.get('/getAll<X>s', async (req, res) => { ... });
app.post('/add<X>', async (req, res) => { ... });

module.exports = app;
```
Mount in `app.js` via `app.use('/prefix', require('./routes/file'))`.

## Supabase Usage
- Import: `const supabase = require('../config/config');`
- Access: `supabase.supabase.from('table_name')...`
- Always destructure `{ data, error }` and check `if (error)` before using `data`.

## Standard Response Shapes
```js
res.status(200).json({ success: true, data });   // success
res.status(201).json({ success: true, data });   // created
res.status(400).json({ success: false, error: 'message' }); // client error
res.status(401).json({ success: false, error: 'Unauthorized' });
res.status(500).json({ success: false, error: error.message });
```

## Security Rules
- Never log or return the Supabase service-role key.
- Validate all user input before inserting into the database.
- Use parameterized Supabase queries — never string-interpolate user values.
- CORS is configured in `app.js`; do not override per-route.

## Push Notifications (announcements)
After mutating an announcement, send via:
`POST https://stgntbackend-a14a35aa352d.herokuapp.com/notifications/sendPushNotification`
Wrap in try/catch — do NOT fail the main operation if the notification call fails.
