# Optional integrations

[Back to the quick start](../README.md)

Start with the basic workspace before configuring these features. Replace every `https://YOUR-DAYLIGHT-DOMAIN` below with your own deployed HTTPS origin. These examples do not point to the maintainer's deployment. Register local callback URLs separately if needed.

Server connections are currently restricted to `DAYLIGHT_OWNER_UID`. Each self-hosted installation configures its own owner. Browser Firebase configuration alone does not enable server integrations.

## Connect Hermes Agent through MCP

Open **Connections → Hermes Agent** while signed in to Daylight. Choose **Read only** or **Read and write**, then select **Create key**. Copy the key immediately; Daylight stores only a hash and cannot show the key again. Existing keys have an Access selector, so you can change a key between read-only and read/write without changing its secret. The key is separate from Firebase's public web API key and from your Google sign-in.

Add a remote MCP server to Hermes Agent's `~/.hermes/config.yaml` (or use **Copy Hermes setup** after creating the key):

```yaml
mcp_servers:
  daylight:
    url: "https://YOUR-DAYLIGHT-DOMAIN/api/mcp"
    headers:
      Authorization: "Bearer <key shown by Daylight>"
```

Restart Hermes or reload MCP connections. Read-only keys expose tasks, transactions, content plans, and bills. A write-enabled key can also create and delete tasks, change task completion, add/edit/delete manual money entries, add/edit/delete content plans, and upload/remove bills. Editing a bill-linked expense updates its displayed bill metadata; removing a bill from Daylight leaves the original file in Google Drive. Daylight does not publish social posts automatically. Revoke a key in Connections to stop access immediately. Keep the key out of source control, screenshots, and shared logs.

For a bill file, Hermes calls `begin_bill_upload` with only the real file name, MIME type, and byte size. It sends the raw bytes with HTTP `PUT` to the returned private **Daylight** upload URL. Daylight checks the bytes and upload range, adds the current Google Drive authorization, and transfers the file to Drive. For files up to 4 MiB, send one PUT with the returned `Content-Range`; for larger files up to 5 MiB, use chunks no larger than 4 MiB in multiples of 256 KiB except the final chunk. If the upload is interrupted, retry the full file when it is at most 4 MiB, or resume from the `nextOffset` returned by the upload response. Then Hermes calls `scan_bill_upload` with the upload ID. Daylight sends a temporary copy of the bill to Google Drive's cloud OCR, reads the extracted text, removes the temporary Google Doc, and returns a draft. The MCP scan does not use on-device OCR or save an expense. Hermes reviews the merchant, date, total, and currency with you, then calls `complete_bill_upload` with the reviewed details and LKR amount to save the bill and linked expense in one Firestore transaction. The original uploaded bill stays in Google Drive. The returned upload URL is a temporary bearer capability valid for up to 24 hours; keep it out of chat, source control, screenshots, and shared logs. Hermes needs access to the actual file bytes and an HTTP client, and Google Drive must remain connected in Daylight. Existing upload attempts that returned a Google Drive URL should be restarted with `begin_bill_upload` after this update.

The Money page separates recent income and expenses and lets you edit an entry's amount, category, date, and description. Editing an expense created from a bill also updates its displayed bill metadata; the original uploaded bill file remains unchanged. When you open Daylight, the bell opens automatically if you have overdue or upcoming tasks or planned posts within the next seven days. These are in-app reminders while the page is open, not operating-system push notifications.

## Connect Firebase

