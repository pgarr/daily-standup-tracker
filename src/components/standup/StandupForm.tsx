import React, { useState } from "react";
import { Send } from "lucide-react";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";

interface Props {
  error?: string | null;
}

export default function StandupForm({ error }: Props) {
  const [did, setDid] = useState("");
  const [plan, setPlan] = useState("");
  const [blockers, setBlockers] = useState("");
  const [didError, setDidError] = useState<string | undefined>();
  const [planError, setPlanError] = useState<string | undefined>();

  function validate() {
    let valid = true;
    if (!did.trim()) {
      setDidError("What you did is required");
      valid = false;
    } else {
      setDidError(undefined);
    }
    if (!plan.trim()) {
      setPlanError("Plan for today is required");
      valid = false;
    } else {
      setPlanError(undefined);
    }
    return valid;
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  const textareaBase =
    "w-full resize-none rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-purple-400/60 focus:outline-none focus:ring-1 focus:ring-purple-400/40";

  return (
    <form method="POST" action="/api/standup/submit" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <input type="hidden" name="submitted_date" value={new Date().toLocaleDateString("sv")} />

      <div>
        <label htmlFor="did" className="mb-1 block text-sm font-medium text-blue-100/80">
          What did you do?
        </label>
        <textarea
          id="did"
          name="did"
          rows={3}
          className={textareaBase}
          placeholder="Yesterday I..."
          value={did}
          onChange={(e) => {
            setDid(e.target.value);
            if (didError) setDidError(undefined);
          }}
        />
        {didError && <p className="mt-1 text-xs text-red-400">{didError}</p>}
      </div>

      <div>
        <label htmlFor="plan" className="mb-1 block text-sm font-medium text-blue-100/80">
          What will you do today?
        </label>
        <textarea
          id="plan"
          name="plan"
          rows={3}
          className={textareaBase}
          placeholder="Today I'll..."
          value={plan}
          onChange={(e) => {
            setPlan(e.target.value);
            if (planError) setPlanError(undefined);
          }}
        />
        {planError && <p className="mt-1 text-xs text-red-400">{planError}</p>}
      </div>

      <div>
        <label htmlFor="blockers" className="mb-1 block text-sm font-medium text-blue-100/80">
          Any blockers? (optional)
        </label>
        <textarea
          id="blockers"
          name="blockers"
          rows={2}
          className={textareaBase}
          placeholder="Nothing blocking me"
          value={blockers}
          onChange={(e) => {
            setBlockers(e.target.value);
          }}
        />
      </div>

      <ServerError message={error} />

      <SubmitButton pendingText="Submitting..." icon={<Send className="size-4" />}>
        Submit standup
      </SubmitButton>
    </form>
  );
}
