-- workspace: workspace identity and per-workspace configuration.
-- alert_threshold (FR-015): number of consecutive business days before a blocker alert fires.
CREATE TABLE workspace (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text        NOT NULL,
  alert_threshold integer     NOT NULL DEFAULT 2,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workspace ENABLE ROW LEVEL SECURITY;

-- workspace_member: user→workspace mapping with role.
-- UNIQUE (user_id) enforces the one-workspace-per-user MVP constraint at the DB level.
CREATE TABLE workspace_member (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         text        NOT NULL CHECK (role IN ('member', 'team_lead')),
  joined_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE workspace_member ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER helpers: bypass RLS for inner membership checks used by team_lead
-- policies, preventing self-referential recursion on workspace_member.
-- SET search_path = public guards against search_path injection.
CREATE OR REPLACE FUNCTION auth_user_workspace_id()
  RETURNS uuid LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS
$$
  SELECT workspace_id FROM workspace_member WHERE user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION auth_user_is_team_lead()
  RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS
$$
  SELECT EXISTS (
    SELECT 1 FROM workspace_member
    WHERE user_id = auth.uid() AND role = 'team_lead'
  );
$$;

-- Guards the team_lead INSERT policy: only allows self-insert into a workspace
-- that has no existing members, preventing team_lead hijack via a known workspace UUID.
CREATE OR REPLACE FUNCTION workspace_has_no_members(ws_id uuid)
  RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS
$$
  SELECT NOT EXISTS (SELECT 1 FROM workspace_member WHERE workspace_id = ws_id);
$$;

-- workspace RLS --

-- Any authenticated user can create a workspace (FR-003)
CREATE POLICY "authenticated users can create a workspace"
  ON workspace FOR INSERT TO authenticated
  WITH CHECK (true);

-- Members and Team Lead can read the workspace they belong to
CREATE POLICY "workspace members can view their workspace"
  ON workspace FOR SELECT TO authenticated
  USING (id = auth_user_workspace_id());

-- Only the Team Lead of this workspace can update workspace settings
CREATE POLICY "team lead can update workspace settings"
  ON workspace FOR UPDATE TO authenticated
  USING  (auth_user_is_team_lead() AND id = auth_user_workspace_id())
  WITH CHECK (auth_user_is_team_lead() AND id = auth_user_workspace_id());

-- DELETE: no policy — implicitly denied for all roles in MVP

-- workspace_member RLS --

-- Every authenticated user can see their own membership row
CREATE POLICY "members can view own workspace_member row"
  ON workspace_member FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Team Lead can view all member rows in their workspace
CREATE POLICY "team lead can view all workspace members"
  ON workspace_member FOR SELECT TO authenticated
  USING (auth_user_is_team_lead() AND workspace_id = auth_user_workspace_id());

-- Workspace creation: user inserts themselves as team_lead into an empty workspace.
-- workspace_has_no_members guard prevents hijacking a known workspace UUID.
-- S-02 will add a separate policy for Team Lead inserting invited members.
CREATE POLICY "workspace creator can join as team_lead"
  ON workspace_member FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND role = 'team_lead'
    AND workspace_has_no_members(workspace_id)
  );

-- UPDATE: no policy — no role promotion in MVP
-- DELETE: no policy — member removal is a non-goal in MVP
