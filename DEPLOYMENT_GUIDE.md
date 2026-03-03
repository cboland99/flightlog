# FlightLog — Deployment Guide
Step-by-step setup with zero coding required.

---

## What You'll End Up With
- A live web app at a URL like `https://yourusername.github.io/flightlog`
- Installable on Android, iPad, and Windows like a native app
- All your data stored securely in Firebase (Google), synced across all devices
- Free — no monthly costs for personal use

---

## PART 1: Set Up Firebase (your database & login)

### Step 1 — Create a Firebase account
1. Go to https://firebase.google.com
2. Click **Get started** and sign in with your Google account

### Step 2 — Create a project
1. Click **Add project**
2. Name it `flightlog` (or anything you like)
3. Disable Google Analytics (not needed) → Click **Create project**

### Step 3 — Enable Authentication
1. In the left sidebar click **Authentication**
2. Click **Get started**
3. Under **Sign-in method** tab, click **Email/Password**
4. Toggle **Enable** ON → Click **Save**

### Step 4 — Create Firestore Database
1. In the left sidebar click **Firestore Database**
2. Click **Create database**
3. Choose **Start in production mode** → Click **Next**
4. Select any region close to you → Click **Enable**
5. Once created, click the **Rules** tab
6. Replace the existing rules with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /flights/{flightId} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.uid;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.uid;
    }
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

7. Click **Publish**

### Step 5 — Get your Firebase config
1. Click the **gear icon** ⚙️ next to "Project Overview" → **Project settings**
2. Scroll down to **Your apps** section
3. Click the **</>** (Web) icon to add a web app
4. Name it `flightlog-web` → Click **Register app**
5. You'll see a code block — copy these 6 values:
   - `apiKey`
   - `authDomain`
   - `projectId`
   - `storageBucket`
   - `messagingSenderId`
   - `appId`

---

## PART 2: Update the App Config

### Step 6 — Edit firebase-config.js
Open the file `js/firebase-config.js` in any text editor (Notepad works fine).

Replace the placeholder values with your real Firebase values:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSy...",           // ← paste your real value
  authDomain: "flightlog-abc.firebaseapp.com",
  projectId: "flightlog-abc",
  storageBucket: "flightlog-abc.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

Save the file.

---

## PART 3: Deploy to GitHub Pages

### Step 7 — Create a GitHub account
1. Go to https://github.com and sign up (free)

### Step 8 — Create a new repository
1. Click the **+** icon → **New repository**
2. Name it `flightlog`
3. Set it to **Public**
4. Click **Create repository**

### Step 9 — Upload your files
1. On your new empty repository page, click **uploading an existing file**
2. Drag and drop ALL the files and folders from the `flight-logbook` folder:
   - `index.html`
   - `manifest.json`
   - `css/` folder (with style.css inside)
   - `js/` folder (with firebase-config.js and app.js inside)
   - `icons/` folder
3. Scroll down, click **Commit changes**

### Step 10 — Enable GitHub Pages
1. Click **Settings** tab on your repository
2. In the left sidebar click **Pages**
3. Under **Source**, select **Deploy from a branch**
4. Set branch to `main`, folder to `/ (root)`
5. Click **Save**
6. Wait 1-2 minutes, then your app will be live at:
   `https://YOUR_GITHUB_USERNAME.github.io/flightlog`

---

## PART 4: Install on Your Devices

### Android
1. Open Chrome and visit your app URL
2. Tap the **⋮ menu** → **Add to Home screen**
3. Tap **Add** — it now appears as an app icon

### iPad
1. Open **Safari** (must be Safari) and visit your app URL
2. Tap the **Share** button (box with arrow pointing up)
3. Tap **Add to Home Screen** → **Add**

### Windows
1. Open Chrome or Edge and visit your app URL
2. Look for the install icon in the address bar (⊕ or screen icon)
3. OR click **⋮ menu** → **Install FlightLog**
4. It appears in your Start Menu and taskbar

---

## Updating the App in the Future
If you want to make changes:
1. Edit the files on your computer
2. Go to your GitHub repository
3. Click on the file you want to update → click the **pencil ✏️ icon** → paste new content → Commit
4. GitHub Pages automatically updates within 1-2 minutes

---

## Troubleshooting

**App shows blank page or errors:**
- Open browser DevTools (F12) → Console tab to see error messages
- Double-check your Firebase config values are correct in firebase-config.js

**Can't sign in / "permission denied":**
- Make sure you published the Firestore security rules in Step 4

**Charts not showing:**
- Make sure you have at least 1-2 flights logged first

**Firestore inactive warning:**
- Firebase free tier pauses after 1 week of no logins — it resumes in ~30 seconds on your next visit. No data is lost.
