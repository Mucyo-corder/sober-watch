import { AlcoholStatus, statusColorClasses } from "@/lib/alcohol";
import { cn } from "@/lib/utils";

export function StatusBadge({ status, className }: { status: AlcoholStatus; className?: string }) {
  const c = statusColorClasses(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold tracking-wide",
        c.badge,
        className
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
      {status}
    </span>
  );
}
