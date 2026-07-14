# St. George Coptic Orthodox Church Nashville — Project Instructions

## Project Overview
Full-stack church management system for St. George Coptic Orthodox Church Nashville.
Three sub-projects share this workspace:
- `backend/` — Node.js / Express REST API, Supabase (PostgreSQL) as the database
- `frontend/stgntFrontend/` — Angular 17+ SPA (standalone components), deployed to Azure Static Web Apps
- `STGNT/` — React Native / Expo mobile app with Redux Persist and React Navigation

## Tech Stack Quick Reference

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express, Supabase JS client, JWT auth, body-parser |
| Frontend | Angular 17+ (standalone), SCSS, Angular Router, PWA |
| Mobile | React Native, Expo, Redux Toolkit, Redux Persist, Expo Notifications |
| Database | Supabase (PostgreSQL) — accessed via `supabase-js` |
| Auth | JWT tokens (localStorage on web, SecureStore on mobile) |
| Deploy (BE) | Heroku — `https://backend-iota-seven-18.vercel.app` |
| Deploy (FE) | Azure Static Web Apps — `https://stgeorgecocnashville.org` |

## Brand & Design Tokens
- Primary / dark red: `#8b181d`
- Secondary / pink-red: `#ff6b6b`
- Accent / gold: `#d4af37` / `#ffd700`
- Background (auth pages): `linear-gradient(135deg, #ecebe0 0%, #ecebe0 100%)`
- Card header gradient: `linear-gradient(135deg, #8b181d 0%, #ff6b6b 100%)`
- Church logo (Angular): `assets/Images/ChurchLogo.png`
- Church logo (RN): imported from `constants/images.js`

## Domain Features
- Announcements (bilingual EN/AR, push notification on publish)
- Church Services — listing and single-service detail
- Deacons School — levels, hymns, altar responses, memorizations, attendance, grading, calendar
- Sunday School — class listing, single class, admin panel
- Calendar — church and deacons-school events
- Prayer Requests, Diptych Forms, Visitation Requests, Confessions
- Users — JWT-based auth, role-based admin routes, Supabase profiles
- Deacons Corner — dashboard, hymns resources, Genethleyon calendar
- Monthly Blog

## Key Conventions
- Never expose the Supabase service-role key in client-side code.
- All protected backend routes validate `Authorization: Bearer <token>` JWT.
- Angular components are **standalone** — always include `standalone: true` and list `imports`.
- SCSS brand variables belong at the top of every new component's `.scss` file.
- Arabic + English bilingual fields are standard for user-facing announcement content.
- Do NOT rebuild or restart the dev server unless explicitly requested.
