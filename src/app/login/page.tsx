"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Arriving from /api/auth/deactivated (blocked by a super admin).
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("deactivated")) {
      setError("Your access has been deactivated. Contact your super admin.");
    }
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    const supabase = createClient();

    if (mode === "signin") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      router.push("/");
      router.refresh();
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (error) {
        setError(error.message);
        setLoading(false);
        return;
      }
      if (data.session) {
        router.push("/");
        router.refresh();
      } else {
        setNotice("Account created. If email confirmation is enabled, confirm via email, then sign in.");
        setMode("signin");
        setLoading(false);
      }
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-brand">
          <div className="sb-logo" aria-hidden="true">LD</div>
          <div className="sb-name">
            LD Silk Mills
            <small>Grey FMS</small>
          </div>
        </div>

        <h1 className="auth-title">{mode === "signin" ? "Sign in" : "Create account"}</h1>
        <p className="auth-sub">
          {mode === "signin" ? "Welcome back. Sign in to continue." : "Set up your Grey FMS account."}
        </p>

        {mode === "signup" && (
          <div className="field">
            <label htmlFor="fullName">Full name</label>
            <input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Harshali" autoComplete="name" />
          </div>
        )}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@ldsilkmills.com" autoComplete="email" />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete={mode === "signin" ? "current-password" : "new-password"} />
        </div>

        {error && <div className="auth-msg error">{error}</div>}
        {notice && <div className="auth-msg notice">{notice}</div>}

        <button className="btn btn-primary auth-submit" type="submit" disabled={loading}>
          {loading ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
        </button>

        <div className="auth-toggle">
          {mode === "signin" ? (
            <>New here? <button type="button" onClick={() => { setMode("signup"); setError(null); }}>Create an account</button></>
          ) : (
            <>Already have an account? <button type="button" onClick={() => { setMode("signin"); setError(null); }}>Sign in</button></>
          )}
        </div>
      </form>
    </div>
  );
}
