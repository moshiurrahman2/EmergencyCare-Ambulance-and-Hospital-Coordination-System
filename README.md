# EmergencyCare

EmergencyCare is an ambulance-sharing app. The project is split into a React +
Vite client and a Node.js + Express API, with a MySQL schema.

## Requirements

- Node.js 20 or newer and npm
- MySQL 8.0 or newer, or MariaDB 10.4 or newer (as bundled with XAMPP)

## 1. Create the database

With XAMPP, start **Apache** and **MySQL**, open `http://localhost/phpmyadmin`,
select the **SQL** tab, and create the database with:

```sql
CREATE DATABASE emergency_care
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
```

## 2. Create the tables

In phpMyAdmin, select the new `emergency_care` database, open **Import**, choose
`server\database\schema.sql`, and select **Import**. Alternatively, from the
project root in PowerShell, pipe the schema into the MySQL client:

```powershell
Get-Content -Raw server\database\schema.sql | mysql -u root -p emergency_care
```

Enter your MySQL password when prompted. If the XAMPP MySQL port differs from
3306, use that port when importing and set the same port in `server\.env`.
When updating an existing installation, import the current `schema.sql` into
the existing `emergency_care` database to apply its additive fare columns and
settings table. Back up the database first; do not drop it.

## 3. Configure the API

Copy `server\.env.example` to `server\.env`, then set `DB_HOST`, `DB_PORT`,
`DB_USER`, `DB_PASSWORD`, and `DB_NAME` to match XAMPP. XAMPP commonly uses
`localhost`, port `3306`, user `root`, and a blank password unless you configured
one. Keep `server\.env` private; it is ignored by Git.

```powershell
Copy-Item server\.env.example server\.env
```

## 4. Install dependencies

Open a terminal in each folder and install its dependencies:

```powershell
cd server
npm.cmd install
```

In a second terminal:

```powershell
cd client
npm.cmd install
```

## 5. Run the app

Start the API from the `server` folder:

```powershell
npm.cmd run dev
```

Start the client from the `client` folder:

```powershell
npm.cmd run dev
```

Open the local URL printed by Vite. The API health check is available at
`http://localhost:5000/api/health`; it reports whether the API can connect to
MySQL.

## Phase 2: account setup

Add these settings to `server\.env` (keep the values private):

```env
JWT_SECRET=use_a_random_secret_at_least_32_characters_long
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=use_a_strong_password_at_least_12_characters_long
```

Use a unique JWT secret with at least 32 characters and your own admin
credentials. The admin password must be at least 12 characters. Generate a
secret in PowerShell with:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

From the `server` folder, create the admin account:

```powershell
npm.cmd run seed:admin
```

The seed command safely leaves an existing account unchanged. Admin accounts
cannot be created through public registration.

Restart the API after adding `JWT_SECRET`. Open the Vite client and use **Create
an account** for a patient, dispatcher, or ambulance user. After registration,
log in with that same email and password. The app directs each role to its separate workspace route. The admin dashboard, patient app, ambulance flow, and dispatcher flow are
available.

API routes:

- `POST /api/auth/signup` creates patient, dispatcher, or ambulance accounts.
- `POST /api/auth/login` returns a 12-hour JWT and the signed-in user's role.
- `GET /api/auth/me` returns the current active user and requires a Bearer token.

Passwords are hashed with bcrypt. API routes enforce authentication and role
authorization; admin is not an allowed public sign-up role.

## Phase 3: admin dashboard

Sign in with the seeded admin email and password to open the web dashboard.
The dashboard shows patient, dispatcher, ambulance, and active-trip counts;
pending ambulance and dispatcher applications; user management; and the trip
list. Approval decisions record the reviewing admin, time, and rejection
reason. A rejection requires a reason.

Admins can search and filter accounts, view account/profile details, suspend
or reactivate accounts, and delete accounts. The current admin cannot suspend
or delete itself, and the last active admin cannot be suspended or deleted.
Accounts assigned to an open request or active trip cannot be suspended or
deleted until it is resolved. Patient accounts with trip history cannot be
hard-deleted because that would break the database's trip-history constraint;
suspend those accounts instead.
The approval queue includes the details currently captured by the database.
Ambulance verification images are available to admins through a protected
document endpoint and are not served as public static files.

Admin API endpoints require an active admin JWT:

- `GET /api/admin/dashboard` returns account, active-trip, and pending-review counts.
- `GET /api/admin/approvals?role=ambulance|dispatcher` lists pending applications.
- `PATCH /api/admin/approvals/:role/:userId` approves or rejects an application.
- `GET /api/admin/users` lists accounts with search, filters, and pagination.
- `GET /api/admin/users/:userId` returns account and available profile details.
- `PATCH /api/admin/users/:userId/status` activates or suspends an account.
- `DELETE /api/admin/users/:userId` deletes an account when database history permits.
- `GET /api/admin/trips` lists trips with status filtering and pagination.
- `GET /api/admin/fare-rates` reads the current ambulance rates.
- `PUT /api/admin/fare-rates` updates rates for future fare estimates.

