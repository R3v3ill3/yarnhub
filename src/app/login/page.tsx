import { Suspense } from "react";
import { AuthShell } from "@/components/marketing-shell";
import { LoginForm } from "./login-form";

export default function LoginPage() {
  return (
    <AuthShell
      title="Sign in"
      description="Use the email you registered with Yarnhub."
    >
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
