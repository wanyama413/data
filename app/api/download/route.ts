import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;
const BASE = "https://api.pitchapi.dev";
type Row = Record<string, string>;
type League = { id: string; name: string; seasons?: string[] };
type Match = { id: string; date?: string; league?: { id?: string; name?: string }; home_team?: { id?: string; name?: string }; away_team?: { id?: string; name?: string }; [key: string]: unknown };
type Job = { league: League; season: string };
let nextRequestAt = 0;
let cooldownUntil = 0;

async function waitForRequestSlot() {
  const now = Date.now();
  const slot = Math.max(now, nextRequestAt, cooldownUntil);
  nextRequestAt = slot + 150;
  if (slot > now) await new Promise(resolve => setTimeout(resolve, slot - now));
}

function flatten(value: unknown, prefix = "", out: Row = {}): Row {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, item] of Object.entries(value)) {
      const name = prefix ? `${prefix}.${key}` : key;
      if (item && typeof item === "object" && !Array.isArray(item)) flatten(item, name, out);
      else out[name] = item == null ? "" : Array.isArray(item) ? JSON.stringify(item) : String(item);
    }
  } else out[prefix || "value"] = value == null ? "" : String(value);
  return out;
}
function toRows(data: unknown): Row[] {
  if (Array.isArray(data)) return data.length ? data.map(item => flatten(item)) : [];
  if (!data || typeof data !== "object") return [flatten(data)];
  const arrays: Array<{ items: unknown[]; parent: Row }> = [];
  function find(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const object = value as Record<string, unknown>;
    for (const [key, item] of Object.entries(object)) {
      if (Array.isArray(item) && item.some(row => row && typeof row === "object")) {
        arrays.push({ items: item, parent: flatten(Object.fromEntries(Object.entries(object).filter(([k, v]) => k !== key && (v === null || ["string", "number", "boolean"].includes(typeof v))))) });
      } else if (item && typeof item === "object") find(item);
    }
  }
  find(data);
  if (!arrays.length) return [flatten(data)];
  const selected = arrays.reduce((best, current) => current.items.length > best.items.length ? current : best);
  return selected.items.map(item => ({ ...selected.parent, ...flatten(item) }));
}
function toCsv(rows: Row[]) {
  const columns = Array.from(new Set(rows.flatMap(row => Object.keys(row))));
  const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return [columns.map(escape).join(","), ...rows.map(row => columns.map(key => escape(row[key] ?? "")).join(","))].join("\r\n");
}
async function requestJson(url: string, key: string) {
  for (let attempt = 0; attempt < 6; attempt++) {
    await waitForRequestSlot();
    let response: Response;
    try {
      response = await fetch(url, { headers: { "X-API-KEY": key }, cache: "no-store", signal: AbortSignal.timeout(30000) });
    } catch {
      if (attempt === 5) throw new Error("Could not reach PitchAPI after several attempts. Please retry the download.");
      await new Promise(resolve => setTimeout(resolve, Math.min(1000 * (2 ** attempt), 30000)));
      continue;
    }
    if (response.ok) return await response.json();
    const payload = await response.json().catch(() => null);
    if (response.status === 404) return null;
    if (response.status === 429 || response.status >= 500) {
      if (attempt === 5) throw new Error(payload?.error?.message || `PitchAPI returned ${response.status} after several attempts.`);
      const retryHeader = response.headers.get("Retry-After");
      const retryNumber = Number(retryHeader);
      const retryDateSeconds = retryHeader ? (Date.parse(retryHeader) - Date.now()) / 1000 : 0;
      const retryAfter = Number.isFinite(retryNumber) && retryNumber > 0 ? retryNumber : retryDateSeconds;
      const waitSeconds = response.status === 429 && retryAfter > 0 ? retryAfter : Math.min(2 ** attempt, 30);
      const delay = Math.min(waitSeconds, 60) * 1000;
      cooldownUntil = Math.max(cooldownUntil, Date.now() + delay);
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }
    throw new Error(payload?.error?.message || `PitchAPI returned ${response.status}.`);
  }
  return null;
}
async function pool<T>(items: T[], concurrency: number, task: (item: T) => Promise<void>) {
  let index = 0;
  let failure: unknown;
  const worker = async () => {
    while (!failure) {
      const current = index++;
      if (current >= items.length) return;
      try { await task(items[current]); } catch (error) { failure = error; return; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (failure) throw failure;
}
function context(match: Match, season?: string): Row {
  return { match_id: String(match.id || ""), match_date: String(match.date || ""), league_id: String(match.league?.id || ""), league_name: String(match.league?.name || ""), season: season || "" };
}
function matchEndpoint(name: string, id: string) {
  const paths: Record<string, string> = {
    matches: "", shots: "/shots", shot: "/shots", momentum: "/momentum", events: "/events", players: "/players",
    playerStats: "/players", playerHalves: "/players/halves", playerHalfStats: "/players/halves", playerShots: "/shots",
    lineups: "/lineups", h2h: "/h2h", teamStats: "/stats", advanced: "/advanced", passNetwork: "/advanced/network",
    advancedPlayers: "/advanced/players", advancedPlayer: "/advanced/players", heatmaps: "/heatmaps",
  };
  return paths[name] === undefined ? null : `${BASE}/v1/matches/${encodeURIComponent(id)}${paths[name]}`;
}
async function allLeagueData(key: string, leagues: League[]) {
  const jobs: Job[] = leagues.flatMap(league => (league.seasons || []).map(season => ({ league, season })));
  const matches: Array<{ match: Match; season: string }> = [];
  await pool(jobs, 4, async ({ league, season }) => {
    const url = new URL(`${BASE}/v1/leagues/${encodeURIComponent(league.id)}/matches`);
    url.searchParams.set("season", season);
    url.searchParams.set("status", "all");
    const result = await requestJson(url.toString(), key);
    for (const match of (result?.data?.matches || []) as Match[]) matches.push({ match: { ...match, league: match.league || { id: league.id, name: league.name } }, season });
  });
  const unique = new Map<string, { match: Match; season: string }>();
  for (const entry of matches) if (entry.match.id) unique.set(entry.match.id, entry);
  return Array.from(unique.values());
}
function contextualRows(data: unknown, match: Match, season: string) {
  return toRows(data).map(row => ({ ...context(match, season), ...row }));
}

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("endpoint") || "";
  const allowed = new Set(["date", "allMatchResults", "matches", "shots", "shot", "momentum", "events", "players", "playerStats", "playerHalves", "playerHalfStats", "playerShots", "lineups", "h2h", "teamStats", "advanced", "passNetwork", "advancedPlayers", "advancedPlayer", "heatmaps", "leagues", "league", "leagueMatches", "team", "player"]);
  if (!allowed.has(name)) return NextResponse.json({ error: "Unknown data endpoint." }, { status: 400 });
  const key = process.env.PITCHAPI_API_KEY;
  if (!key) return NextResponse.json({ error: "PITCHAPI_API_KEY is not configured on the server." }, { status: 500 });
  try {
    const catalog = await requestJson(`${BASE}/v1/leagues`, key);
    const leagues: League[] = catalog?.data?.leagues || [];
    const matches = ["leagues", "league"].includes(name) ? [] : await allLeagueData(key, leagues);
    let rows: Row[] = [];
    if (name === "leagues") rows = leagues.map(league => flatten(league));
    else if (name === "league") {
      await pool(leagues, 4, async league => { const result = await requestJson(`${BASE}/v1/leagues/${encodeURIComponent(league.id)}`, key); if (result?.data) rows.push(flatten(result.data)); });
    } else if (name === "team") {
      const ids = new Set<string>();
      for (const { match } of matches) { if (match.home_team?.id) ids.add(match.home_team.id); if (match.away_team?.id) ids.add(match.away_team.id); }
      await pool(Array.from(ids), 4, async id => { const result = await requestJson(`${BASE}/v1/teams/${encodeURIComponent(id)}`, key); if (result?.data) rows.push(flatten(result.data)); });
    } else if (name === "player") {
      const ids = new Set<string>();
      await pool(matches, 4, async ({ match }) => { const result = await requestJson(`${BASE}/v1/matches/${encodeURIComponent(match.id)}/players`, key); const playerRows = Array.isArray(result?.data) ? result.data : result?.data?.players || []; for (const row of playerRows) if (row?.player?.id) ids.add(row.player.id); });
      await pool(Array.from(ids), 4, async id => { const result = await requestJson(`${BASE}/v1/players/${encodeURIComponent(id)}`, key); if (result?.data) rows.push(flatten(result.data)); });
    } else if (["date", "allMatchResults", "leagueMatches"].includes(name)) {
      rows = matches.map(({ match, season }) => ({ ...context(match, season), ...flatten(match) }));
    } else {
      const urlName = name;
      await pool(matches, 4, async ({ match, season }) => {
        const url = matchEndpoint(urlName, match.id);
        if (!url) return;
        const result = await requestJson(url, key);
        if (result?.data != null) rows.push(...contextualRows(result.data, match, season));
      });
    }
    const body = toCsv(rows);
    const filename = `pitchapi-${name}-all-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not collect the complete dataset. Please try again." }, { status: 502 });
  }
}