Approval and trip records will be empty until the corresponding dispatcher,
ambulance, and patient flows create profile and trip data in later phases.

## Phase 4: patient app

Patients have a mobile-friendly Home, Activity, and Profile navigation. Home
lets them request Basic, ICU, or Freezer ambulance service, describe symptoms,
enter a destination, and capture pickup coordinates with browser location or
manual latitude/longitude. The patient name and phone are taken from the
account profile when the request is saved. Activity lists the patient's own
requests and opens request-status details. The current active request refreshes
periodically and shows assigned driver details and the latest saved ambulance
location when available. Socket.IO sends live status and location updates, with
periodic refresh retained as a fallback. Before sending a request, the patient
can estimate a cash fare from the routed road distance and ambulance type. The
destination is geocoded automatically after the patient pauses typing, and the
fare is recalculated when the destination, pickup coordinates, or ambulance
type changes. The resolved destination coordinates are shown alongside the
estimate.
initial rates are Basic ৳60/km, ICU ৳80/km, and Freezer ৳100/km, with no base
fare; distance is rounded to two decimal places and fare to the nearest taka.
The interface shows the estimated distance and total fare without exposing the
per-kilometer rate to patients, dispatchers, or ambulance drivers.
The quoted fare and rate are saved with the request. The patient pays the
assigned ambulance driver directly in cash after the trip; the driver records
collection in the app. If routing is unavailable, the patient can explicitly
continue without an estimate so an emergency request is not blocked; the app
then does not record an in-app fare and the driver and patient must agree on
cash directly.

The Profile screen displays and edits patient name and phone. Email is
read-only in this phase. Patients may cancel a request while it is still searching; requests cannot be
cancelled from this screen after a dispatcher assigns an ambulance.

Patient API routes require an active patient JWT:

- `GET /api/patient/profile` returns the signed-in patient's profile.
- `PATCH /api/patient/profile` updates the name and phone.
- `GET /api/patient/requests` lists only the signed-in patient's requests.
- `POST /api/patient/fare-estimate` returns a signed, 15-minute cash fare quote.
- `POST /api/patient/requests` validates and creates an ambulance request.
- `GET /api/patient/requests/:requestId` returns that patient's request status.
- `PATCH /api/patient/requests/:requestId/cancel` cancels an eligible request.

The patient flow requires the Phase 1 database schema. Place names are looked
up from coordinates through the authenticated `GET /api/location/reverse` API.
The server uses OpenStreetMap Nominatim with an in-memory cache and serialized
requests to respect its usage policy. Coordinate lookups are sent to
OpenStreetMap; place names display OpenStreetMap attribution in the app. The
patient can still enter a pickup address manually if lookup is unavailable.
Fare estimates geocode the destination with Nominatim and calculate road
distance using the public OSRM demo router. This public routing setup is for
prototype use only and has no production availability guarantee. For deployment,
host OSRM yourself or choose a commercial routing provider. The user-entered
destination and endpoint coordinates are sent to these services; do not include
sensitive health information in the destination field.

Admins can change the Basic, ICU, and Freezer per-kilometer rates in the
dashboard's Pricing section. Rate changes apply only to new estimates. Existing
quotes remain fixed. This prototype records cash collection; it does not
process card or mobile-money payments.

## Phase 6: dispatcher flow

Dispatcher accounts submit their name, age, addresses, phone, and NID number
for admin approval. Pending dispatchers cannot access the request queue.
Approved dispatchers are marked online while their workspace is open and send
a heartbeat every 20 seconds. Use the availability switch to go offline.
Presence expires after 60 seconds without a heartbeat. If no dispatcher is
online when a patient creates a request, it remains searching until a dispatcher
comes online and assigns an ambulance.

Online dispatchers can claim an unassigned searching request, view eligible
online ambulances ranked by Haversine distance, and assign the closest available
ambulance. Assignment immediately starts the trip; only the assigned ambulance
can see patient details. Ambulance drivers cannot accept or decline requests.
ETA is a rough estimate based on a 30 km/h average road speed; it does not use
traffic or road routing. Active trips assigned to the dispatcher remain visible
when the dispatcher is offline. Requests can be claimed and assigned only while
online. Request/trip screens refresh periodically, with real-time updates in
Phase 7.

Dispatchers do not create a second request record or change patient ownership.
Claiming and assignment are protected by transactions and re-check request and
ambulance availability.

Phase 6 adds dispatcher online-presence columns. For a database created before
this phase, run this once in phpMyAdmin's SQL tab before restarting the API:

