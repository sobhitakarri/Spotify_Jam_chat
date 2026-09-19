# 🚀 Free 24/7 Cloud Deployment Guide for Spotify Jam Chat Server

You can host this real-time Socket.IO server 100% free 24/7 on **Render.com** or **Glitch.com** so you and your friends can chat from anywhere in the world!

---

## 🟢 Option A: Deploy on Render.com (Recommended - 2 Minutes)

1. Go to [https://render.com](https://render.com) and sign up for a free account.
2. Click **New +** -> **Web Service**.
3. Select **Build and deploy from a Git repository** (or connect your GitHub repo containing this project).
4. Fill in these settings:
   - **Name**: `spotify-jam-chat-server`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
5. Click **Create Web Service**!
6. Once deployed, Render gives you your free live URL, e.g.:  
   `https://spotify-jam-chat-server.onrender.com`

---

## 🟣 Option B: Instant Deploy on Glitch.com (No Git Needed - 1 Minute)

1. Go to [https://glitch.com](https://glitch.com) and sign in.
2. Click **New Project** -> **Import from GitHub** (or **Glitch Node App**).
3. Copy the contents of `server.js` and `package.json` into your Glitch project.
4. Glitch instantly gives you a live URL, e.g.:  
   `https://spotify-jam-chat.glitch.me`

---

## 🔗 Connecting Your Extension to Your Live Cloud Server

Once you have your live URL (e.g. `https://spotify-jam-chat-server.onrender.com`):

1. Open your extension popup in Chrome/Brave/Opera.
2. Update **Real-Time Server URL** to your live Render/Glitch URL.
3. Click **Save Settings**!
4. Send the extension `.zip` to your friends — when they install it, they paste the same URL or set it as default!
