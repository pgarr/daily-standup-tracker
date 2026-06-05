import { useState } from "react";
import { Building2, ArrowRight } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";

interface Props {
  serverError?: string | null;
}

export default function WorkspaceSetupForm({ serverError }: Props) {
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | undefined>();

  function validate() {
    if (!name.trim()) {
      setNameError("Workspace name is required");
      return false;
    }
    setNameError(undefined);
    return true;
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  return (
    <form method="POST" action="/api/workspace/create" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <FormField
        id="name"
        label="Workspace name"
        value={name}
        onChange={(v) => {
          setName(v);
          if (nameError) setNameError(undefined);
        }}
        placeholder="e.g. Acme Dev Team"
        error={nameError}
        icon={<Building2 className="size-4" />}
      />

      <ServerError message={serverError} />

      <SubmitButton pendingText="Creating workspace..." icon={<ArrowRight className="size-4" />}>
        Create workspace
      </SubmitButton>
    </form>
  );
}
