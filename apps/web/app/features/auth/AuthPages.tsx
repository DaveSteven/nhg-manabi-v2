import type { ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useEffect, useRef, useState } from "react";
import {
  fieldErrorFrom,
  forgotPassword,
  loginAccount,
  registerAccount,
  resendVerification,
  resetPassword,
  verifyEmail,
} from "../../api/endpoints/auth";
import { authStore } from "./authStore";
import { Button, ButtonLink } from "../../components/Button";

/**
 * Student auth pages (ADR-0011). Root-level SPA routes, noindex. Forms
 * are plain controlled state — no react-query needed for one-shot posts.
 * Field-level 400s render next to their field; everything else surfaces
 * as one form message. Resend/forgot answers are uniform by design
 * (server never reveals account existence), and the UI says so.
 */

export function AuthShell({ title, children }: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="auth-shell">
      <Link to="/" className="brand auth-brand">
        <img className="brand-mark" src="/favicon.svg" alt="" width={30} height={30} />
        <img className="brand-wordmark" src="/minao-wordmark.svg" alt="MINAO" width={78} height={20} />
      </Link>
      <section className="card auth-card" aria-label={title}>
        <h1>{title}</h1>
        {children}
      </section>
    </main>
  );
}

function FieldError({ message }: { message: string | null }) {
  if (!message) return null;
  return <p className="field-error" role="alert">{message}</p>;
}

function FormMessage({ message, kind }: {
  message: string | null;
  kind: "error" | "info";
}) {
  if (!message) return null;
  return (
    <p className={kind === "error" ? "field-error" : "form-info"}
       role={kind === "error" ? "alert" : "status"}>
      {message}
    </p>
  );
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token, user } = await loginAccount(email, password);
      authStore.setSession(token, user);
      navigate("/study");
    } catch (err) {
      setError(errorMessage(err, "登录失败，请稍后重试。"));
      setBusy(false);
    }
  };

  return (
    <AuthShell title="登录">
      <form onSubmit={submit} className="auth-form">
        <label>
          邮箱
          <input type="email" required value={email}
                 onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label>
          密码
          <input type="password" required value={password}
                 onChange={(e) => setPassword(e.target.value)}
                 autoComplete="current-password" />
        </label>
        <Link to="/forgot-password" className="auth-forgot">忘记密码？</Link>
        <FormMessage message={error} kind="error" />
        <Button variant="primary" type="submit" loading={busy}>
          登录
        </Button>
      </form>
      <p className="auth-switch">
        还没有账户？<Link to="/register">注册</Link>
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [field, setField] = useState<{ field: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setField(null);
    try {
      await registerAccount({
        email, password,
        display_name: displayName.trim() || undefined,
      });
      setDone(true);
    } catch (err) {
      const fe = fieldErrorFrom(err);
      if (fe) setField(fe);
      else setError(errorMessage(err, "注册失败，请稍后重试。"));
    }
    setBusy(false);
  };

  if (done) {
    return (
      <AuthShell title="注册成功">
        <p className="form-info">
          验证邮件已发送到 <strong>{email}</strong>，请在 24
          小时内打开邮件中的链接完成验证后登录。
        </p>
        <p className="auth-links">
          <Link to="/login">返回登录</Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="注册">
      <form onSubmit={submit} className="auth-form">
        <label>
          邮箱
          <input type="email" required value={email}
                 onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <FieldError message={field?.field === "email" ? field.message : null} />
        </label>
        <label>
          昵称（可选）
          <input type="text" value={displayName}
                 onChange={(e) => setDisplayName(e.target.value)} maxLength={128} />
          <FieldError message={field?.field === "display_name"
            ? field.message : null} />
        </label>
        <label>
          密码（至少 8 位）
          <input type="password" required minLength={8} value={password}
                 onChange={(e) => setPassword(e.target.value)}
                 autoComplete="new-password" />
          <FieldError message={field?.field === "password" ? field.message : null} />
        </label>
        <FormMessage message={error} kind="error" />
        <Button variant="primary" type="submit" loading={busy}>
          注册
        </Button>
      </form>
      <p className="auth-switch">
        已有账户？<Link to="/login">登录</Link>
      </p>
    </AuthShell>
  );
}

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [state, setState] = useState<"working" | "ok" | "already" | "invalid">(
    token ? "working" : "invalid");
  // StrictMode dev double-invokes effects; verification is one-shot on the
  // server (a second call returns "already"), so fire once per token.
  const firedToken = useRef<string | null>(null);

  useEffect(() => {
    if (!token || firedToken.current === token) return;
    firedToken.current = token;
    // No alive-flag: StrictMode's cleanup must not swallow the single
    // in-flight verification (setState after unmount is a safe no-op).
    verifyEmail(token)
      .then((r) => setState(r === "already" ? "already" : "ok"))
      .catch(() => setState("invalid"));
  }, [token]);

  return (
    <AuthShell title="邮箱验证">
      {state === "working" && <p role="status">验证中…</p>}
      {(state === "ok" || state === "already") && (
        <>
          <p className="form-info">
            {state === "ok" ? "邮箱验证完成，账户已激活。" :
              "该链接已使用过，账户此前已激活。"}
          </p>
          <p className="auth-links"><Link to="/login">去登录</Link></p>
        </>
      )}
      {state === "invalid" && (
        <>
          <FormMessage message="验证链接无效或已过期。" kind="error" />
          <p className="auth-links">
            <ResendLink email={null} />
          </p>
        </>
      )}
    </AuthShell>
  );
}

