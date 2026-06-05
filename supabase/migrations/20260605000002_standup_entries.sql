CREATE TABLE standup_entries (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid        NOT NULL REFERENCES workspace(id)     ON DELETE CASCADE,
  user_id        uuid        NOT NULL REFERENCES auth.users(id)    ON DELETE CASCADE,
  submitted_date date        NOT NULL,
  did            text        NOT NULL,
  plan           text        NOT NULL,
  blockers       text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, submitted_date)
);

ALTER TABLE standup_entries ENABLE ROW LEVEL SECURITY;

-- Member sees own entries only; Team Lead visibility added in S-05
CREATE POLICY "members can view own standup entries"
  ON standup_entries FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

-- Member may insert their own entry; workspace_id must match their membership
CREATE POLICY "members can insert own standup entries"
  ON standup_entries FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND workspace_id = auth_user_workspace_id()
  );

-- UPDATE / DELETE: no policies — entries are immutable in MVP (FR-007/FR-008 cut from S-03)

CREATE INDEX standup_entries_user_date_idx
  ON standup_entries (user_id, submitted_date DESC);
