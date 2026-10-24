"use client";
import { useState } from "react";

type Endpoint = { id: string; title: string; description: string; group: string };
const data: Endpoint[] = [
 { id:"date", title:"All match dates", description:"Every available fixture and result, grouped with its match date.", group:"Schedule" },
 { id:"allMatchResults", title:"All match results", description:"Every available match result across all leagues and seasons.", group:"Schedule" },
 { id:"leagues", title:"All leagues", description:"League catalogue and available seasons.", group:"Reference" },
 { id:"league", title:"League details", description:"Full profile details for every league.", group:"Reference" },
 { id:"leagueMatches", title:"League matches", description:"Season results and fixtures for every league.", group:"Reference" },
 { id:"team", title:"Team details", description:"Profiles for every team in the match catalogue.", group:"Reference" },
 { id:"player", title:"Player details", description:"Profiles for every player in the match catalogue.", group:"Reference" },
 { id:"matches", title:"Match summaries", description:"Score, teams, date, and status for every match.", group:"Match data" },
 { id:"shots", title:"Shots", description:"Shot locations, outcomes, and expected goals across matches.", group:"Match data" },
 { id:"shot", title:"Shots (individual endpoint)", description:"All shot records returned across every match.", group:"Match data" },
 { id:"momentum", title:"Match momentum", description:"Minute-by-minute pressure values across matches.", group:"Match data" },
 { id:"events", title:"Match events", description:"Goals, cards, substitutions, and penalties across matches.", group:"Match data" },
 { id:"players", title:"Match player stats", description:"Stat lines for every player in every match.", group:"Match data" },
 { id:"playerStats", title:"Player match stats", description:"All player stat lines across every match.", group:"Match data" },
 { id:"playerHalves", title:"Player stats by half", description:"First and second half stats across every match.", group:"Match data" },
 { id:"playerHalfStats", title:"Player half stats (individual endpoint)", description:"All per-player half stat lines across every match.", group:"Match data" },
 { id:"playerShots", title:"Player shots", description:"All shots, organized by their match and player.", group:"Match data" },
 { id:"lineups", title:"Lineups", description:"Formations, starters, benches, and coaches across matches.", group:"Match data" },
 { id:"h2h", title:"Head-to-head", description:"Previous meetings for every match in the catalogue.", group:"Match data" },
 { id:"teamStats", title:"Team stats", description:"Statistics by half and full match across matches.", group:"Match data" },
 { id:"advanced", title:"Advanced match analytics", description:"Possession value, passing, defending, and more across matches.", group:"Advanced analytics" },
 { id:"passNetwork", title:"Pass networks", description:"Passing connections and player positions across matches.", group:"Advanced analytics" },
 { id:"advancedPlayers", title:"Advanced player analytics", description:"Advanced metrics for every player in every match.", group:"Advanced analytics" },
 { id:"advancedPlayer", title:"Advanced player details", description:"Full player analytics across every available match.", group:"Advanced analytics" },
 { id:"heatmaps", title:"Team and player heatmaps", description:"Pitch activity grids for every match.", group:"Advanced analytics" },
];
const groups = ["Schedule", "Reference", "Match data", "Advanced analytics"];
export default function Home() {
 const [busy, setBusy] = useState<string | null>(null);
 const [message, setMessage] = useState("");
 async function download(item: Endpoint) {
   setMessage(""); setBusy(item.id);
   try {
     const query = new URLSearchParams({ endpoint: item.id });
     const response = await fetch(`/api/download?${query.toString()}`);
     if (!response.ok) { const detail = await response.json().catch(() => null); throw new Error(detail?.error || "Download failed. Please try again."); }
     const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a");
     link.href = url; link.download = `pitchapi-${item.id}-${new Date().toISOString().slice(0,10)}.csv`; document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(url);
   } catch (error) { setMessage(error instanceof Error ? error.message : "Download failed. Please try again."); }
   finally { setBusy(null); }
 }
 return <main className="shell">
   <header className="topbar"><a className="brand" href="#top"><span className="brand-mark">P</span> <span>pitch<span className="brand-light">data</span></span></a><a className="docs-link" href="https://pitchapi.dev/" target="_blank" rel="noreferrer">PitchAPI docs <span>↗</span></a></header>
   <section className="hero" id="top"><div className="eyebrow"><span className="live-dot"/> FOOTBALL DATA EXPORTER</div><h1>Your data,<br/><em>ready to download.</em></h1><p className="intro">Download complete PitchAPI datasets as CSV. Each export gathers every available league, season, and match for that data type.</p><div className="hero-note"><span className="note-icon">↳</span><span>Choose a data type and download the full collection. Large exports may take a little while to prepare.</span></div></section>
   {message && <div className="alert" role="alert"><span>!</span>{message}<button onClick={()=>setMessage("")} aria-label="Dismiss">×</button></div>}
   <section className="catalogue">{groups.map((group,index)=><div className="group" key={group}><div className="group-head"><div><span className="group-index">0{index+1}</span><h2>{group}</h2></div><span className="count">{data.filter(item=>item.group===group).length} EXPORTS</span></div><div className="grid">{data.filter(item=>item.group===group).map(item=><article className="card" key={item.id}><div className="card-top"><span className="file-icon"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6.75 3.75h7l4.5 4.5v12h-11.5z"/><path d="M13.75 3.75v5h4.5M9 13h7M9 16.5h7"/></svg></span><span className="format">CSV <span>↓</span></span></div><h3>{item.title}</h3><p className="description">{item.description}</p><div className="no-fields"><span className="check">✓</span> Full dataset · all available matches</div><button className="download" onClick={()=>download(item)} disabled={busy!==null}>{busy===item.id?<><span className="spinner"/> Collecting all data…</>:<>Download CSV <span>↗</span></>}</button></article>)}</div></div>)}</section>
   <footer><span>Built for football data people.</span><a href="https://pitchapi.dev/" target="_blank" rel="noreferrer">Powered by PitchAPI <span>↗</span></a></footer>
 </main>
}