function ResendLink({ email }: { email: string | null }) {
  const [askEmail, setAskEmail] = useState(email === null);
  const [value, setValue] = useState(email ?? "");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (sent) return <span>如果该邮箱存在未激活账户，验证邮件已重新发送。</span>;
  if (!askEmail) {
    return (
      <button type="button" className="link-button"
              onClick={() => {
                setBusy(true);
                resendVerification(value)
                  .catch(() => { /* uniform response; nothing to show */ })
                  .finally(() => { setBusy(false); setSent(true); });
              }}
              disabled={busy}>
        重新发送验证邮件
      </button>
    );
  }
  return (
    <form className="auth-form" onSubmit={(e) => {
      e.preventDefault();
      setBusy(true);
      resendVerification(value)
        .catch(() => { /* uniform response */ })
        .finally(() => { setBusy(false); setSent(true); });
    }}>
      <label>
        邮箱
        <input type="email" required value={value}
               onChange={(e) => setValue(e.target.value)} />
      </label>
      <Button variant="secondary" type="submit" loading={busy}>
        重新发送验证邮件
      </Button>
    </form>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await forgotPassword(email);
    } catch {
      // uniform response; treat send failure as "sent" to avoid leaks
    }
    setBusy(false);
    setSent(true);
  };

  return (
    <AuthShell title="找回密码">
      {sent ? (
        <p className="form-info">
          如果该邮箱存在已验证账户，重置链接已发送，请查看邮件（1 小时内有效）。
        </p>
      ) : (
        <form onSubmit={submit} className="auth-form">
          <label>
            注册邮箱
            <input type="email" required value={email}
                   onChange={(e) => setEmail(e.target.value)}
                   autoComplete="email" />
          </label>
          <Button variant="primary" type="submit" loading={busy}>
            发送重置链接
          </Button>
        </form>
      )}
      <p className="auth-links"><Link to="/login">返回登录</Link></p>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [field, setField] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setField(null);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      const fe = fieldErrorFrom(err);
      if (fe) setField(fe.message);
      else setError(errorMessage(err, "重置链接无效或已过期。"));
    }
    setBusy(false);
  };

  if (done) {
    return (
      <AuthShell title="密码已重置">
        <p className="form-info">密码已更新，原有登录状态已全部失效。</p>
        <p className="auth-links"><Link to="/login">用新密码登录</Link></p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="设置新密码">
      {token ? (
        <form onSubmit={submit} className="auth-form">
          <label>
            新密码（至少 8 位）
            <input type="password" required minLength={8} value={password}
                   onChange={(e) => setPassword(e.target.value)}
                   autoComplete="new-password" />
            <FieldError message={field} />
          </label>
          <FormMessage message={error} kind="error" />
          <Button variant="primary" type="submit" loading={busy}>
            重置密码
          </Button>
        </form>
      ) : (
        <FormMessage message="链接缺少重置令牌，请从邮件中的链接进入。" kind="error" />
      )}
    </AuthShell>
  );
}
