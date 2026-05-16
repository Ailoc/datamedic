import { memo, type ReactNode } from "react";

export const StatusPill = memo(function StatusPill({
  icon,
  label,
}: {
  icon: ReactNode;
  label: string;
}) {
  return (
    <span className="status-pill">
      {icon}
      {label}
    </span>
  );
});
