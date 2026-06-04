import { AlertTriangleIcon, CheckCircle2Icon, RotateCcwIcon, XCircleIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ResultState } from "@/demo/screens";

export function ResultScreen({ state, onRestart }: { state: ResultState; onRestart(): void }) {
  const Icon =
    state.tone === "success"
      ? CheckCircle2Icon
      : state.tone === "danger"
        ? XCircleIcon
        : AlertTriangleIcon;

  return (
    <section className="mx-auto grid w-full max-w-2xl gap-7 border-border border-l pl-8">
      <Icon className={`size-14 ${iconClass(state.tone)}`} />
      <div>
        <p className="font-medium text-muted-foreground text-sm uppercase tracking-wider">
          End route: {state.endName}
        </p>
        <h2 className="mt-3 font-semibold text-5xl leading-tight tracking-normal">{state.title}</h2>
        <p className="mt-5 text-lg text-muted-foreground leading-8">{state.message}</p>
      </div>
      {state.accountNo ? (
        <div className="rounded-md border bg-card px-4 py-3 font-mono text-muted-foreground text-sm">
          accountNo={state.accountNo}
        </div>
      ) : null}
      <Button className="w-fit" onClick={onRestart} size="lg" type="button">
        <RotateCcwIcon />
        New transaction
      </Button>
    </section>
  );
}

function iconClass(tone: ResultState["tone"]): string {
  if (tone === "success") {
    return "text-success";
  }
  if (tone === "danger") {
    return "text-danger";
  }
  return "text-warning";
}
