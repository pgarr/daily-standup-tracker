declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User | null;
    workspace: import("@/types").Workspace | null;
    workspaceMember: import("@/types").WorkspaceMember | null;
  }
}
