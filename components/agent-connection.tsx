"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { Bot, Copy, KeyRound } from "lucide-react";

type KeySummary = { id: string; name: string; scope: "read" | "write"; createdAt: string };

export default function AgentConnection({ user }: { user: User }) {
  const [keys, setKeys] = useState<KeySummary[]>([]);
  const [scope, setScope] = useState<"read" | "write">("read");
  const [newKey, setNewKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const endpoint = typeof window === "undefined" ? "" : `${window.location.origin}/api/mcp`;

  useEffect(() => {
    let active = true;
    user.getIdToken().then(token => fetch("/api/agent-keys", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }))
      .then(async response => { if (!response.ok) throw new Error("Could not load agent keys."); return response.json() as Promise<{ keys: KeySummary[] }>; })
      .then(result => { if (active) setKeys(result.keys); })
      .catch(issue => { if (active) setMessage(issue instanceof Error ? issue.message : "Could not load agent keys."); })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [user]);

  async function create() {
    setBusy(true); setMessage(""); setNewKey("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/agent-keys", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Hermes Agent", scope }) });
      const result = await response.json() as { key?: string; summary?: KeySummary; error?: string };
      if (!response.ok || !result.key || !result.summary) throw new Error(result.error || "Could not create the key.");
      setKeys(previous => [result.summary!, ...previous]); setNewKey(result.key);
      setMessage("Key created. Copy it now; Daylight will show it only once.");
    } catch (issue) { setMessage(issue instanceof Error ? issue.message : "Could not create the key."); }
    finally { setBusy(false); }
  }

  async function revoke(id: string) {
    setBusy(true); setMessage("");
    try {
      const token = await user.getIdToken();
      const response = await fetch(`/api/agent-keys?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) throw new Error("Could not revoke the key.");
      setKeys(previous => previous.filter(key => key.id !== id)); setNewKey(""); setMessage("Key revoked. Hermes can no longer use it.");
    } catch (issue) { setMessage(issue instanceof Error ? issue.message : "Could not revoke the key."); }
    finally { setBusy(false); }
  }

  async function changeAccess(id: string, nextScope: "read" | "write") {
    setBusy(true); setMessage("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/agent-keys", { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ id, scope: nextScope }) });
      const result = await response.json() as { summary?: KeySummary; error?: string };
      if (!response.ok || !result.summary) throw new Error(result.error || "Could not change access.");
      setKeys(previous => previous.map(key => key.id === id ? result.summary! : key));
      setMessage(nextScope === "write" ? "Read and write access is on for this key." : "This key is now read only.");
    } catch (issue) { setMessage(issue instanceof Error ? issue.message : "Could not change access."); }
    finally { setBusy(false); }
  }

  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setMessage("Copied to clipboard."); }
    catch { setMessage("Copy failed. Select the text and copy it manually."); }
  }

  return <section className="card agent-connection" aria-label="Agent access">
    <div className="agent-connection-heading"><span className="connection-icon"><Bot size={22}/></span><div><span className="section-kicker">EXTERNAL AGENT</span><h2>Hermes Agent</h2></div></div>
    <p>Give Hermes a private key to use Daylight tasks, money entries, content plans, and saved bills through MCP.</p>
    <div className="agent-connection-controls"><label htmlFor="agent-scope">Access</label><select id="agent-scope" value={scope} onChange={event => setScope(event.target.value as "read" | "write")} disabled={busy}><option value="read">Read only</option><option value="write">Read and write</option></select><button className="subtle-button" onClick={() => void create()} disabled={!ready || busy}><KeyRound size={15}/>{busy ? "Working…" : "Create key"}</button></div>
    {scope === "write" && <p className="agent-access-note">Write access lets Hermes add bills and money entries, manage tasks and content plans, and edit or remove Daylight entries.</p>}
    {newKey && <div className="agent-key-reveal"><strong>New key · shown once</strong><code>{newKey}</code><button className="subtle-button" onClick={() => void copy(newKey)}><Copy size={15}/> Copy key</button><button className="subtle-button" onClick={() => void copy(`mcp_servers:\n  daylight:\n    url: "${endpoint}"\n    headers:\n      Authorization: "Bearer ${newKey}"`)}><Copy size={15}/> Copy Hermes setup</button></div>}
    <div className="agent-key-list">{keys.length ? keys.map(key => <div className="agent-key-row" key={key.id}><div><strong>{key.name}</strong><small>Created {new Date(key.createdAt).toLocaleDateString()}</small></div><div className="agent-key-actions"><label htmlFor={`agent-key-scope-${key.id}`}>Access</label><select id={`agent-key-scope-${key.id}`} value={key.scope} onChange={event => void changeAccess(key.id, event.target.value as "read" | "write")} disabled={busy}><option value="read">Read only</option><option value="write">Read and write</option></select><button className="social-disconnect" onClick={() => void revoke(key.id)} disabled={busy}>Revoke</button></div></div>) : <span>{ready ? "No agent keys yet." : "Checking keys…"}</span>}</div>
    <p className="agent-setup-note">MCP address: <code>{endpoint}</code>. In Hermes, add a remote MCP server using the address and your key. Keep the key private.</p>
    {message && <p className="social-message" role="status">{message}</p>}
  </section>;
}
