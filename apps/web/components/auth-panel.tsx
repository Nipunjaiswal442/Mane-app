'use client';
import { useState } from 'react';
import { ArrowRight, ArrowUpRight, LoaderCircle } from 'lucide-react';
import type { User } from './demo';
import { Field, request } from './ui';
export interface Session {
  user: User;
  org: { name: string };
  csrfToken: string;
  license?: { mode?: string; updatesAvailable?: boolean; expired?: boolean; message?: string };
}
export function AuthPanel({
  setup,
  onSuccess,
  initialError,
  provider = 'local',
}: {
  setup: boolean;
  onSuccess: (s: Session) => void;
  initialError?: string;
  provider?: string;
}) {
  const [error, setError] = useState(initialError || '');
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const form = Object.fromEntries(new FormData(e.currentTarget));
      onSuccess(await request<Session>(setup ? '/auth/setup' : '/auth/login', 'POST', form));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main id="main" className="auth-shell">
      <section className="auth-art">
        <img src="/corridor.svg" alt="" />
        <a href="/" className="wordmark">
          Mane<span>®</span>
        </a>
        <h1>
          SAME PEOPLE.
          <br />
          DEEPER WORK.
        </h1>
        <p>A private space for your people, your conversations, and the knowledge you build together.</p>
        <span className="eyebrow">SELF-HOSTED. NO CLOUD. YOUR RULES.</span>
      </section>
      <section className="auth-main">
        <span className="eyebrow">YOUR WORK STARTS HERE.</span>
        <h2>{setup ? 'Make yourself at home.' : 'Welcome back.'}</h2>
        <p>
          {setup
            ? 'Create your organisation and the first administrator account. Everything stays on this appliance.'
            : 'Sign in to your organisation’s private workspace.'}
        </p>
        {error && (
          <div role="alert" className="notice error">
            {error}
          </div>
        )}
        {provider === 'oidc' && !setup ? (
          <a className="button black" href="/api/auth/oidc/start">
            Organisation single sign-on <ArrowRight size={17} />
          </a>
        ) : (
          <form onSubmit={submit}>
            {setup && (
              <>
                <Field label="Organisation name">
                  <input
                    className="input"
                    name="orgName"
                    required
                    minLength={2}
                    maxLength={100}
                    placeholder="Your organisation"
                    autoComplete="organization"
                  />
                </Field>
                <Field label="Your name">
                  <input
                    className="input"
                    name="displayName"
                    required
                    placeholder="Alex Morgan"
                    autoComplete="name"
                  />
                </Field>
              </>
            )}
            <Field label="Work email">
              <input
                className="input"
                name="email"
                type="email"
                required
                autoComplete="username"
                placeholder="you@organisation.com"
              />
            </Field>
            <Field label={setup ? 'Password · at least 12 characters' : 'Password'}>
              <input
                className="input"
                name="password"
                type="password"
                required
                minLength={setup ? 12 : 1}
                maxLength={256}
                autoComplete={setup ? 'new-password' : 'current-password'}
              />
            </Field>
            <button disabled={busy} className="button black">
              {busy ? <LoaderCircle className="spin" size={17} /> : setup ? 'Create workspace' : 'Sign in'}{' '}
              <ArrowRight size={17} />
            </button>
          </form>
        )}
        <div className="auth-footer">
          <a href="/app?demo=1">
            Explore the demo <ArrowUpRight size={11} style={{ display: 'inline' }} />
          </a>
          <a href="/docs">Setup documentation</a>
        </div>
      </section>
    </main>
  );
}
