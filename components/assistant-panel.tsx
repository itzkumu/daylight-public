"use client";

import { useEffect, useState } from "react";
import type { User } from "firebase/auth";
import { ArrowRight, Plus, Sparkles } from "lucide-react";
import { connectionResponse } from "../lib/connection-response";

type Message = { role: "user" | "assistant"; content: string };
const starters = ["Plan three Instagram posts for this week", "What small expenses are adding up this month?", "Help me prioritize my open tasks"];

export default function AssistantPanel({ user, onNewPost, onNewTask }: { user: User; onNewPost: () => void; onNewTask: () => void }) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    user.getIdToken().then(token => fetch("/api/assistant", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }))
      .then(response => connectionResponse<{ configured: boolean }>(response, "Could not check the assistant"))
      .then(result => { if (active) setConfigured(result.configured); })
      .catch(issue => { if (active) setError(issue instanceof Error ? issue.message : "Could not check the assistant."); });
    return () => { active = false; };
  }, [user]);

  async function send(message = draft) {
    const content = message.trim();
    if (!content || busy) return;
    const next: Message[] = [...messages, { role: "user", content }];
    setMessages(next); setDraft(""); setBusy(true); setError("");
    try {
      const token = await user.getIdToken();
      const response = await fetch("/api/assistant", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ messages: next }) });
      const result = await connectionResponse<{ answer: string }>(response, "The assistant could not reply");
      setMessages([...next, { role: "assistant", content: result.answer }]);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "The assistant could not reply."); }
    finally { setBusy(false); }
  }

  return <div className="assistant-layout">
    <section className="card assistant-chat" aria-label="Daylight assistant chat">
      <div className="assistant-chat-head"><span className="assistant-spark"><Sparkles size={19}/></span><div><h2>Ask Daylight</h2><p>Content ideas, task priorities, and spending patterns.</p></div><span className="connection-status ready">Workspace aware</span></div>
      {configured === false ? <div className="assistant-setup"><strong>Connect the OpenAI API to start chatting</strong><p>Add an <code>OPENAI_API_KEY</code> server setting in Vercel. Your ChatGPT subscription does not provide API access to this app.</p></div> : <>
        <div className="assistant-messages" aria-live="polite">{messages.length ? messages.map((item, index) => <div className={`assistant-message ${item.role}`} key={index}><span>{item.role === "user" ? "You" : "Daylight"}</span><p>{item.content}</p></div>) : <div className="assistant-welcome"><span className="section-kicker">START WITH A QUESTION</span><h3>What would you like to make clearer today?</h3><div className="assistant-starters">{starters.map(text => <button type="button" key={text} onClick={() => void send(text)} disabled={busy || configured !== true}>{text} <ArrowRight size={14}/></button>)}</div></div>}{busy && <div className="assistant-message assistant"><span>Daylight</span><p>Thinking…</p></div>}</div>
        {error && <p className="assistant-error" role="alert">{error}</p>}
        <form className="assistant-compose" onSubmit={event => { event.preventDefault(); void send(); }}><label className="sr-only" htmlFor="assistant-message">Ask Daylight</label><textarea id="assistant-message" value={draft} onChange={event => setDraft(event.target.value)} placeholder="Ask about a content plan or this month's spending…" rows={2} maxLength={2000} disabled={busy || configured !== true}/><button className="primary-button" type="submit" disabled={!draft.trim() || busy || configured !== true}>Send <ArrowRight size={16}/></button></form>
      </>}
    </section>
    <aside className="assistant-aside"><div className="card assistant-context"><span className="section-kicker">IN CONTEXT</span><h3>Your workspace, summarized</h3><p>When you send a message, Daylight shares your open task titles, content ideas, and current-month spending totals with OpenAI so the reply can be useful.</p><p>Suggestions appear here for your review. Nothing is saved or published automatically.</p></div><div className="card assistant-quick"><span className="section-kicker">TAKE ACTION</span><button type="button" onClick={onNewPost}><Plus size={16}/> Add a post idea</button><button type="button" onClick={onNewTask}><Plus size={16}/> Add a task</button></div></aside>
  </div>;
}
