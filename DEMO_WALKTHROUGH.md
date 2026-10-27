# EmergencyCare local demo walkthrough

This guide documents a test-data-only browser demonstration of the existing
EmergencyCare project. The demo uses the isolated `emergency_care_demo`
database. The existing `emergency_care` database was not changed. No real
ambulance or emergency service was contacted.

## Architecture

- **Client:** React 18 with Vite. It serves the role-specific patient,
  dispatcher, ambulance, and admin workspaces. In development, requests under
  `/api` and `/socket.io` are proxied to the API on port 5000.
- **API:** Node.js and Express. It validates requests, authenticates users with
  JWTs, applies role checks, and reads/writes through the MySQL connection pool.
- **Database:** MySQL/MariaDB stores users, role profiles, requests, ambulance
  locations, fares, notifications, and hospital partners. The schema is in
  `server/database/schema.sql`.
- **Live updates:** Socket.IO carries trip and location updates between the
  API and connected clients.
- **Fare estimates:** The API geocodes the typed destination with Nominatim and
  requests a road route from OSRM. Fare is the routed distance multiplied by
  the configured rate for the selected ambulance type; this demo used the
  default Basic rate of ৳60/km.
- **Hospital integration:** An admin registers a facility and issues an API
  key. Hospital systems send that key in `X-Hospital-API-Key`; hospital-origin
  requests are stored separately from patient requests and appear in the
  dispatcher queue.

## Run locally

The project dependencies were already present. XAMPP MariaDB 10.4.32 was
started from its supplied `C:\xampp\mysql_start.bat` script after the Control
Panel start attempt did not produce a listener.

The isolated demo database has already been created and initialized from the
project schema. If recreating the demo from scratch, create only
`emergency_care_demo` and import `server\database\schema.sql` into that
database—do not import it into `emergency_care`.

In PowerShell, start the API with the database override in its own terminal:

```powershell
Set-Location 'E:\MIT Resources\3rd Semester\Project\server'
$env:DB_NAME = 'emergency_care_demo'
npm.cmd start
```

In a second terminal, start the client:

```powershell
Set-Location 'E:\MIT Resources\3rd Semester\Project\client'
npm.cmd run dev
```

Open `http://localhost:5173`. Check API and database connectivity at
`http://localhost:5000/api/health`; the verified response was
`{"status":"ok","database":"connected"}`. The API process must retain the
`DB_NAME=emergency_care_demo` override; it was set for the process only and no
environment file was edited.

## Demo accounts

All accounts below are synthetic and exist only in `emergency_care_demo`.
Use them only with the local demo application.

| Role | Email | Password |
|---|---|---|
| Patient | `demo.patient@example.test` | `DemoPatient!2026` |
| Dispatcher | `demo.dispatcher@example.test` | `DemoDispatch!2026` |
| Ambulance | `demo.ambulance@example.test` | `DemoAmbulance!2026` |
| Admin | `demo.admin@example.test` | `DemoAdmin!2026` |

The admin account and role profiles were created as test fixtures. The
dispatcher and ambulance applications began pending; an admin approved both
through the approval queue. They are approved now, so the queue no longer
contains those applications.

## Verified end-to-end patient/dispatch workflow

1. **Register and log in as the patient.** Patient signup through the browser
   succeeded. Admin accounts are not self-registering.
2. **Enter test pickup coordinates and a destination.** The demo used
   `23.8103, 90.4125` and the typed destination “Dhaka Medical College
   Hospital, Dhaka, Bangladesh.” The browser's live location was not used for
   this workflow.
3. **Display the fare estimate.** Nominatim and OSRM were reachable during the
   test. The Basic estimate was **12.03 km / ৳722**. This depends on external
   geocoding/routing availability and is not a guaranteed quote.
4. **Submit the synthetic request.** Request #1 was stored in the local demo
   database. The patient activity view showed it waiting for an ambulance.
5. **Take the request as dispatcher.** The approved dispatcher came online,
   claimed the request, and used **Find nearest ambulance**. The demo
   ambulance was the closest available match (0 km; approximate 1-minute ETA)
   and was assigned.
6. **Advance the ambulance trip.** The driver workspace showed the assignment,
   patient details, destination, and fare. The driver marked the patient
   picked up, arrived at the hospital, and completed the trip.
7. **Verify patient-visible completion.** The patient activity view showed the
   completed trip, assigned ambulance, routed distance, fare, and latest
   synthetic ambulance location.
8. **Cash collection remains pending.** No cash was physically exchanged, so
   the “Confirm cash received” control was deliberately not used. The database
   correctly shows payment as pending.

The ambulance browser location was mocked to the synthetic demo coordinates
before later location-sharing checks. An earlier browser-provided location row
was detected, the driver was logged out to stop tracking, and that single
non-test row was removed from the demo database. The existing
`emergency_care` database was not involved.

