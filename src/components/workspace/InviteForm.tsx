import React, { useState } from "react";
import { Mail } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";

interface Props {
  serverError?: string | null;
}

export default function InviteForm({ serverError }: Props) {
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | undefined>();

  function validate() {
    if (!email.trim()) {
      setEmailError("Email is required");
      return false;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError("Enter a valid email address");
      return false;
    }
    setEmailError(undefined);
    return true;
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  return (
    <form method="POST" action="/api/workspace/invite" className="space-y-4" onSubmit={handleSubmit} noValidate>
      <FormField
        id="email"
        type="email"
        label="Invite by email"
        value={email}
        onChange={(v) => {
          setEmail(v);
          if (emailError) setEmailError(undefined);
        }}
        placeholder="colleague@example.com"
        error={emailError}
        icon={<Mail className="size-4" />}
      />
      <ServerError message={serverError} />
      <SubmitButton pendingText="Sending invite..." icon={<Mail className="size-4" />}>
        Send invite
      </SubmitButton>
    </form>
  );
}
