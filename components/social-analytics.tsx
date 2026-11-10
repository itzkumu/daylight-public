"use client";

import { useCallback, useEffect, useState } from "react";
import type { User } from "firebase/auth";
import Image from "next/image";
import { ArrowRight, ArrowUpRight, RefreshCw } from "lucide-react";
import { connectionResponse } from "../lib/connection-response";
import SocialPlatformIcon from "./social-platform-icon";

type Platform = "instagram" | "tiktok" | "facebook";
type Item = { id: string; title: string; date: string; url?: string; views?: number; likes?: number; comments?: number; shares?: number };
type Result = { status: "setup" | "disconnected" | "expired" | "connected"; platform: Platform; error?: string; name?: string; legacy?: boolean; account?: { name: string; connectedAt: string }; profile?: { avatarUrl?: string; username?: string; displayName?: string; bio?: string }; metrics?: Array<{ label: string; value: number; note?: string }>; items?: Item[]; source?: string; coverage?: string; insightNotice?: string };
const platforms: { id: Platform; label: string }[] = [{ id: "instagram", label: "Instagram" }, { id: "tiktok", label: "TikTok" }, { id: "facebook", label: "Facebook" }];
const number = new Intl.NumberFormat("en-US");

export default function SocialAnalytics({ user, onConnections }: { user: User; onConnections: () => void }) {
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [notice, setNotice] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const label = platforms.find(item => item.id === platform)!.label;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const target = params.get("platform");
    if (target === "facebook" || target === "tiktok") queueMicrotask(() => setPlatform(target));
    if (params.get("social") === "connected") queueMicrotask(() => setNotice("Account connected. Loading its performance in Daylight."));
    if (params.get("social") === "error") queueMicrotask(() => setNotice(params.get("message") || "Account connection failed."));
    if (params.has("social")) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  async function connect() {
    setConnecting(true);
    setError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/social", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ platform }) });
      const data = await connectionResponse<{ url?: string; error?: string }>(response, `Could not connect ${label}`);
      if (!data.url) throw new Error(`${label} did not return an authorization page.`);
      window.location.assign(data.url);
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : `Could not connect ${label}.`);
      setConnecting(false);
    }
  }

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { setResult(null); setError(""); setLoading(true); });
    user.getIdToken().then(token => fetch(`/api/social/analytics?platform=${platform}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }))
      .then(response => connectionResponse<Result>(response, "Could not load analytics"))
      .then(data => { if (active) setResult(data); })
      .catch(issue => { if (active) setError(issue instanceof Error ? issue.message : "Could not load analytics."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [platform, revision, user]);

  return <section className="analytics-shell" aria-label="Social analytics">
    {notice && <div className="analytics-notice" role="status"><strong>{notice}</strong><button type="button" onClick={() => setNotice("")} aria-label="Dismiss connection notice">×</button></div>}
    <div className="analytics-tabs" role="tablist" aria-label="Social platform">{platforms.map(item => <button key={item.id} type="button" role="tab" aria-selected={platform === item.id} className={platform === item.id ? "selected" : ""} onClick={() => setPlatform(item.id)}><span className={`analytics-tab-mark ${item.id}`} aria-hidden="true"><SocialPlatformIcon platform={item.id} size={20}/></span>{item.label}</button>)}</div>
    {loading ? <div className="card analytics-state" role="status"><div className="analytics-skeleton"/><div className="analytics-skeleton short"/><div className="analytics-skeleton"/><span>Loading {platform} performance…</span></div> : error ? <div className="card analytics-state" role="alert"><span className="section-kicker">NEEDS ATTENTION</span><h2>{label} analytics could not load.</h2><p>{error}</p><div className="analytics-state-actions"><button className="subtle-button" onClick={() => void connect()} disabled={connecting}>{connecting ? "Opening…" : `Connect ${label}`} <ArrowRight size={15}/></button><button className="subtle-button" onClick={refresh}>Try again <RefreshCw size={15}/></button></div></div> : result?.status !== "connected" ? <div className="card analytics-state"><span className="section-kicker">{platform.toUpperCase()}</span><h2>{result?.status === "setup" ? "Connection setup needed" : result?.status === "expired" ? "Reconnect your account" : "Connect your account to see its numbers"}</h2><p>{result?.status === "setup" ? `${label} needs its developer app settings in Daylight before account authorization can start.` : result?.legacy ? "This is an older Page-based connection. Reconnect with your own profile to remove Page data from Daylight's dashboard." : result?.status === "expired" ? `${result.name || "Your account"} needs fresh permission before Daylight can read its performance.` : "Authorize your account once. Your real numbers will then appear here in Daylight."}</p><div className="analytics-state-actions"><button className="subtle-button" onClick={() => void connect()} disabled={connecting}>{connecting ? "Opening…" : result?.status === "expired" ? `Reconnect ${label}` : `Connect ${label}`} <ArrowRight size={15}/></button>{result?.status === "setup" && <button className="subtle-button" onClick={onConnections}>Connection details <ArrowRight size={15}/></button>}</div></div> : <>
      <div className="analytics-account"><div className="analytics-profile">{result.profile?.avatarUrl?.startsWith("https://") && <Image className="analytics-avatar" src={result.profile.avatarUrl} alt={`${result.account?.name || label} profile photo`} width={64} height={64} unoptimized/>}<div><span className="section-kicker">CONNECTED ACCOUNT</span><h2>{result.profile?.displayName || result.account?.name}</h2>{result.profile?.username && <strong className="analytics-username">@{result.profile.username}</strong>}<p>{result.profile?.bio || result.coverage} <span aria-hidden="true">·</span> Updated when you open or refresh this page</p></div></div><button className="analytics-refresh" onClick={refresh} aria-label="Refresh analytics"><RefreshCw size={16}/><span>Refresh</span></button></div>
      <div className="analytics-metrics">{result.metrics?.map(metric => <div className="card analytics-metric" key={metric.label}><span>{metric.label}</span><strong>{number.format(metric.value)}</strong><small>{metric.note || result.coverage}</small></div>)}</div>
      {result.insightNotice && <div className="analytics-notice"><strong>About these numbers</strong><p>{result.insightNotice}</p></div>}
      {platform !== "facebook" && <div className="card analytics-list"><div className="analytics-list-head"><div><span className="section-kicker">RECENT CONTENT</span><h2>{platform === "tiktok" ? "Videos" : "Posts"}</h2></div><span>{result.source}</span></div>{result.items?.length ? <div className="analytics-rows">{result.items.map(item => <div className="analytics-row" key={item.id}><div className="analytics-row-copy"><strong>{item.title}</strong><small>{item.date ? new Date(item.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Date unavailable"}</small></div><div className="analytics-row-stats">{typeof item.views === "number" && <span>{number.format(item.views)} views</span>}<span>{number.format(item.likes || 0)} likes</span><span>{number.format(item.comments || 0)} comments</span>{typeof item.shares === "number" && <span>{number.format(item.shares)} shares</span>}</div>{item.url && <a href={item.url} target="_blank" rel="noreferrer" aria-label={`Open ${item.title} in ${platform}`}><ArrowUpRight size={17}/></a>}</div>)}</div> : <div className="analytics-empty">No recent public content was returned for this account.</div>}</div>}
      {platform !== "facebook" && <p className="analytics-footnote">Live provider data. Recent content totals cover only the items shown above.</p>}
    </>}
  </section>;
}
