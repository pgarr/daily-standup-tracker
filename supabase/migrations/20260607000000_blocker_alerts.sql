CREATE TABLE blocker_alerts (
  id              uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid  NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
  user_id         uuid  NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trigger_date    date  NOT NULL,
  status          text  NOT NULL CHECK (status IN ('confirmed', 'dismissed')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, trigger_date)
);

ALTER TABLE blocker_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members can view own blocker alerts"
  ON blocker_alerts FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "team lead can view all blocker alerts in workspace"
  ON blocker_alerts FOR SELECT TO authenticated
  USING (auth_user_is_team_lead() AND workspace_id = auth_user_workspace_id());

CREATE POLICY "members can insert own blocker alerts"
  ON blocker_alerts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND workspace_id = auth_user_workspace_id());
