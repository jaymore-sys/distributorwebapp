# Notification backend

Mount `createNotificationRouter()` from `pushRoutes.js` in your existing Node API:

```js
import createNotificationRouter from "./backend/pushRoutes.js";

app.use(express.json());
app.use("/api", createNotificationRouter());
```

Set service account credentials only on the backend. Use one JSON value or file path per Firebase project:

```bash
FIREBASE_SERVICE_ACCOUNT_CRUNZZO_JSON='{"type":"service_account",...}'
FIREBASE_SERVICE_ACCOUNT_BOUNCE_JSON='{"type":"service_account",...}'
FIREBASE_SERVICE_ACCOUNT_VALENCIA_JSON='{"type":"service_account",...}'
```

You can also use base64-encoded JSON in the same variables, or file paths with:

```bash
GOOGLE_APPLICATION_CREDENTIALS_CRUNZZO=/secure/path/crunzzo-service-account.json
GOOGLE_APPLICATION_CREDENTIALS_BOUNCE=/secure/path/bounce-service-account.json
GOOGLE_APPLICATION_CREDENTIALS_VALENCIA=/secure/path/valencia-service-account.json
```

The React app calls `/api/push/register-token` and `/api/app-notifications` by default. If your API is on a different host, set `VITE_API_BASE_URL` before building the web app.
