# 🚀 Daily Job Alert Actor — Setup Guide

## What this does
Every morning at 8:00 AM, this Actor:
1. **Scrapes LinkedIn** for Backend Developer, Backend Intern, Full Stack Developer, and Software Engineer Intern roles in Remote / Pune / Mumbai
2. **Scrapes RemoteOK** for remote backend/fullstack jobs
3. **Filters out** WordPress, PHP, Marketing, Sales roles
4. **Uses Claude AI** to rank and pick the top 5 most relevant matches for your profile
5. **Emails you** a beautiful HTML digest with job title, company, location, why it matches you, and a direct apply link

---

## 📦 Step 1 — Deploy to Apify

### Option A: Apify CLI (recommended)
```bash
npm install -g apify-cli
apify login
apify push
```

### Option B: Upload via Apify Console
1. Go to https://console.apify.com → **Actors** → **Create new Actor**
2. Choose "Start from scratch"
3. Upload all files from this folder
4. Click **Build**

---

## 🔑 Step 2 — Configure Input

In the Apify Console, go to your Actor → **Input** tab and fill in:

| Field | Value |
|---|---|
| `anthropicApiKey` | From https://console.anthropic.com/ |
| `smtpHost` | `smtp.gmail.com` (or your provider) |
| `smtpPort` | `587` |
| `smtpUser` | `yourname@gmail.com` |
| `smtpPass` | Your Gmail **App Password** (see below) |
| `recipientEmail` | Where to receive alerts |
| `dryRun` | `true` for first test, then `false` |

### 📌 Gmail App Password (required for Gmail)
1. Go to https://myaccount.google.com/security
2. Enable **2-Step Verification** if not already enabled
3. Search for **"App Passwords"**
4. Create one named "Apify Job Alert"
5. Copy the 16-character password — use this as `smtpPass`

---

## ⏰ Step 3 — Schedule at 8:00 AM Daily

1. In Apify Console → your Actor → **Schedules** tab
2. Click **+ New Schedule**
3. Set **Cron expression**: `0 2 * * *`
   - *(8:00 AM IST = 02:30 UTC, adjust for your timezone)*
   - For UTC+5:30 (IST): use `30 2 * * *`
4. Under **Actor input**, paste your configured JSON input
5. Click **Save**

### Common cron expressions
| Time (IST) | Cron (UTC) |
|---|---|
| 8:00 AM IST | `30 2 * * *` |
| 9:00 AM IST | `30 3 * * *` |
| 7:00 AM IST | `30 1 * * *` |

---

## 🧪 Step 4 — Test Run

1. Set `dryRun: true` in input
2. Click **Run** manually
3. Check the **Dataset** tab to see AI-picked jobs
4. Once happy, set `dryRun: false` and save the schedule

---

## 💰 Estimated Daily Cost

| Component | Est. Cost |
|---|---|
| LinkedIn Jobs Scraper (~50 results) | ~$0.05 |
| RemoteOK Scraper (~80 results) | ~$0.08 |
| Claude AI ranking (1 call) | ~$0.01 |
| **Total per day** | **~$0.15/day** |

---

## 📁 File Structure
```
daily-job-alert-actor/
├── main.js              # Main Actor logic
├── package.json         # Dependencies
├── Dockerfile           # Container config
└── .actor/
    ├── actor.json       # Actor metadata
    └── input_schema.json # Input field definitions
```
