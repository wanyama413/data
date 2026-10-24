# PitchData CSV exporter

A Next.js app that downloads PitchAPI datasets as CSV, strictly limited to the 2026/27 season (`2026/2027` in PitchAPI). Leagues that do not list that exact season are excluded. Profile exports include only teams and players found in that season's match catalogue. No IDs are required.

## Run locally

1. Install Node.js 20.9 or newer.
2. Run `npm install` in this folder.
3. Set `PITCHAPI_API_KEY` in `.env.local` (the existing local file is already configured).
4. Run `npm run dev` and open http://localhost:3000.

For deployment, add `PITCHAPI_API_KEY` to the host's server-side environment settings. Never expose it in client code or commit `.env.local`. Since the key was shared in chat, consider replacing it in the PitchAPI dashboard before publishing.

Large exports may take a while because PitchAPI serves most match data one match at a time. The app retries temporary rate-limit and server errors.
