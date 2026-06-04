import { DeleteIcon, SendIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AccountInputState } from "@/demo/screens";

export interface AccountInputScreenProps {
  state: AccountInputState;
  disabled: boolean;
  onSubmit(value: string): void;
  onCancel(): void;
}

export function AccountInputScreen({
  state,
  disabled,
  onSubmit,
  onCancel,
}: AccountInputScreenProps) {
  const [value, setValue] = useState(state.value);

  useEffect(() => {
    setValue(state.value);
  }, [state.value]);

  return (
    <section className="mx-auto grid w-full max-w-3xl gap-8">
      <div>
        <p className="font-medium text-muted-foreground text-sm uppercase tracking-wider">
          Account input
        </p>
        <input
          aria-label="Account number"
          className="mt-4 h-24 w-full rounded-md border bg-card px-5 py-5 font-mono text-4xl tracking-normal outline-none transition focus:border-primary"
          disabled={disabled}
          inputMode="numeric"
          maxLength={18}
          onChange={(event) => setValue(event.target.value.replace(/\D/g, ""))}
          placeholder="Enter account number"
          value={value}
        />
        {state.error ? <p className="mt-3 text-danger text-sm">{state.error}</p> : null}
      </div>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-[1fr_1fr_1fr]">
        <Button
          disabled={disabled || value.length === 0}
          onClick={() => setValue("")}
          size="lg"
          type="button"
          variant="outline"
        >
          <DeleteIcon />
          Clear
        </Button>
        <Button disabled={disabled} onClick={onCancel} size="lg" type="button" variant="outline">
          <XIcon />
          Cancel
        </Button>
        <Button disabled={disabled} onClick={() => onSubmit(value)} size="lg" type="button">
          <SendIcon />
          Submit
        </Button>
      </div>
      <p className="text-muted-foreground text-sm">
        Validation and routing happen in the Step Kit.
      </p>
    </section>
  );
}
