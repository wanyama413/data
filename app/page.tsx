"use client";

import { useEffect, useRef, useState } from "react";
import JSZip from "jszip";

type League = {
  id: string;
  name: string;
  country_code: string;
  seasons: string[];
};
type Row = Record<string, any>;
type Add = (dataset: string, row: Row) => void;
type Ctx = { league_id: string; season: string; match_id: string };
type Sync = { lastRun: string | null; matches: Record<string, number> };

const ENDPOINTS = [
  { key: "shots", path: "shots", label: "Shots (xG)", on: true },
  { key: "events", path: "events", label: "Events", on: true },
  { key: "stats", path: "stats", label: "Team stats", on: true },
  { key: "players", path: "players", label: "Player stats", on: true },
  { key: "lineups", path: "lineups", label: "Lineups", on: true },
  { key: "advanced", path: "advanced", label: "Advanced team", on: true },
  {
    key: "advanced_players",
    path: "advanced/players",
    label: "Advanced players",
    on: false,
  },
  {
    key: "advanced_network",
    path: "advanced/network",
    label: "Pass networks",
    on: false,
  },
  { key: "momentum", path: "momentum", label: "Momentum", on: false },
  {
    key: "player_halves",
    path: "players/halves",
    label: "Player halves",
    on: false,
  },
  { key: "heatmaps", path: "heatmaps", label: "Heatmaps (large)", on: false },
  { key: "h2h", path: "h2h", label: "Head-to-head", on: false },
];

const CONCURRENCY = 8;
const SYNC_KEY = "pitchapi-sync-v1";
const SUMMARY_BIT = 1 << 20; // "match summary row already exported"
const RECENT_MS = 3 * 24 * 3600 * 1000; // data for very recent matches may still be arriving
const bitOf = (key: string) => 1 << ENDPOINTS.findIndex((e) => e.key === key);

/* ---------------- helpers ---------------- */

async function api(path: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`/api/pitch/${path}`);
  return { status: res.status, body: await res.json().catch(() => null) };
}

