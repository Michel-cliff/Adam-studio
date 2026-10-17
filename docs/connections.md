# Connections and API keys

Every key lives in `~/.adam-studio/.env` on your machine (never in the repo), one `NAME=value` per line.
The panel (`npm run ui`) reads it on each request: edit the file, then reload the page.

    PEXELS_API_KEY=...
    PIXABAY_API_KEY=...
    FREESOUND_API_KEY=...
    PINTEREST_APP_ID=...
    PINTEREST_APP_SECRET=...
    TIKTOK_CLIENT_KEY=...
    TIKTOK_CLIENT_SECRET=...
    INSTAGRAM_ACCESS_TOKEN=...

Sign-in tokens obtained through the panel are saved in `~/.adam-studio/tokens.json`.

## Asset search (Library page, `search_assets`)

- **Openverse**: no key. Images and sounds (Freesound CC0 included), filtered to CC0, public domain and CC BY.
- **Pexels** (photos, videos): create a key at https://www.pexels.com/api/ and set `PEXELS_API_KEY`.
- **Pixabay** (photos, videos): your key is on https://pixabay.com/api/docs/ once logged in; set `PIXABAY_API_KEY`.
- **Freesound** (CC0 sounds beyond Openverse): https://freesound.org/apiv2/apply/ gives a client id and an API key;
  set `FREESOUND_API_KEY` to the key.

Imported files are copied into `<project>/assets/` and listed in `assets/CREDITS.md` with their license and author.
CC BY needs a credit in the video description.

## Pinterest (your boards into the Inspiration folder)

The official API reads your own boards and pins (searching all of Pinterest is not open to apps).

1. https://developers.pinterest.com/apps/ : create an app (trial access is enough for your own account).
2. Add the redirect URI `http://localhost:4317/api/pinterest/callback`.
3. Set `PINTEREST_APP_ID` and `PINTEREST_APP_SECRET`, open the panel's Library page, press **Connect Pinterest**.
4. Press **Sync to Inspiration** on a board: its pins land in `~/AdamStudioInspiration/Pinterest/<board>/`.

If Pinterest refuses a `http://localhost` redirect, generate an access token on the app's page instead and set
`PINTEREST_ACCESS_TOKEN` (scopes `boards:read`, `pins:read`).

## TikTok (Insights)

1. In your TikTok for Developers app, add the **Login Kit** for **desktop**, with the redirect URI
   `http://localhost:4317/api/tiktok/callback`, and the scopes `user.info.basic`, `user.info.stats`, `video.list`.
2. Set `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET`, open the panel's Insights page, press **Connect TikTok**.
3. In sandbox, add your TikTok account as a target user of the app. Whether `video.list` works without app review
   is not confirmed: if the refresh says the scope is not authorized, submit the app for review.

## Instagram (Insights)

Instagram's sign-in needs an HTTPS redirect, which a local app cannot receive, so the token comes from the dashboard:

1. In your Meta app, product **Instagram**, **API setup with Instagram login**, add your professional account and
   press **Generate token** (permissions `instagram_business_basic`, `instagram_business_manage_insights`).
2. Set `INSTAGRAM_ACCESS_TOKEN`. Adam Studio refreshes it (60 days) whenever it is used.

Some metrics (views, reach) need a professional account and, for some, 100 followers; missing ones show as 0.

## What is not possible

Watching other creators' public content and TikTok trends: no official API gives it to an app like this one, and
scraping is ruled out. Drop the references you want me to study in the Inspiration folder instead.
