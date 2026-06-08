"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  required?: boolean;
  disabled?: boolean;
  description?: string;
}

export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  required = true,
  disabled = false,
  description,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);
  const descriptionId = description ? `${id}-description` : undefined;

  return (
    <label className="block" htmlFor={id}>
      <span className="text-xs font-semibold text-[var(--text-muted)]">{label}</span>
      <span className="relative mt-1.5 block">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          required={required}
          disabled={disabled}
          aria-describedby={descriptionId}
          className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] px-3 pr-11 text-sm outline-none transition focus:border-brand-500 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          disabled={disabled}
          aria-label={visible ? "Hide password" : "Show password"}
          title={visible ? "Hide password" : "Show password"}
          className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-lg text-[var(--text-muted)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-50"
        >
          {visible ? <EyeOff size={17} /> : <Eye size={17} />}
        </button>
      </span>
      {description ? (
        <span id={descriptionId} className="mt-1.5 block text-xs text-[var(--text-muted)]">
          {description}
        </span>
      ) : null}
    </label>
  );
}
