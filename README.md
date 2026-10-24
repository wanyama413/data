# PitchData CSV exporter

A Next.js app that downloads complete PitchAPI datasets as CSV. Choose a data type on the homepage; the app discovers all leagues, available seasons, and matches and gathers the selected endpoint across the catalogue. Match-level exports include match, league, and season context. No IDs are required.

## Run locally

1. Install Node.js 20.9 or newer.
2. Run `npm install` in this folder.
3. Set `PITCHAPI_API_KEY` in `.env.local` (the existing local file is already configured).
4. Run `npm run dev` and open http://localhost:3000.

For deployment, add `PITCHAPI_API_KEY` to the host's server-side environment settings. Never expose it in client code or commit `.env.local`. Since the key was shared in chat, consider replacing it in the PitchAPI dashboard before publishing.

Large exports may take a while because PitchAPI serves most match data one match at a time. The app retries temporary rate-limit and server errors.
