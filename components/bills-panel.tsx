"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowUpRight, FileText, Plus, ScanLine, Trash2, UploadCloud, X } from "lucide-react";
import { connectDrive, disconnectDrive, getDriveConnection, removeBillFromDashboard, saveBill, scanBillWithAI, type BillReview, type DriveConnection } from "../lib/bills";
import { scanBillOnDevice } from "../lib/bill-ocr-client";
import type { Bill } from "../lib/firebase-data";

const categories = ["Food & drink", "Transport", "Shopping", "Bills", "Subscriptions", "Health", "Other"];
const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const blankReview = (): BillReview => ({ merchant: "", date: today(), total: 0, currency: "LKR", amountLkr: 0, category: "Other", items: [] });
const money = (cents: number) => new Intl.NumberFormat("en-LK", { style: "currency", currency: "LKR", maximumFractionDigits: 2 }).format(cents / 100);

export default function BillsPanel({ userId, bills, onBillSaved }: { userId: string; bills: Bill[]; onBillSaved?: (month: string) => void }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [review, setReview] = useState<BillReview>(blankReview);
  const [itemsText, setItemsText] = useState("");
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removingBusy, setRemovingBusy] = useState(false);
  const [drive, setDrive] = useState<DriveConnection | null>(null);
  const [driveBusy, setDriveBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("drive") === "error") queueMicrotask(() => setError(params.get("message") || "Could not connect Google Drive."));
    if (params.has("drive")) window.history.replaceState(null, "", window.location.pathname);
    getDriveConnection(userId).then(result => { if (active) setDrive(result); }).catch(issue => { if (active) setError(issue instanceof Error ? issue.message : "Could not check Google Drive."); });
    return () => { active = false; };
  }, [userId]);

  async function manageDrive(disconnect = false) {
    setDriveBusy(true); setError("");
    try {
      if (disconnect) { await disconnectDrive(userId); setDrive(previous => ({ configured: previous?.configured || false, connected: false })); }
      else await connectDrive(userId);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "Could not connect Google Drive."); }
    finally { setDriveBusy(false); }
  }

  function selectFile(selected: File | null) {
    setFile(selected); setPreview(""); setReview(blankReview()); setItemsText(""); setError("");
    if (selected?.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => setPreview(typeof reader.result === "string" ? reader.result : "");
      reader.readAsDataURL(selected);
    }
  }

  function close() {
    if (saving || scanning) return;
    setOpen(false); setFile(null); setPreview(""); setReview(blankReview()); setItemsText(""); setError("");
  }

  async function scan(useCloud = false) {
    if (!file) return;
    setScanning(true); setError("");
    try {
      const result = useCloud ? await scanBillWithAI(file) : await scanBillOnDevice(file, setScanProgress);
      setReview({ ...result, amountLkr: result.currency === "LKR" ? result.total : 0 });
      setItemsText(result.items.join("\n"));
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not scan this bill. You can enter its details below.");
    } finally { setScanning(false); setScanProgress(""); }
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) { setError("Choose a bill first."); return; }
    setSaving(true); setError("");
    try {
      if (!drive?.connected) throw new Error("Connect Google Drive once, then save this bill.");
      await saveBill(userId, file, { ...review, items: itemsText.split("\n").map(item => item.trim()).filter(Boolean) });
      onBillSaved?.(review.date.slice(0, 7));
      closeAfterSave();
    } catch (issue) {
      setError(issue instanceof Error ? issue.message : "Could not save this bill.");
    } finally { setSaving(false); }
  }

  function closeAfterSave() {
    setOpen(false); setFile(null); setPreview(""); setReview(blankReview()); setItemsText(""); setError("");
  }

  async function remove(bill: Bill) {
    setRemovingBusy(true); setError("");
    try { await removeBillFromDashboard(userId, bill); setRemovingId(null); }
    catch (issue) { setError(issue instanceof Error ? issue.message : "Could not remove this bill."); }
    finally { setRemovingBusy(false); }
  }

  return <>
    <section className="card bills-card" aria-labelledby="bills-title">
      <div className="card-title-row bills-heading"><div><span className="section-kicker">YOUR RECORDS</span><h2 id="bills-title">Bills & receipts</h2><p>Scan the details. Keep the original in your Google Drive.</p></div><button className="primary-button" onClick={() => setOpen(true)}><Plus size={17} /> Add bill</button></div>
      <div className="bill-drive-status"><span>{!drive ? "Checking Google Drive…" : !drive.configured ? "Drive OAuth server setup needed" : drive.connected ? `Drive connected: ${drive.email || "your account"}` : drive.needsReconnect ? "Drive access expired" : "Connect Drive once to save bills"}</span>{drive?.connected ? <button type="button" onClick={() => void manageDrive(true)} disabled={driveBusy}>Disconnect</button> : <button type="button" onClick={() => void manageDrive()} disabled={driveBusy || !drive?.configured}>{driveBusy ? "Opening…" : drive?.needsReconnect ? "Reconnect Drive" : "Connect Drive"}</button>}</div>
      {error && !open && <p className="bill-error" role="alert">{error}</p>}
      {bills.length ? <div className="bills-list">{bills.map(bill => <div className="bill-row" key={bill.id}>
        <span className="bill-icon"><FileText size={19} /></span>
        <div className="bill-details"><strong>{bill.merchant}</strong><small>{bill.category} · {new Date(`${bill.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{bill.items.length ? ` · ${bill.items.length} items` : ""}</small></div>
        <strong className="bill-amount">{money(bill.amount)}</strong>
        <a className="bill-drive-link" href={bill.driveUrl} target="_blank" rel="noreferrer" aria-label={`Open ${bill.fileName} in Google Drive`}>Drive <ArrowUpRight size={15} /></a>
        {removingId === bill.id ? <div className="bill-remove-confirm"><span>Remove bill and expense? File stays in Drive.</span><button disabled={removingBusy} onClick={() => void remove(bill)}>Remove</button><button onClick={() => setRemovingId(null)}>Cancel</button></div> : <button className="delete-button" aria-label={`Remove ${bill.merchant} and its expense from Daylight`} onClick={() => setRemovingId(bill.id)}><Trash2 size={16} /></button>}
      </div>)}</div> : <div className="bills-empty"><span className="bills-empty-icon"><ScanLine size={23} /></span><div><strong>No bills saved yet</strong><p>Add a photo or PDF to start keeping the details and original together.</p></div></div>}
    </section>

    {open && <div className="modal-backdrop bill-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><div className="modal bill-modal" role="dialog" aria-modal="true" aria-labelledby="bill-modal-title"><div className="modal-header"><div><span className="section-kicker">SAVE A BILL</span><h2 id="bill-modal-title">Add a bill or receipt</h2></div><button className="close-button" onClick={close} disabled={saving || scanning} aria-label="Close"><X size={20} /></button></div>
      <div className="bill-modal-content">
        <div className="bill-upload-column"><label className="bill-upload-zone"><UploadCloud size={24} /><strong>{file ? file.name : "Choose a photo or PDF"}</strong><span>JPG, PNG, WebP or PDF · up to 5 MB</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={event => selectFile(event.target.files?.[0] || null)} /></label>
          {preview && <Image className="bill-preview" src={preview} alt="Selected bill preview" width={400} height={250} unoptimized />}
          {file?.type === "application/pdf" && <div className="bill-pdf-preview"><FileText size={23} /> PDF selected</div>}
          <button className="scan-button" type="button" onClick={() => void scan()} disabled={!file || scanning || saving}><ScanLine size={17} /> {scanning ? "Reading bill…" : "Read on this device"}</button>
          {scanning && <p className="bill-scan-note" role="status">{scanProgress || "Reading the bill…"}</p>}
          <button className="subtle-button bill-cloud-scan" type="button" onClick={() => void scan(true)} disabled={!file || scanning || saving}>Improve with cloud AI</button>
          <p className="bill-scan-note">Device reading keeps the bill on your phone until you save it. Cloud AI sends the bill to Gemini only if you choose it. Review the amount and date before saving.</p>
        </div>
        <form className="bill-review-form" onSubmit={save}><span className="section-kicker">REVIEW DETAILS</span>
          <label>Store or biller<input required value={review.merchant} onChange={event => setReview(value => ({ ...value, merchant: event.target.value }))} placeholder="e.g. Grocery store" /></label>
          <div className="bill-form-pair"><label>Date<input required type="date" value={review.date} onChange={event => setReview(value => ({ ...value, date: event.target.value }))} /></label><label>Category<select value={review.category} onChange={event => setReview(value => ({ ...value, category: event.target.value }))}>{categories.map(category => <option key={category}>{category}</option>)}</select></label></div>
          <div className="bill-form-pair"><label>Amount paid (LKR)<input required type="number" min="0.01" step="0.01" value={review.amountLkr || ""} onChange={event => setReview(value => ({ ...value, amountLkr: Number(event.target.value) }))} placeholder="0.00" /></label><label>On bill<input value={review.total ? `${review.currency} ${review.total.toFixed(2)}` : ""} readOnly placeholder="Scan to detect" /></label></div>
          {review.currency !== "LKR" && <p className="bill-conversion-note">This bill uses {review.currency}. Enter the amount you paid in LKR for your spending totals.</p>}
          <label>Items <span>optional, one per line</span><textarea value={itemsText} onChange={event => setItemsText(event.target.value)} placeholder="Items from the bill" rows={4} /></label>
          {error && <p className="bill-error" role="alert">{error}</p>}
          <button className="primary-button bill-save-button" type="submit" disabled={!file || scanning || saving || !drive?.connected}>{saving ? "Saving to Drive…" : "Save bill & expense"} <ArrowUpRight size={17} /></button>
          <p className="bill-save-note">{drive?.connected ? "Drive stays connected for later bills. Reconnect only if Google expires or revokes access." : "Connect Google Drive above once, then add your bill."}</p>
        </form>
      </div></div></div>}
  </>;
}
