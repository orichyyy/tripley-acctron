import { PlayIcon, ServerIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { HostScenario } from "@/demo/screens";

export interface WelcomeScreenProps {
  initialScenario: HostScenario;
  running: boolean;
  onStart(scenario: HostScenario): void;
}

const scenarios: Array<{ id: HostScenario; label: string; detail: string }> = [
  { id: "approved", label: "Approved", detail: "Fake host returns approved=true." },
  { id: "declined", label: "Declined", detail: "Fake host returns approved=false." },
  { id: "failed", label: "Failed", detail: "Fake host throws an error." },
];

export function WelcomeScreen({ initialScenario, running, onStart }: WelcomeScreenProps) {
  const [scenario, setScenario] = useState<HostScenario>(initialScenario);

  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="flex min-h-[420px] flex-col justify-between border-border border-b pb-8 lg:border-r lg:border-b-0 lg:pr-10">
        <div>
          <p className="font-medium text-accent-foreground text-sm uppercase tracking-wider">
            Browser ATM transaction
          </p>
          <h2 className="mt-5 max-w-3xl font-semibold text-5xl leading-tight tracking-normal">
            Run the recipe flow through a real React UI adapter.
          </h2>
          <p className="mt-6 max-w-2xl text-lg text-muted-foreground leading-8">
            Account input, validation, routing, audit, transaction data, and fake host responses
            stay inside the framework runtime.
          </p>
        </div>
        <Button
          className="mt-8 h-12 w-fit px-7"
          disabled={running}
          onClick={() => onStart(scenario)}
        >
          <PlayIcon />
          Start transaction
        </Button>
      </section>
      <aside className="grid content-center gap-3">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <ServerIcon className="size-4" />
          Host scenario
        </div>
        <div className="grid gap-3">
          {scenarios.map((item) => (
            <button
              className="rounded-md border bg-card p-4 text-left transition hover:border-primary disabled:opacity-60 data-[active=true]:border-primary data-[active=true]:bg-secondary"
              data-active={scenario === item.id}
              disabled={running}
              key={item.id}
              onClick={() => setScenario(item.id)}
              type="button"
            >
              <span className="block font-semibold text-base">{item.label}</span>
              <span className="mt-1 block text-muted-foreground text-sm">{item.detail}</span>
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