## Hospital API check

The admin registered a synthetic facility named **Demo Hospital API Facility**
and issued a key. The key was used locally and is not included in this guide.
It is shown only once by the admin UI; rotate it in **Admin → Hospitals** if a
new test key is needed.

A synthetic hospital request was submitted with `POST /api/hospital/requests`
and retrieved with `GET /api/hospital/requests`. The create returned HTTP 201,
the list returned HTTP 200, and request #2 appeared in the online dispatcher's
queue as **Hospital API · Demo Hospital API Facility**. This second request
remains in `searching` status so it can be shown during a defense; it was not
assigned.

![Hospital-origin synthetic request displayed in the dispatcher queue](demo-evidence/hospital-api-request-in-dispatcher.png)

Example PowerShell request after copying a freshly issued local test key:

```powershell
$headers = @{ 'X-Hospital-API-Key' = '<copy-the-local-test-key>' }
$body = @{
  patientName = 'Synthetic API Patient'
  patientPhone = '5550100199'
  symptoms = 'Synthetic hospital integration test only; no real emergency.'
  pickupLocation = 'Synthetic pickup point, Dhaka'
  pickupLatitude = 23.8103
  pickupLongitude = 90.4125
  ambulanceType = 'basic'
} | ConvertTo-Json

Invoke-RestMethod -Method Post `
  -Uri 'http://localhost:5000/api/hospital/requests' `
  -Headers $headers -ContentType 'application/json' -Body $body
```

## Screenshots

The browser was checked at a mobile-sized viewport (390×844) and desktop-sized
viewport (1440×900). Screenshots are saved in `demo-evidence/`.

### Patient fare estimate

![Patient fare estimate at mobile width](demo-evidence/patient-fare-estimate-mobile.png)

### Dispatcher queue

![Hospital API request in the mobile dispatcher queue](demo-evidence/dispatcher-hospital-queue-mobile.png)

![Dispatcher queue at desktop width](demo-evidence/dispatcher-hospital-queue-desktop.png)

### Completed trip and cash status

![Patient view of the completed trip](demo-evidence/patient-trip-completed.png)

![Patient completed trip at desktop width](demo-evidence/patient-trip-completed-desktop.png)

![Ambulance cash collection remains pending](demo-evidence/ambulance-cash-pending-mobile.png)

### Admin workspace

![Admin overview at mobile width](demo-evidence/admin-overview-mobile.png)

![Admin overview at desktop width](demo-evidence/admin-overview-desktop.png)

![Hospital API facility management at mobile width](demo-evidence/admin-hospital-api-mobile.png)

![Hospital API facility management at desktop width](demo-evidence/admin-hospital-api-desktop.png)

## Defense presentation order

1. Start XAMPP MariaDB and confirm `/api/health`.
2. Show the public signup screen, then sign in as the patient.
3. Enter the synthetic pickup coordinates and typed destination; explain the
   external route estimate and show the fare.
4. Submit the request and switch to the dispatcher account.
5. Claim the request, show the nearest-first ambulance list, and assign the
   closest available vehicle.
6. Switch to the ambulance account and advance the trip through pickup,
   arrival, and completion.
7. Return to patient activity to show the completed trip and pending cash
   status. Do not mark the fare paid unless cash has actually been received.
8. Show the admin approval and hospital management workspaces.
9. Submit a synthetic request through the hospital API and show its source in
   the dispatcher queue.
10. Explain the limitations below rather than presenting unsupported features
    as implemented.

## Results and limitations

| Area | Result |
|---|---|
| MariaDB and API health | Passed; API returned HTTP 200 and `database: connected`. |
| Patient signup and login | Passed with a synthetic account. |
| Fare estimation | Passed during this test: 12.03 km and ৳722 Basic. |
| Patient request | Passed; request #1 completed in the demo database. |
| Dispatcher claim and nearest assignment | Passed; assigned the closest available synthetic ambulance. |
| Ambulance lifecycle | Passed through picked up → at hospital → completed. |
| Cash receipt | Not recorded; no cash was actually collected. |
| Hospital API | Passed: synthetic request create HTTP 201, list HTTP 200, visible in dispatcher queue. |
| Frontend production build | Passed with `npm.cmd run build`. |
| Automated test suite | No test script is defined in the inspected package manifests. |
| Native Android APK | Not verified in this walkthrough; the earlier Android build was blocked because Java/JDK was unavailable. The responsive browser UI was tested instead. |

There is no patient-facing hospital directory/selection control: patients type a
destination, which is geocoded for the fare estimate. The hospital integration
is an API, not a hospital-facing web dashboard. No clinical referral,
acceptance, or handoff workflow was found; `at_hospital` is a trip status, not
a referral. The hospital-origin request is shown to dispatchers for ambulance
coordination only.
