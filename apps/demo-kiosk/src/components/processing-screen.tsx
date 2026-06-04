import { Loader2Icon } from "lucide-react";

export function ProcessingScreen() {
  return (
    <section className="mx-auto grid min-h-[360px] w-full max-w-xl place-items-center text-center">
      <div>
        <Loader2Icon className="mx-auto size-12 animate-spin text-primary" />
        <h2 className="mt-6 font-semibold text-4xl tracking-normal">Contacting host</h2>
        <p className="mt-4 text-muted-foreground">
          The flow is executing the `account.inquiry` host request step.
        </p>
      </div>
    </section>
  );
}
