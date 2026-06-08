import { Check, X } from "lucide-react";
import { passwordChecks } from "@/lib/password-policy";

interface PasswordRequirementsProps {
  password: string;
}

const LABELS = {
  minLength: "12-128 characters",
  uppercase: "Uppercase letter",
  lowercase: "Lowercase letter",
  number: "Number",
  symbol: "Symbol",
} as const;

export function PasswordRequirements({ password }: PasswordRequirementsProps) {
  const checks = passwordChecks(password);

  return (
    <div
      role="status"
      aria-live="polite"
      className="grid min-h-[3.75rem] grid-cols-2 gap-x-3 gap-y-1 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-3 text-xs sm:grid-cols-3"
    >
      {Object.entries(LABELS).map(([key, label]) => {
        const passed =
          key === "minLength"
            ? checks.minLength && checks.maxLength
            : checks[key as keyof typeof checks];
        return (
          <span
            key={key}
            className={`flex items-center gap-1.5 ${passed ? "text-emerald-600 dark:text-emerald-400" : "text-[var(--text-muted)]"}`}
          >
            {passed ? <Check size={13} aria-hidden="true" /> : <X size={13} aria-hidden="true" />}
            {label}
          </span>
        );
      })}
    </div>
  );
}
