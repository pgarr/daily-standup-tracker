export type UserRole = "member" | "team_lead";

export interface Workspace {
  id: string;
  name: string;
  alert_threshold: number;
  created_at: string;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: UserRole;
  joined_at: string;
}
