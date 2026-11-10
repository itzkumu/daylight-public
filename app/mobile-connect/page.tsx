"use client";

import { useState } from "react";
import { getFirebase, signIn } from "../../lib/firebase-data";

export default function MobileConnect() {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  async function connect() {
    setWorking(true); setError("");
    try {
      const challenge = new URLSearchParams(location.search).get("challenge");
      if (!challenge || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) throw new Error("Open this page from the Daylight Android app.");
      const firebase = getFirebase();
      if (!firebase) throw new Error("Daylight sign-in is unavailable.");
      const user = firebase.auth.currentUser || (await signIn()).user;
      const response = await fetch("/api/mobile/auth", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${await user.getIdToken()}` }, body: JSON.stringify({ challenge }) });
      const result = await response.json() as { code?: string; error?: string };
      if (!response.ok || !result.code) throw new Error(result.error || "Could not connect Android.");
      location.href = `daylight://auth?code=${encodeURIComponent(result.code)}`;
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Could not connect Android."); }
    finally { setWorking(false); }
  }
  return <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", background: "#0d1114", color: "#f1f6f4", fontFamily: "system-ui", padding: 24 }}>
    <section style={{ maxWidth: 420, background: "#1b2428", padding: 28, borderRadius: 24 }}>
      <h1>Connect Daylight on Android</h1><p>Sign in with the same Google account you use on Daylight. Your app will then show your existing projects, tasks, money, and bills.</p>
      <button onClick={connect} disabled={working} style={{ background: "#b9f55e", border: 0, padding: "14px 20px", borderRadius: 12, fontWeight: 700 }}>{working ? "Connecting…" : "Connect Android app"}</button>
      {error && <p role="alert" style={{ color: "#ffaeae" }}>{error}</p>}
    </section>
  </main>;
}
