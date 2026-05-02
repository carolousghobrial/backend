---
name: new-api-route
description: "Create a new Express route file and register it in the St. George Church backend. Use when adding a new backend resource, endpoint, or CRUD feature using Express and Supabase."
argument-hint: "Resource name and operations, e.g. 'donations — GET list, POST add, DELETE remove'"
---

# New Express API Route

## When to Use
- Adding a new resource endpoint to the backend
- Adding CRUD operations for a new Supabase table
- Extending an existing route file with new endpoints

## Procedure

### 1. Plan the Resource
- Resource name (camelCase file, e.g. `donations.js`).
- HTTP verbs needed: GET, POST, PUT/PATCH, DELETE.
- Supabase table name.
- Whether endpoints need JWT auth.

### 2. Create `backend/routes/<resourceName>.js`

```js
const express = require('express');
const bp = require('body-parser');
const app = express();
const supabase = require('../config/config');

app.use(bp.json());
app.use(bp.urlencoded({ extended: true }));

// GET — list all
app.get('/getAll<Resource>s', async (req, res) => {
  try {
    const { data, error } = await supabase.supabase
      .from('<table_name>')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.status(200).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST — add
app.post('/add<Resource>', async (req, res) => {
  try {
    const { field1, field2 } = req.body;
    const { data, error } = await supabase.supabase
      .from('<table_name>')
      .insert([{ field1, field2, created_at: new Date().toISOString() }])
      .select().single();
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.status(201).json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE
app.delete('/delete<Resource>/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { error } = await supabase.supabase
      .from('<table_name>').delete().eq('id', id);
    if (error) return res.status(500).json({ success: false, error: error.message });
    res.status(200).json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = app;
```

### 3. Register in `backend/app.js`
```js
const <resourceName> = require('./routes/<resourceName>');
app.use('/<resourceName>', <resourceName>);
```

### 4. JWT Protection (when needed)
```js
const jwt = require('jsonwebtoken');
const verifyToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ success: false, error: 'Unauthorized' });
  try { req.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ success: false, error: 'Invalid token' }); }
};
```

### 5. Checklist
- [ ] All queries check `if (error)` before using `data`
- [ ] All handlers wrapped in `try/catch`
- [ ] User input never string-interpolated into queries
- [ ] Route registered in `app.js`
