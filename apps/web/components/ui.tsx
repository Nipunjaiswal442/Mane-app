'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { X, FileText, Check } from 'lucide-react';
export const initials = (name: string) =>
  name
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
export const stamp = (date: string) =>
  new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
export const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export function Avatar({ name, dark = false }: { name: string; dark?: boolean }) {
  return (
    <span className={`avatar ${dark ? 'dark' : ''}`} aria-hidden="true">
      {initials(name)}
    </span>
  );
}
export function Badge({ status }: { status: string }) {
  return (
    <span
      className={`badge ${status === 'review' ? 'review' : status === 'failed' ? 'failed' : ['published', 'done'].includes(status) ? '' : 'muted'}`}
    >
      {status === 'review' ? 'Ready for review' : status === 'approved' ? 'Publishing' : status}
    </span>
  );
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty-state">
      <FileText size={32} strokeWidth={1.2} />
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
export function CheckBox({
  checked,
  onClick,
  label,
}: {
  checked: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      className={`check-button ${checked ? 'checked' : ''}`}
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      onClick={onClick}
    >
      {checked && <Check size={11} />}
    </button>
  );
}
export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close.current();
      if (e.key === 'Tab') {
        const items = ref.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),a[href],input:not([disabled]),select,textarea,[tabindex="0"]',
        );
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', key);
      previous?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`modal ${wide ? 'wide' : ''}`}
      >
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="icon-button" aria-label="Close dialog" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-content">{children}</div>
      </div>
    </div>
  );
}
export type Request = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
export async function request<T>(path: string, method = 'GET', body?: unknown, csrf = ''): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(body instanceof FormData ? {} : body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
    },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const payload = await response
    .json()
    .catch(() => ({ error: 'The local API is unavailable. Start the stack with make dev.' }));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload.data as T;
}