1. In the [Firebase console](https://console.firebase.google.com/), open your existing project or create one. Register a **Web app** in Project settings and copy its Firebase configuration.
2. In **Authentication → Sign-in method**, enable **Google**.
3. In **Authentication → Settings → Authorized domains**, add the domain of your Vercel deployment, such as `your-project.vercel.app`. Add any custom domain you use. For local development, add `localhost` if it is not already listed.
4. In **Firestore Database**, create a database. Open its **Rules** tab, replace the rules with the contents of [firestore.rules](../firestore.rules), and publish them. These rules let signed-in users read and change only their own projects, tasks, transactions, posts, and bills.
5. In **Vercel → Project → Settings → Environment Variables**, add the four variables below using values from your Firebase Web app configuration. Enable them for Production and Preview, then redeploy. Next.js includes these public configuration values in the browser bundle at build time.

| Vercel variable | Firebase config field |
| --- | --- |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | `apiKey` |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | `authDomain` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | `projectId` |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | `appId` |

The Firebase Web config identifies your project; it is not a password. Firestore Security Rules and Google sign-in protect the data. Do not put Firebase Admin service account credentials in `NEXT_PUBLIC_` variables.

## Scan bills and save originals to Google Drive

Bill photos and PDFs are stored in a **Daylight Bills** folder in the signed-in user's Google Drive. Firestore stores only the reviewed merchant, date, category, amount, item names, Drive file link, and the matching expense. Removing a bill from Daylight removes its metadata and matching expense; the original stays in Drive so the user can remove it there separately.

To enable Drive storage and the optional cloud AI scan:

1. The default **Read on this device** scan needs no AI service. English OCR runs in the browser with locally served Tesseract assets; PDFs with selectable text are read directly. The first image scan downloads the reader to the browser and may take longer; later scans reuse its cache. For **Improve with cloud AI**, complete **Firebase → AI Logic** setup for the **Gemini Developer API**. The optional AI scan uses the model in `lib/bills.ts` and uploads the selected bill for analysis. Review the [Firebase AI Logic setup](https://firebase.google.com/docs/ai-logic/get-started?platform=web) and [pricing](https://firebase.google.com/docs/ai-logic/pricing); AI calls may have quotas or charges depending on the plan.
2. Set up **Firebase App Check** for the Web app with [reCAPTCHA Enterprise](https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider). Register your Vercel domain for the reCAPTCHA key and add that public site key in Vercel as `NEXT_PUBLIC_FIREBASE_APPCHECK_SITE_KEY`. Redeploy after adding it. Keep App Check enforcement enabled for Firebase AI Logic.
3. In the **Google Cloud project linked to Firebase**, enable the **Google Drive API**. On the OAuth consent screen, declare the `https://www.googleapis.com/auth/drive.file` scope. Add `https://YOUR-DAYLIGHT-DOMAIN/api/drive/callback` to your Google OAuth client's authorized redirect URIs; add each exact Preview callback URL used for review. If the consent screen is in Testing mode, add your Google account as a test user. Google can expire refresh tokens for external apps in Testing mode, so move the consent screen to Production after your review and any required verification if you want the connection to persist. Daylight asks for this limited Drive permission once via **Money → Connect Drive**, stores the refresh token encrypted for your Daylight owner account, and renews access automatically until Google revokes or expires it.
4. Republish the updated [firestore.rules](../firestore.rules) in **Firestore → Rules** so Daylight can read and save the `bills` collection.

When adding a bill, choose a JPG, PNG, WebP, or PDF smaller than 5 MB, click **Read on this device**, review the result, then **Save bill & expense**. The original stays on the device until Save uploads it to Drive. On-device reading handles English text and up to three PDF pages. It may miss faded, handwritten, or non-English receipts; manually correct the fields or choose **Improve with cloud AI**. For a bill in another currency, enter the amount actually paid in LKR so the money dashboard remains accurate. Money totals use the bill's date; select that month to see the expense. Missing expense records from older bills are repaired when your workspace loads.

## Automatically add dated tasks to Google Calendar

1. In the **same Google Cloud project as Firebase**, enable the **Google Calendar API** and **Google Tasks API**.
2. In **Google Auth Platform → Data Access**, declare `openid`, `email`, `https://www.googleapis.com/auth/calendar.events.owned`, and `https://www.googleapis.com/auth/tasks.readonly`. The Tasks scope only allows Daylight to view tasks. If the consent screen is in Testing mode, add your Google account as a test user. For a public app, Google may require OAuth verification.
3. Create a **Web application OAuth client** and add `https://YOUR-DAYLIGHT-DOMAIN/api/calendar/callback` as an authorized redirect URI. Add the exact preview callback URL separately when testing a Vercel preview. Set its credentials as server-only Vercel variables `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET`. The existing `FIREBASE_SERVICE_ACCOUNT_JSON`, `SOCIAL_TOKEN_ENCRYPTION_KEY`, and `DAYLIGHT_OWNER_UID` variables are also required for account-scoped Calendar storage. Assign all five to **Production** for the live site; Preview-only settings do not reach it. Use the same encryption key in both environments so stored connections remain readable. Redeploy after changing variable environments.
4. Sign in to Daylight as the owner and use **Connections → Connect Google Calendar**. Choose the Google account you want to use. Daylight displays that email and keeps the encrypted refresh token under your Firebase UID. Dated tasks sync automatically, including pending tasks after the connection is established.

Tasks without a date stay in Daylight. A dated task created before the connection is saved and synced after you connect. Each event has a 30-minute popup reminder. If Calendar rejects an event, the task remains in Daylight and shows **Retry calendar sync**. Deleting a synced task removes its Calendar event first. Disconnecting removes stored Calendar credentials and clears task sync markers so a different account can be connected; existing events in the former account remain there. Daylight syncs while the app is open or when a task is created, not through a background scheduler.

The **Tasks** page also reads upcoming events and reminders from the connected primary Google Calendar and open Google Tasks from all task lists. These Google items are shown separately and can be opened in Google for changes; they are not copied into Firestore. Daylight-created calendar events are hidden from this section to avoid duplicates. The in-app reminder bell includes nearby Google items. Daylight refreshes them when opened, when the browser regains focus, every five minutes while open, or when you click **Refresh**. Existing Calendar connections need to use **Include Google Tasks** once to grant the new read-only permission. The Google Tasks API exposes dates but does not provide task reminder times, so Daylight labels those items as date-only.

## Connect your social accounts

The **Analytics** and **Connections** pages both have separate Connect buttons for Instagram, TikTok, and Facebook. These use the providers' authorization screens, then return to the selected Daylight analytics view; they never ask you to paste a social password into Daylight. If developer credentials are missing, the button explains the setup requirement. The following server settings must exist in Vercel for the environment you use:

| Variable | Value |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Service account JSON from your Firebase project; server only |
| `SOCIAL_TOKEN_ENCRYPTION_KEY` | A random 32-byte key encoded as base64 (for example, generated with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`) |
| `DAYLIGHT_OWNER_UID` | Your Firebase Authentication user UID; only this user can connect social accounts |
| `META_APP_ID`, `META_APP_SECRET` | Your Meta for Developers app credentials, server only |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` | Instagram API with Instagram Login credentials for your professional Instagram account, server only |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | Your TikTok for Developers app credentials, server only |

Configure **Instagram API with Instagram Login** in your Meta developer app for the professional Instagram account. Register `https://YOUR-DAYLIGHT-DOMAIN/api/social/callback/instagram` as its exact OAuth redirect URI and request `instagram_business_basic` and `instagram_business_manage_insights`. This flow does not require a linked Facebook Page. It shows your profile picture, name, followers, following, post count, recent post engagement, and reach when Insights permission is granted. Existing Page-based Instagram connections need a one-time reconnect. Configure Facebook Login separately with `https://YOUR-DAYLIGHT-DOMAIN/api/social/callback/facebook` and `public_profile`. A Facebook personal-profile login shows name and profile photo, but Meta does not expose personal-profile post and follower Insights through this permission. Daylight will not require a Page or imply those metrics are available.

In TikTok for Developers, create an app with Login Kit and Display API, request `user.info.basic`, `user.info.stats`, and `video.list`, and register `https://YOUR-DAYLIGHT-DOMAIN/api/social/callback/tiktok` as a web redirect URI. Verify ownership of the website URL in TikTok before submitting the app for review. TikTok's app and scope approval requirements still apply to personal projects. Register preview URLs separately if testing OAuth on a Vercel preview domain; providers require exact redirect matches.

Connection credentials are encrypted before server-only Firestore storage under `users/{uid}/socialConnections`. Firestore client rules do not grant access to that collection. Disconnect removes Daylight's stored credentials; revoke an app in the provider's account settings if you also want to revoke provider access. The **Analytics** page reads live numbers from the provider when opened or refreshed. TikTok Display API covers current public follower and video counts plus performance for the latest public videos; private account reach is unavailable. The Content page remains a planning queue; connection alone does not publish scheduled posts.

Connections are bound to the Firebase owner UID and show the selected account name and ID on return visits. TikTok access tokens refresh with its stored refresh token; Instagram long-lived tokens are refreshed before expiry. If a provider revokes access, the card asks for reconnection. Facebook may require reconnection when its token expires.

## Content plans and Daylight assistant

The Content page stores ideas and scheduled dates inside Daylight. You can edit a plan and mark it published manually. This is a planning calendar: it does **not** automatically publish to Instagram, Facebook, or TikTok. External publishing needs approved platform publishing permissions, a media upload workflow, and background jobs; account connection alone does not grant them.

For in-app AI chat, add `OPENAI_API_KEY` as a **server-only** Vercel environment variable, then redeploy. `OPENAI_MODEL` optionally overrides the default Responses API model. The assistant receives a small summary of your open tasks, content ideas, and current-month spending when you send a message. Responses are suggestions that you review; chat does not edit your data or publish posts. ChatGPT subscriptions and OpenAI API billing are separate, so signing in to ChatGPT cannot itself connect Daylight to this API.

## Run locally

Use Node.js 22.13 or later. Create `.env.local` with the same four variables, then run:

```sh
npm install
npm run dev
```

Open `http://localhost:3000`. Run `npm run build` to check the production build.

## Current scope

- Tasks, income and expenses, and post ideas sync through Firestore once Firebase is configured.
- Bill details and linked expenses sync through Firestore; original files stay in the user's Google Drive.
- Dated tasks sync to the Google account linked to the owner workspace after Calendar API and server OAuth setup. The connection persists across browser sessions.
- Social analytics reads direct Instagram professional and TikTok accounts separately. Facebook personal-profile data is limited to profile identity. Numbers depend on developer app approval and account permissions. Automatic publishing is not connected.
- Data previously stored in Cloudflare D1 is not automatically moved to Firestore.
