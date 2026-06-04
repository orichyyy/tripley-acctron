import { AlertTriangleIcon, CircleCheckIcon, Loader2Icon, RotateCcwIcon } from "lucide-react";
import type { PropsWithChildren, ReactNode } from "react";
import { Button } from "@/components/ui/button";

export interface AtmShellProps extends PropsWithChildren {
  title: string;
  eyebrow: string;
  status?: ReactNode;
  onReset?: () => void;
}

export function AtmShell({ title, eyebrow, status, onReset, children }: AtmShellProps) {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <section className="mx-auto grid min-h-dvh w-full max-w-6xl grid-rows-[auto_1fr] px-5 py-5 sm:px-8 sm:py-8">
        <header className="flex items-center justify-between gap-4 border-border border-b pb-4">
          <div>
            <p className="font-medium text-muted-foreground text-xs uppercase tracking-wider">
              {eyebrow}
            </p>
            <h1 className="mt-1 font-semibold text-2xl tracking-normal sm:text-3xl">{title}</h1>
          </div>
          {onReset ? (
            <Button
              aria-label="Reset demo"
              onClick={onReset}
              size="icon"
              type="button"
              variant="outline"
            >
              <RotateCcwIcon />
            </Button>
          ) : null}
        </header>
        <div className="grid items-center py-8">{children}</div>
        {status ? <div className="fixed right-5 bottom-5">{status}</div> : null}
      </section>
    </main>
  );
}

export function StatusPill({ error, running }: { error?: string; running: boolean }) {
  if (error) {
    return (
      <div className="flex max-w-sm items-center gap-2 rounded-md border border-danger bg-danger-soft px-3 py-2 text-danger text-sm shadow-sm">
        <AlertTriangleIcon className="size-4" />
        <span>{error}</span>
      </div>
    );
  }
  if (running) {
    return (
      <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-muted-foreground text-sm shadow-sm">
        <Loader2Icon className="size-4 animate-spin" />
        <span>Flow running</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-muted-foreground text-sm shadow-sm">
      <CircleCheckIcon className="size-4" />
      <span>Runtime ready</span>
    </div>
  );
}
