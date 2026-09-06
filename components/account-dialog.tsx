"use client";
import { useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Modal } from "@/components/modal";

export function AccountDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(create = false) {
    const supabase = getBrowserSupabase();
    if (!supabase) { setMessage("Account sync is unavailable. You can still rate and download as a guest."); return; }
    setBusy(true);
    setMessage("");
    try {
      const result = create
        ? await supabase.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: `${location.origin}/` } })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) setMessage(result.error.message);
      else if (create && !result.data.session) setMessage("Check your email to finish creating your account.");
      else onClose();
    } catch { setMessage("Could not connect. Please try again."); }
    finally { setBusy(false); }
  }
  async function signOut() {
    setBusy(true);
    try {
      const result = await getBrowserSupabase()?.auth.signOut({ scope: "local" });
      if (result?.error) setMessage("Could not sign out. Try again."); else onClose();
    } catch { setMessage("Could not sign out. Try again."); }
    finally { setBusy(false); }
  }
  return <Modal labelId="account-title" onClose={onClose}>
    <div className="dialog-heading"><div><span className="eyebrow">Your account</span><h2 id="account-title">{user ? "Your ratings, saved" : "Keep your match history"}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close account">×</button></div>
    {user ? <><p className="muted">{user.email}</p><p>Your account ratings stay separate from guest ratings on this device.</p><button className="button secondary" onClick={() => void signOut()} disabled={busy}>Sign out on this device</button></>
      : <><p className="muted">Sign in to keep ratings across devices. Rating and downloading are also available without an account.</p>
        <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
          <label className="form-field">Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label className="form-field">Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <div className="dialog-actions"><button type="submit" className="button primary" disabled={busy || !email || !password}>{busy ? "Connecting…" : "Sign in"}</button><button type="button" className="button secondary" onClick={() => void submit(true)} disabled={busy || !email || password.length < 8}>Create account</button></div>
          <small className="muted">New accounts need a password of at least 8 characters.</small>
        </form></>}
    {message && <p role="status" className="notice">{message}</p>}
  </Modal>;
}