function flatten(obj: any, prefix = "", out: Row = {}): Row {
  if (obj == null) return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (Array.isArray(v)) out[key] = JSON.stringify(v);
    else if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function toCsv(rows: Row[]): string {
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const r of rows)
    for (const k of Object.keys(r))
      if (!seen.has(k)) (seen.add(k), headers.push(k));

  const esc = (v: any) => {
    if (v == null) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM so Excel reads UTF-8 names correctly
  return (
    "\uFEFF" +
    [
      headers.join(","),
      ...rows.map((r) => headers.map((h) => esc(r[h])).join(",")),
    ].join("\r\n")
  );
}

/* ---------------- endpoint -> CSV rows ---------------- */

const statRow = (
  ctx: Ctx,
  extra: Row,
  group: string,
  label: string,
  s: any,
): Row => ({
  ...ctx,
  ...extra,
  group,
  label,
  stat_key: s?.key,
  type: s?.stat?.type,
  value: s?.stat?.value,
  total: s?.stat?.total,
});

const PARSERS: Record<string, (ctx: Ctx, d: any, add: Add) => void> = {
  shots: (ctx, d, add) =>
    d?.periods?.forEach((p: any) =>
      p.shots?.forEach((s: any) =>
        add("shots", { ...ctx, period: p.period, ...flatten(s) }),
      ),
    ),

  events: (ctx, d, add) =>
    d?.events?.forEach((e: any) => add("events", { ...ctx, ...flatten(e) })),

  stats: (ctx, d, add) =>
    d?.periods?.forEach((p: any) =>
      p.groups?.forEach((g: any) =>
        g.items?.forEach((it: any) =>
          add("team_stats", {
            ...ctx,
            period: p.period,
            group: g.group_name,
            key: it.key,
            title: it.title,
            home: it.home,
            away: it.away,
            format_type: it.format_type,
          }),
        ),
      ),
    ),

  players: (ctx, d, add) =>
    (d ?? []).forEach((pl: any) =>
      pl.stats?.forEach((g: any) =>
        Object.entries(g.stats ?? {}).forEach(([label, s]) =>
          add(
            "player_stats",
            statRow(
              ctx,
              {
                player_id: pl.player?.id,
                player_name: pl.player?.name,
                team_id: pl.team_id,
                position_id: pl.player?.position_id,
              },
              g.key,
              label,
              s,
            ),
          ),
        ),
      ),
    ),

  lineups: (ctx, d, add) => {
    for (const side of ["home", "away"] as const) {
      const t = d?.[side];
      const team = d?.[`${side}_team`];
      if (!t) continue;
      const base = {
        ...ctx,
        side,
        team_id: team?.id,
        team_name: team?.name,
        formation: t.formation,
        confirmed: t.confirmed,
        coach: t.coach?.name,
      };
      t.starters?.forEach((p: any) =>
        add("lineups", { ...base, role: "starter", ...flatten(p) }),
      );
      t.subs?.forEach((p: any) =>
        add("lineups", { ...base, role: "sub", ...flatten(p) }),
      );
    }
  },

  advanced: (ctx, d, add) =>
    d?.teams?.forEach((t: any) =>
      add("advanced_teams", { ...ctx, ...flatten(t) }),
    ),

  advanced_players: (ctx, d, add) =>
    d?.players?.forEach((p: any) =>
      add("advanced_players", { ...ctx, ...flatten(p) }),
    ),

  advanced_network: (ctx, d, add) =>
    d?.networks?.forEach((n: any) => {
      const t = {
        team_id: n.team?.id,
        team_name: n.team?.name,
        centralization: n.centralization,
        window_kind: n.window?.kind,
        window_until_seconds: n.window?.until_seconds,
      };
      n.nodes?.forEach((nd: any) =>
        add("pass_network_nodes", { ...ctx, ...t, ...flatten(nd) }),
      );
      n.edges?.forEach((e: any) =>
        add("pass_network_edges", {
          ...ctx,
          team_id: t.team_id,
          from_id: e.from?.id,
          from_name: e.from?.name,
          to_id: e.to?.id,
          to_name: e.to?.name,
          passes: e.passes,
        }),
      );
    }),

  momentum: (ctx, d, add) =>
    d?.points?.forEach((p: any) =>
      add("momentum", { ...ctx, minute: p.minute, value: p.value }),
    ),

  player_halves: (ctx, d, add) =>
    d?.players?.forEach((pl: any) =>
      pl.periods?.forEach((per: any) =>
        per.stats?.forEach((g: any) =>
          Object.entries(g.stats ?? {}).forEach(([label, s]) =>
            add(
              "player_halves",
              statRow(
                ctx,
                {
                  player_id: pl.player?.id,
                  player_name: pl.player?.name,
                  team_id: pl.team_id,
                  period: per.period,
                },
                g.key,
                label,
                s,
              ),
            ),
          ),
        ),
      ),
    ),

  heatmaps: (ctx, d, add) => {
    d?.teams?.forEach((t: any) =>
      t.cells?.forEach(([cx, cy, n]: number[]) =>
        add("heatmap_cells", {
          ...ctx,
          entity: "team",
          side: t.side,
          team_id: t.team?.id,
          player_id: "",
          cell_x: cx,
          cell_y: cy,
          actions: n,
        }),
      ),
    );
    d?.players?.forEach((p: any) =>
      p.cells?.forEach(([cx, cy, n]: number[]) =>
        add("heatmap_cells", {
          ...ctx,
          entity: "player",
          side: p.side,
          team_id: p.team?.id,
          player_id: p.player?.id,
          cell_x: cx,
          cell_y: cy,
          actions: n,
        }),
      ),
    );
  },

  h2h: (ctx, d, add) => {
    if (!d) return;
    add("h2h_summary", {
      ...ctx,
      home_wins: d.home_wins,
      draws: d.draws,
      away_wins: d.away_wins,
      total_matches: d.total_matches,
    });
    d.recent_matches?.forEach((m: any) =>
      add("h2h_recent", {
        ...ctx,
        time_utc: m.time_utc,
        home_id: m.home?.id,
        home_name: m.home?.name,
        away_id: m.away?.id,
        away_name: m.away?.name,
        score_home: m.score_home,
        score_away: m.score_away,
        finished: m.finished,
      }),
    );
  },
};

/* ---------------- page ---------------- */

export default function Page() {
  const [leagues, setLeagues] = useState<League[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [endpoints, setEndpoints] = useState(
    () => new Set(ENDPOINTS.filter((e) => e.on).map((e) => e.key)),
  );
  const [mode, setMode] = useState<"full" | "new">("full");
  const [includeUpcoming, setIncludeUpcoming] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState("");
  const [stats, setStats] = useState({ matches: 0, requests: 0, errors: 0 });
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [sync, setSync] = useState<Sync>({ lastRun: null, matches: {} });

  const rowsRef = useRef<Record<string, Row[]>>({});
  const pendingRef = useRef<Record<string, number>>({});
  const syncRef = useRef<Sync>({ lastRun: null, matches: {} });
  const stopRef = useRef(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SYNC_KEY);
      if (raw) {
        syncRef.current = JSON.parse(raw);
        setSync(syncRef.current);
      }
    } catch {}
    api("leagues").then(({ body }) => {
      const list: League[] = body?.data?.leagues ?? [];
      setLeagues(list);
      setSelected(new Set(list.map((l) => l.id)));
    });
  }, []);

  function toggle<T>(set: Set<T>, v: T, apply: (s: Set<T>) => void) {
    const n = new Set(set);
    n.has(v) ? n.delete(v) : n.add(v);
    apply(n);
  }

  function resetSync() {
    syncRef.current = { lastRun: null, matches: {} };
    setSync(syncRef.current);
    try {
      localStorage.removeItem(SYNC_KEY);
    } catch {}
  }

  async function download() {
    const zip = new JSZip();
    const countsNow: Record<string, number> = {};
    for (const [name, rows] of Object.entries(rowsRef.current)) {
      if (!rows.length) continue;
      countsNow[name] = rows.length;
      zip.file(`${name}.csv`, toCsv(rows));
    }
    zip.file(
      "manifest.json",
      JSON.stringify(
        { generated_at: new Date().toISOString(), mode, files: countsNow },
        null,
        2,
      ),
    );

    const blob = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pitchapi-${mode === "new" ? "update" : "full"}-${new Date()
      .toISOString()
      .replace(/[:T]/g, "-")
      .slice(0, 16)}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);

    // Commit sync state only once the data has actually been downloaded
    const merged = { ...syncRef.current.matches };
    for (const [id, bits] of Object.entries(pendingRef.current))
      merged[id] = (merged[id] ?? 0) | bits;
    syncRef.current = { lastRun: new Date().toISOString(), matches: merged };
    pendingRef.current = {};
    setSync(syncRef.current);
    try {
      localStorage.setItem(SYNC_KEY, JSON.stringify(syncRef.current));
    } catch {
      setLog(
        "Downloaded, but sync state could not be saved (browser storage full).",
      );
    }
  }

  async function run() {
    rowsRef.current = {};
    pendingRef.current = {};
    stopRef.current = false;
    setRunning(true);
    setCounts({});
    setStats({ matches: 0, requests: 0, errors: 0 });

    const counters = { matches: 0, requests: 0, errors: 0 };
    const add: Add = (ds, row) => (rowsRef.current[ds] ??= []).push(row);
    const push = () => {
      setStats({ ...counters });
      setCounts(
        Object.fromEntries(
          Object.entries(rowsRef.current).map(([k, v]) => [k, v.length]),
        ),
      );
    };
    const mark = (id: string, bit: number) =>
      (pendingRef.current[id] = (pendingRef.current[id] ?? 0) | bit);

    const chosen = ENDPOINTS.filter((e) => endpoints.has(e.key));
    const known = mode === "new" ? syncRef.current.matches : {};

    for (const league of leagues.filter((l) => selected.has(l.id))) {
      if (stopRef.current) break;
      setLog(`${league.name}: loading match list…`);

      // No `season` param -> the API returns the current season
      const list = await api(
        `leagues/${league.id}/matches${includeUpcoming ? "?status=all" : ""}`,
      );
      counters.requests++;
      const matches: any[] = list.body?.data?.matches ?? [];
      const season: string =
        list.body?.data?.league?.season ?? league.seasons[0];

      type Job = {
        m: any;
        ep: (typeof ENDPOINTS)[number] | null;
        finished: boolean;
        recent: boolean;
      };
      const jobs: Job[] = [];
      for (const m of matches) {
        const prev = known[m.id] ?? 0;
        const finished = m.status === "finished";
        const recent =
          Date.now() - new Date(m.time_utc ?? m.date).getTime() < RECENT_MS;
        if (!(prev & SUMMARY_BIT)) jobs.push({ m, ep: null, finished, recent });
        // Fixtures only have (predicted) lineups; everything else needs a played match
        const eps = finished
          ? chosen
          : chosen.filter((e) => e.key === "lineups");
        for (const ep of eps)
          if (!(prev & bitOf(ep.key))) jobs.push({ m, ep, finished, recent });
      }
      if (!jobs.length) continue;

      let i = 0;
      const worker = async () => {
        while (!stopRef.current) {
          const job = jobs[i++];
          if (!job) return;
          const { m, ep, finished, recent } = job;
          const ctx: Ctx = { league_id: league.id, season, match_id: m.id };

          if (!ep) {
            add("matches", {
              league_id: league.id,
              league_name: league.name,
              season,
              ...flatten(m),
            });
            counters.matches++;
            if (finished) mark(m.id, SUMMARY_BIT);
            continue;
          }

          const { status, body } = await api(`matches/${m.id}/${ep.path}`);
          counters.requests++;

          if (status === 200) {
            PARSERS[ep.key]?.(ctx, body?.data, add);
            if (finished) mark(m.id, bitOf(ep.key));
          } else if (status === 404) {
            // e.g. ANALYTICS_UNAVAILABLE. Retry recent matches next sync (data can lag), give up on old ones.
            if (finished && !recent) mark(m.id, bitOf(ep.key));
          } else {
            counters.errors++;
            add("errors", { ...ctx, endpoint: ep.key, status });
          }

          if (counters.requests % 25 === 0) {
            push();
            setLog(`${league.name} ${season}: ${counters.requests} requests…`);
          }
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      push();
    }

    push();
    const total = Object.values(rowsRef.current).reduce(
      (n, r) => n + r.length,
      0,
    );
    setLog(
      stopRef.current
        ? "Stopped. Download to keep what was collected."
        : total
          ? "Done. Download your CSVs."
          : "Nothing new since the last sync.",
    );
    setRunning(false);
  }

  const hasRows = Object.values(counts).some((n) => n > 0);

  return (
    <main
      style={{
        maxWidth: 900,
        margin: "40px auto",
        padding: 16,
        fontFamily: "system-ui",
      }}
    >
      <h1>PitchAPI export – current season (CSV)</h1>

      <section>
        <h3>
          Leagues ({selected.size}/{leagues.length}){" "}
          <button
            onClick={() => setSelected(new Set(leagues.map((l) => l.id)))}
          >
            All
          </button>{" "}
          <button onClick={() => setSelected(new Set())}>None</button>
        </h3>
        <div style={{ columns: 3, fontSize: 14 }}>
          {leagues.map((l) => (
            <label key={l.id} style={{ display: "block" }}>
              <input
                type="checkbox"
                checked={selected.has(l.id)}
                onChange={() => toggle(selected, l.id, setSelected)}
              />{" "}
              {l.name} <small>({l.country_code})</small>
            </label>
          ))}
        </div>
      </section>

      <section>
        <h3>Data to download</h3>
        <div style={{ columns: 3, fontSize: 14 }}>
          {ENDPOINTS.map((e) => (
            <label key={e.key} style={{ display: "block" }}>
              <input
                type="checkbox"
                checked={endpoints.has(e.key)}
                onChange={() => toggle(endpoints, e.key, setEndpoints)}
              />{" "}
              {e.label}
            </label>
          ))}
        </div>
        <p>
          <label>
            <input
              type="checkbox"
              checked={includeUpcoming}
              onChange={(e) => setIncludeUpcoming(e.target.checked)}
            />{" "}
            Include upcoming fixtures (and predicted lineups)
          </label>
        </p>
      </section>

      <section>
        <h3>Mode</h3>
        <label style={{ display: "block" }}>
          <input
            type="radio"
            checked={mode === "full"}
            onChange={() => setMode("full")}
          />{" "}
          Full export (everything in the current season)
        </label>
        <label style={{ display: "block" }}>
          <input
            type="radio"
            checked={mode === "new"}
            onChange={() => setMode("new")}
          />{" "}
          New data only (skip matches already downloaded)
        </label>
        <p style={{ fontSize: 13, color: "#666" }}>
          Last sync:{" "}
          {sync.lastRun ? new Date(sync.lastRun).toLocaleString() : "never"} ·{" "}
          {Object.keys(sync.matches).length} matches tracked{" "}
          <button onClick={resetSync} disabled={!sync.lastRun}>
            Reset sync
          </button>
        </p>
      </section>

      <p>
        <button onClick={run} disabled={running || !selected.size}>
          {running
            ? "Running…"
            : mode === "new"
              ? "Fetch new data"
              : "Start export"}
        </button>{" "}
        <button onClick={() => (stopRef.current = true)} disabled={!running}>
          Stop
        </button>{" "}
        <button onClick={download} disabled={running || !hasRows}>
          Download CSV (.zip)
        </button>
      </p>

      <p>
        {log}
        <br />
        Matches: {stats.matches} · Requests: {stats.requests} · Errors:{" "}
        {stats.errors}
      </p>

      {hasRows && (
        <table style={{ fontSize: 13, borderCollapse: "collapse" }}>
          <tbody>
            {Object.entries(counts).map(([name, n]) => (
              <tr key={name}>
                <td style={{ padding: "2px 16px 2px 0" }}>{name}.csv</td>
                <td>{n.toLocaleString()} rows</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
