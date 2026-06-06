import React, { useState } from "react";
import { Mail, Lock, UserPlus, LogIn } from "lucide-react";
import { FormField } from "@/components/auth/FormField";
import { PasswordToggle } from "@/components/auth/PasswordToggle";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { ServerError } from "@/components/auth/ServerError";

const MIN_PASSWORD_LENGTH = 6;

interface Props {
  workspaceName: string;
  inviteEmail: string;
  token: string;
  serverError?: string;
}

type Tab = "signup" | "signin";

export default function AcceptInviteForm({ workspaceName, inviteEmail, token, serverError }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("signup");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ password?: string }>({});

  function validate() {
    const next: typeof errors = {};
    if (!password) {
      next.password = "Password is required";
    } else if (activeTab === "signup" && password.length < MIN_PASSWORD_LENGTH) {
      next.password = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    if (!validate()) {
      e.preventDefault();
    }
  }

  function switchTab(tab: Tab) {
    setActiveTab(tab);
    setPassword("");
    setErrors({});
  }

  return (
    <div>
      <p className="mb-6 text-center text-blue-100/70">
        You&apos;ve been invited to join <span className="font-semibold text-white">{workspaceName}</span>
      </p>

      <div className="mb-6 flex rounded-lg border border-white/20 p-1">
        <button
          type="button"
          onClick={() => {
            switchTab("signup");
          }}
          className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
            activeTab === "signup" ? "bg-white/20 text-white" : "text-white/60 hover:text-white/80"
          }`}
        >
          Create account
        </button>
        <button
          type="button"
          onClick={() => {
            switchTab("signin");
          }}
          className={`flex-1 rounded-md py-2 text-sm font-medium transition-colors ${
            activeTab === "signin" ? "bg-white/20 text-white" : "text-white/60 hover:text-white/80"
          }`}
        >
          Sign in
        </button>
      </div>

      <form
        method="POST"
        action={activeTab === "signup" ? "/api/auth/signup" : "/api/auth/signin"}
        className="space-y-4"
        onSubmit={handleSubmit}
        noValidate
      >
        <input type="hidden" name="invite_token" value={token} />

        <FormField
          id="email"
          type="email"
          label="Email"
          value={inviteEmail}
          onChange={() => undefined}
          icon={<Mail className="size-4" />}
          readOnly={true}
        />

        <FormField
          id="password"
          label="Password"
          type={showPassword ? "text" : "password"}
          value={password}
          onChange={(v) => {
            setPassword(v);
            if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }));
          }}
          placeholder={activeTab === "signup" ? "Min. 6 characters" : "Your password"}
          error={errors.password}
          icon={<Lock className="size-4" />}
          endContent={
            <PasswordToggle
              visible={showPassword}
              onToggle={() => {
                setShowPassword(!showPassword);
              }}
            />
          }
        />

        <ServerError message={serverError} />

        {activeTab === "signup" ? (
          <SubmitButton pendingText="Creating account..." icon={<UserPlus className="size-4" />}>
            Create account &amp; join {workspaceName}
          </SubmitButton>
        ) : (
          <SubmitButton pendingText="Signing in..." icon={<LogIn className="size-4" />}>
            Sign in &amp; join {workspaceName}
          </SubmitButton>
        )}
      </form>
    </div>
  );
}