```sql
ALTER TABLE dispatcher_profiles
  ADD COLUMN is_online BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN last_seen_at TIMESTAMP NULL;
```

Dispatcher API routes require an active dispatcher JWT:

- `GET /api/dispatcher/profile` returns profile and approval state.
- `PUT /api/dispatcher/profile` submits or resubmits dispatcher details.
- `PATCH /api/dispatcher/presence` updates online/offline availability.
- `GET /api/dispatcher/work` lists unassigned/owned requests and owned active trips.
- `POST /api/dispatcher/requests/:requestId/claim` claims an unassigned request.
- `GET /api/dispatcher/requests/:requestId/ambulances` ranks available ambulances.
- `POST /api/dispatcher/requests/:requestId/assign` assigns the closest ambulance.

## Phase 5: ambulance flow

Ambulance accounts submit driver name, vehicle number, addresses, phone, NID,
driving licence number, and NID/licence photos. Images must be actual JPG, PNG,
or WebP files and are limited to 5 MB each. They are stored under the ignored
`server/uploads/ambulance-documents` directory and are never exposed by static
file serving. Admins can preview them from the approval queue using an
admin-only, authenticated endpoint.

New and rejected applications remain offline until admin approval. Rejected
drivers can correct the profile and resubmit it. Approved drivers can go online
after granting location permission; location updates are saved periodically
while online or on an active trip. Online ambulances wait for dispatcher
assignments and see patient information only for trips assigned to them.
Ambulance drivers cannot accept or decline patient requests; dispatchers choose
and assign the closest available ambulance. Drivers can advance an assigned
trip through picked up, arrived at hospital, and completed.

Ambulance API routes require an active ambulance JWT:

- `GET /api/ambulance/profile` returns the signed-in ambulance's review state.
- `PUT /api/ambulance/profile` submits or resubmits profile details and photos.
- `GET /api/ambulance/work` returns the assigned active trip, if any.
- `GET /api/ambulance/activity` returns trips assigned to this ambulance.
- `PATCH /api/ambulance/availability` turns the approved ambulance online/offline.
- `POST /api/ambulance/location` saves a validated location update.
- `PATCH /api/ambulance/requests/:requestId/step` advances an assigned trip in order.
- `PATCH /api/ambulance/requests/:requestId/cash-collected` records that cash was
  received after an assigned trip is completed.

## Phase 7: live trip updates

The API and client use Socket.IO for authenticated trip updates. Patients,
assigned dispatchers, and assigned ambulances can subscribe only to requests
they own or are assigned to. Ambulance location changes and trip status
transitions are pushed to each subscribed trip. Patient and dispatcher screens
keep periodic refresh enabled as a reconnect fallback. Browser location sharing
still requires permission and an active internet connection.

Ambulance drivers advance trip steps in order: accepted (heading to the
patient), picked up, arrived at hospital, and completed. These steps use the
existing request statuses, so no database schema update is required.

## Trip notifications

When a dispatcher assigns an ambulance, EmergencyCare saves an in-app
notification for the patient, assigned dispatcher, ambulance driver, and active
admins. Signed-in users can view alerts from **Notifications** in their
workspace. Browser push alerts are optional; in-app alerts work without VAPID
keys. SMS delivery is not configured and requires choosing an SMS provider.

For an existing database, re-import `server\database\schema.sql` using the
instructions in **2. Create the tables**. This adds the notification and push
subscription tables using `CREATE TABLE IF NOT EXISTS` and preserves existing
data.

To enable browser push, open a terminal in `server` and run:

```powershell
npm.cmd run generate:vapid
```

Copy the three printed settings into `server\.env`:

```env
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:admin@example.com
```

Use a contact address you manage for `VAPID_SUBJECT`, keep the private key
secret, and restart the API. Sign into each browser/device that should receive
alerts, open **Notifications**, and choose **Enable browser alerts**. Allow
notifications in the browser prompt. Browser push requires HTTPS in production
(localhost is permitted for local testing); in-app notifications require the
API, database, and an active signed-in session.

## Phase 8: reliability and security notes

The API sends standard security headers, hides Express's `X-Powered-By`
header, limits login and signup attempts to 10 per IP address in a 15-minute
window, validates request inputs, and keeps database queries parameterized.
Socket.IO requires a valid JWT and checks request ownership before joining trip
rooms. Suspending or deleting an account disconnects its sockets; users assigned
to open requests or active trips cannot be suspended or deleted until those
requests are resolved. Deleting an ambulance account also removes its saved
verification photos.

For day-to-day testing, keep XAMPP MySQL running, start the API and client in
separate terminals, and open the Vite URL in a browser. Check
`http://localhost:5000/api/health` for database connectivity. If health reports
an error, compare `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME`
in `server\.env` with the MySQL settings in XAMPP. Browser location features
need a secure context (localhost is allowed) and location permission.
