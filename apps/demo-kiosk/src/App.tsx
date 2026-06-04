import { AccountInputScreen } from "@/components/account-input-screen";
import { AtmShell, StatusPill } from "@/components/atm-shell";
import { ProcessingScreen } from "@/components/processing-screen";
import { ResultScreen } from "@/components/result-screen";
import { WelcomeScreen } from "@/components/welcome-screen";
import { accountInputState, resultState, welcomeState } from "@/demo/screen-state";
import { useDemoRuntime } from "@/demo/use-demo-runtime";

export function App() {
  const demo = useDemoRuntime();
  const status = (
    <StatusPill {...(demo.error ? { error: demo.error } : {})} running={demo.running} />
  );

  if (demo.snapshot.currentScreen === "account.input") {
    return (
      <AtmShell
        eyebrow="Tripley Acctron"
        onReset={() => demo.reset("approved")}
        status={status}
        title="ATM Basic"
      >
        <AccountInputScreen
          disabled={demo.running === false}
          onCancel={() => demo.runtime.emitAction("account.input", { type: "cancel" })}
          onSubmit={(value) => demo.runtime.emitAction("account.input", { type: "submit", value })}
          state={accountInputState(demo.snapshot)}
        />
      </AtmShell>
    );
  }

  if (demo.snapshot.currentScreen === "demo.processing") {
    return (
      <AtmShell eyebrow="Tripley Acctron" status={status} title="ATM Basic">
        <ProcessingScreen />
      </AtmShell>
    );
  }

  if (demo.snapshot.currentScreen === "demo.result") {
    return (
      <AtmShell eyebrow="Tripley Acctron" status={status} title="ATM Basic">
        <ResultScreen onRestart={() => demo.reset("approved")} state={resultState(demo.snapshot)} />
      </AtmShell>
    );
  }

  return (
    <AtmShell eyebrow="Tripley Acctron" status={status} title="ATM Basic">
      <WelcomeScreen
        initialScenario={welcomeState(demo.snapshot).scenario}
        onStart={demo.start}
        running={demo.running}
      />
    </AtmShell>
  );
}
