-- workspace_invitation: invite token for a new member to join a workspace.
-- UNIQUE (workspace_id, email): one active invite per email per workspace.
-- Cancelling (DELETE) clears the constraint, allowing a fresh invite to the same email.
CREATE TABLE workspace_invitation (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  email        text        NOT NULL,
  token        text        NOT NULL UNIQUE,
  role         text        NOT NULL DEFAULT 'member' CHECK (role IN ('member')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at  timestamptz,
  UNIQUE (workspace_id, email)
);

ALTER TABLE workspace_invitation ENABLE ROW LEVEL SECURITY;

-- SECURITY DEFINER helpers: get_invitation_by_token bypasses RLS to serve the
-- pre-auth accept-invite page (no session yet). has_valid_invitation bypasses RLS
-- to avoid self-referential recursion when used inside workspace_member RLS policies.
-- SET search_path = public guards against search_path injection in both functions.

-- Returns limited invite info by token; used by the pre-auth accept-invite page.
-- STABLE: read-only query; safe to cache within a transaction.
CREATE OR REPLACE FUNCTION get_invitation_by_token(p_token text)
  RETURNS TABLE(
    invitation_id  uuid,
    workspace_id   uuid,
    workspace_name text,
    email          text,
    expires_at     timestamptz
  )
  LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS
$$
  SELECT i.id, i.workspace_id, w.name, i.email, i.expires_at
  FROM workspace_invitation i
  JOIN workspace w ON w.id = i.workspace_id
  WHERE i.token = p_token
    AND i.accepted_at IS NULL
    AND i.expires_at > now();
$$;

-- Returns true if a valid pending invite exists for user_email in workspace ws_id.
-- Used as an RLS guard in the workspace_member INSERT policy for invited users.
-- VOLATILE: checks live row state (accepted_at, expires_at) — must not be cached.
CREATE OR REPLACE FUNCTION has_valid_invitation(ws_id uuid, user_email text)
  RETURNS boolean LANGUAGE sql SECURITY DEFINER VOLATILE SET search_path = public AS
$$
  SELECT EXISTS (
    SELECT 1 FROM workspace_invitation
    WHERE workspace_id = ws_id
      AND email = user_email
      AND accepted_at IS NULL
      AND expires_at > now()
  );
$$;

-- workspace_invitation RLS --

-- Team Lead can create invites for their workspace
CREATE POLICY "team lead can create invitation"
  ON workspace_invitation FOR INSERT TO authenticated
  WITH CHECK (auth_user_is_team_lead() AND workspace_id = auth_user_workspace_id());

-- Team Lead can view all invitations for their workspace
CREATE POLICY "team lead can view invitations"
  ON workspace_invitation FOR SELECT TO authenticated
  USING (auth_user_is_team_lead() AND workspace_id = auth_user_workspace_id());

-- Team Lead can cancel (delete) invitations for their workspace
CREATE POLICY "team lead can cancel invitation"
  ON workspace_invitation FOR DELETE TO authenticated
  USING (auth_user_is_team_lead() AND workspace_id = auth_user_workspace_id());

-- Invited user (authenticated, email matches) can mark their invitation as accepted
CREATE POLICY "invited user can accept invitation"
  ON workspace_invitation FOR UPDATE TO authenticated
  USING (
    email = (auth.jwt() ->> 'email')
    AND accepted_at IS NULL
    AND expires_at > now()
  )
  WITH CHECK (email = (auth.jwt() ->> 'email'));

-- workspace_member INSERT policy for invited users --

-- Invited authenticated user can join the workspace they were invited to.
-- Reuses has_valid_invitation() to check pending invite for their email.
CREATE POLICY "invited user can join workspace as member"
  ON workspace_member FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND role = 'member'
    AND has_valid_invitation(workspace_member.workspace_id, auth.jwt() ->> 'email')
  );
