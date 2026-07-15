---
name: new-rn-screen
description: "Create a new React Native screen for the STGNT Expo mobile app. Use when adding a screen, tab, or navigation entry to STGNT/, including Expo Router file setup, component structure, API helper, and optional Redux slice."
argument-hint: "Screen name and purpose, e.g. 'DonationScreen — list and submit church donations'"
---

# New React Native Screen

## When to Use
- Adding a new screen to the mobile app
- Creating a new bottom-tab entry
- Building a detail or form screen in any nav stack

## Procedure

### 1. Plan the Screen
- Screen name (PascalCase) and its folder: `(tabs)/`, `(home)/`, `(admin)/`, or `DeaconsSchool/`.
- What API data it needs and which `helpers/` service to use.
- Whether it needs Redux state or just local `useState`.

### 2. Create `STGNT/app/<folder>/<ScreenName>.js`

```jsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, SafeAreaView, StatusBar,
  ActivityIndicator, Platform
} from 'react-native';
import { useRouter } from 'expo-router';
import COLORS from '../../constants/colors';

export default function <ScreenName>Screen() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      // const result = await resourceService.getAll();
      // setData(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color={COLORS.secondary} />
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <View style={styles.content}>
        <Text style={styles.title}>Screen Title</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content:   { flex: 1, padding: 16 },
  centered:  { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background },
  title:     { fontSize: 24, fontWeight: 'bold', color: COLORS.text.primary, marginBottom: 16 },
});
```

### 3. Create or Update `STGNT/helpers/<resource>Service.js`
```js
import axios from 'axios';
const BASE_URL = 'https://backend-nine-cyan-78.vercel.app';

export const getAll<Resource>s = async (token) => {
  const res = await axios.get(`${BASE_URL}/<resource>/getAll<Resource>s`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.data;
};
```

### 4. New Tab (if needed) — add to `app/(tabs)/_layout.js`
```jsx
<Tabs.Screen
  name="<ScreenName>"
  options={{ title: 'Label', tabBarIcon: ({ color }) => <Ionicons name="icon-name" size={24} color={color} /> }}
/>
```

### 5. Redux Slice (if global state needed) — `STGNT/redux/<resource>Slice.js`
```js
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import * as service from '../helpers/<resource>Service';

export const fetch<Resource>s = createAsyncThunk('<resource>/fetchAll', async (token) =>
  service.getAll<Resource>s(token)
);

const slice = createSlice({
  name: '<resource>',
  initialState: { items: [], loading: false, error: null },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetch<Resource>s.pending, (s) => { s.loading = true; })
      .addCase(fetch<Resource>s.fulfilled, (s, a) => { s.loading = false; s.items = a.payload; })
      .addCase(fetch<Resource>s.rejected, (s, a) => { s.loading = false; s.error = a.error.message; });
  }
});
export default slice.reducer;
```
Then add the reducer to `redux/store.js`.

### 6. Checklist
- [ ] Screen wrapped in `<SafeAreaView>` + `<StatusBar>`
- [ ] Loading and error states handled
- [ ] API calls in `helpers/`, not inline in screen
- [ ] Styles via `StyleSheet.create({})` at the bottom
- [ ] Images from `constants/images.js`
