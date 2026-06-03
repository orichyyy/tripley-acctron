import { MonitorCheckIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function App() {
  return (
    <main className="min-h-dvh bg-background text-foreground">
      <section className="mx-auto flex min-h-dvh max-w-5xl items-center justify-center px-8 py-10">
        <Card className="w-full max-w-xl">
          <CardHeader>
            <CardTitle>Tripley Acctron</CardTitle>
            <CardDescription>Kiosk framework MVP demo surface</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <p className="text-sm leading-6 text-muted-foreground">
              Demo text is visible. V1 keeps the UI intentionally simple while the framework, native
              adapter, and testing contracts are established.
            </p>
            <Button type="button" className="w-fit">
              <MonitorCheckIcon data-icon="inline-start" />
              Demo Ready
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
