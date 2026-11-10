"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { ArrowRight } from "lucide-react";
import { connectionResponse } from "../lib/connection-response";
import SocialPlatformIcon from "./social-platform-icon";

type Platform = "instagram" | "tiktok" | "facebook";
type Account = { platform: Platform; configured: boolean; connected: boolean; needsReconnect?: boolean; legacy?: boolean; name?: string; accountId?: string };
const platforms: { id: Platform; label: string; description: string }[] = [
  { id: "instagram", label: "Instagram", description: "Connect your professional Instagram account directly. No Facebook Page is needed." },
  { id: "tiktok", label: "TikTok", description: "Connect your TikTok profile through TikTok Login Kit." },
  { id: "facebook", label: "Facebook", description: "Connect your personal Facebook profile for identity. Meta does not expose personal-profile Insights here." },
];

export default function SocialConnections({ user }: { user: User }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState<Platform | null>(null);
  const [error, setError] = useState(() => {
    if (typeof window === "undefined") return "";
    const params = new URLSearchParams(window.location.search);
    return params.get("social") === "error" ? params.get("message") || "Account connection failed." : params.get("social") === "connected" ? `${params.get("platform") || "Account"} connected successfully.` : "";
  });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("social")) window.history.replaceState(null, "", window.location.pathname);
    let active = true;
    user.getIdToken().then(token => fetch("/api/social", { headers: { Authorization: `Bearer ${token}` } })).then(async response => {
      const result = await connectionResponse<{ accounts?: Account[]; error?: string }>(response, "Could not load connections");
      if (active) setAccounts(result.accounts || []);
    }).catch(issue => { if (active) { setLoadFailed(true); setError(issue instanceof Error ? issue.message : "Could not load connections."); } }).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [user]);

  async function connect(platform: Platform) {
    setBusy(platform); setError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/social", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ platform }) });
      const result = await connectionResponse<{ url?: string; error?: string }>(response, "Could not start account connection");
      if (!result.url) throw new Error("The provider did not return a connection URL.");
      window.location.assign(result.url);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Could not connect the account."); setBusy(null); }
  }

  async function disconnect(platform: Platform) {
    setBusy(platform); setError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/social?platform=${platform}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      await connectionResponse<{ error?: string }>(response, "Could not disconnect the account");
      setAccounts(previous => previous.map(account => account.platform === platform ? { ...account, connected: false, name: undefined } : account));
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Could not disconnect the account."); }
    finally { setBusy(null); }
  }

  return <section className="social-connections" aria-label="Social accounts">
    <div className="social-heading"><div><span className="section-kicker">YOUR CHANNELS</span><h2>Social accounts</h2></div><p>Connect your own accounts to Daylight.</p></div>
    {error && <p className="social-message" role="status">{error}</p>}
    <div className="social-connection-grid">{platforms.map(({ id, label, description }) => {
      const account = accounts.find(item => item.platform === id);
      const connected = Boolean(account?.connected);
      return <div className="card social-connection-card" key={id}>
        <div className={`social-mark ${id}`} aria-hidden="true"><SocialPlatformIcon platform={id} size={27}/></div>
        <div className="social-card-copy"><h3>{label}</h3><p>{account?.name || description}</p>{account?.accountId && <small className="account-identity">Account {account.accountId}</small>}<span className={`connection-status ${connected ? "ready" : ""}`}>{!ready ? "Checking…" : loadFailed ? "Status unavailable" : connected ? "Connected to this workspace" : account?.legacy ? "Older Page link: reconnect directly" : account?.needsReconnect ? "Reconnect required" : account?.configured ? "Ready to connect" : "Setup needed"}</span></div>
        <div className="social-card-actions"><button className="subtle-button" onClick={() => void connect(id)} disabled={!ready || busy !== null}>{busy === id ? "Opening…" : connected || account?.needsReconnect ? `Reconnect ${label}` : `Connect ${label}`} <ArrowRight size={15}/></button>{(connected || account?.needsReconnect) && <button className="social-disconnect" onClick={() => void disconnect(id)} disabled={busy !== null}>Disconnect</button>}</div>
      </div>;
    })}</div>
    {ready && accounts.some(account => !account.configured) && <p className="fine-print">To complete account authorization, add each platform’s developer app credentials in Vercel. <a href="https://github.com/itzkumu/daylight-public/blob/main/docs/integrations.md#connect-your-social-accounts" target="_blank" rel="noreferrer">See the setup steps ↗</a></p>}
    <p className="fine-print">Instagram and TikTok profile numbers appear in Analytics when their developer permissions are active. Facebook personal profiles expose name and photo here, but not Page-style Insights.</p>
  </section>;
}
