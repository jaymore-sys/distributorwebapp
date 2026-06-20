# Deploy Notification Backend

Use this when local backend works but tunnels are unreliable. The simplest production path is a small Node web service on Render. Railway is also fine; the settings are almost the same.

Official references:
- Render Node/Express deploy docs: https://render.com/docs/deploy-node-express-app
- Render environment variables docs: https://render.com/docs/configure-environment-variables
- Railway variables docs: https://docs.railway.com/variables

## What To Deploy

Deploy this folder:

```text
distributorwebapp/backend
```

Backend entrypoint:

```text
server.js
```

Build command:

```bash
npm install
```

Start command:

```bash
npm start
```

## Required Backend Environment Variables

Set these in Render/Railway, not in React and not in the Capacitor app.

```bash
PORT=3000
CORS_ORIGIN=https://sienna-walrus-972530.hostingersite.com
FIREBASE_SERVICE_ACCOUNT_CRUNZZO_JSON=PASTE_BASE64_SERVICE_ACCOUNT_JSON_HERE
```

Do not upload or commit `backend/secrets/crunzzo-service-account.json`.

Create the base64 value locally:

```bash
cd ~/Desktop/distributorwebapp
base64 -i backend/secrets/crunzzo-service-account.json | tr -d '\n'
```

Copy the printed value into the hosting service environment variable named:

```bash
FIREBASE_SERVICE_ACCOUNT_CRUNZZO_JSON
```

Optional later:

```bash
FIREBASE_SERVICE_ACCOUNT_BOUNCE_JSON=...
FIREBASE_SERVICE_ACCOUNT_VALENCIA_JSON=...
```

## Render Setup

1. Push this repo to GitHub.
2. In Render, create `New Web Service`.
3. Select the repo.
4. Set root directory:

```bash
backend
```

5. Set build command:

```bash
npm install
```

6. Set start command:

```bash
npm start
```

7. Add the environment variables above.
8. Deploy.

Your backend URL will look like:

```text
https://YOUR-SERVICE-NAME.onrender.com
```

Health check:

```bash
curl https://YOUR-SERVICE-NAME.onrender.com/api/health
```

Expected:

```json
{"ok":true,"service":"crunzzo-notification-backend"}
```

## Railway Setup

1. Create a Railway project from GitHub.
2. Select this repo.
3. Set service root directory to:

```bash
backend
```

4. Add the same environment variables.
5. Railway should use `npm start`; if it asks, set start command:

```bash
npm start
```

Your backend URL will look like:

```text
https://YOUR-SERVICE-NAME.up.railway.app
```

## Connect The Frontend To The Public Backend

In the React project:

```bash
cd ~/Desktop/distributorwebapp
printf 'VITE_API_BASE_URL=https://YOUR_BACKEND_URL\n' > .env.production
npm run build
```

Deploy the new `dist/` folder to Hostinger.

The Android/iPhone app opens the hosted website, so it will use whatever backend URL was baked into the Hostinger build.

## Test Token Registration Manually

Replace `YOUR_BACKEND_URL`:

```bash
curl -X POST https://YOUR_BACKEND_URL/api/push/register-token \
  -H 'Content-Type: application/json' \
  -d '{
    "uid": "manual-test-user",
    "role": "admin",
    "section": "crunzzo",
    "regionId": "",
    "token": "manual-test-token",
    "platform": "android"
  }'
```

Expected:

```json
{"ok":true}
```

Then check Firestore:

```text
device_tokens/manual-test-user_android_...
```

The manual token is fake, so it will not receive a phone notification. It only proves the public backend can write to Firestore.

## Test Real Phone Push

1. Open the Android app.
2. Login.
3. Allow notification permission.
4. Confirm a real token appears in Firestore `device_tokens`.
5. Send a test notification:

```bash
curl -X POST https://YOUR_BACKEND_URL/api/push/send-test \
  -H 'Content-Type: application/json' \
  -d '{
    "section": "crunzzo",
    "role": "admin",
    "title": "Crunzzo test",
    "body": "Phone push is working",
    "targetPath": "/crunzzo/admin/notifications"
  }'
```

6. Confirm the phone notification appears with sound/vibration.
7. Confirm the same notification appears in the in-app Notifications screen.
8. Tap the phone notification and confirm it routes to the target path.

## Files That Must Stay Secret

Never commit:

```text
backend/secrets/
.env
.env.production
backend/.env
backend/.env.production
```
