# Daily Standup Tracker

A personal and team productivity tool for logging daily standups — what you did, what you plan, and what's blocking you. Tracks streaks, surfaces recurring blockers, and builds a searchable history of your work.

# Potential MVP

- User registration and login (Supabase Auth, email/password)
- Daily standup form — did, plan, blockers fields
- Entry history — paginated list of past standups
- Streak counter — consecutive days with a submitted entry
- Blocker alert — UI warning when the same blocker appears 2+ days in a row
- Edit and delete own entries (full CRUD)

# Later TODO

- Team workspace — invite members, shared standup feed, team lead view (this may be MVP if we want to work in a team)
- Weekly summary — auto-generated digest of completed tasks and unresolved blockers
- Slack integration — post standup summary to a channel automatically
- Jira / GitHub integration — create tickets directly from a blocker entry
- Analytics — productivity charts, blocker frequency over time
- AI assistant — suggest how to resolve a recurring blocker based on history
- Notifications — daily reminder email or push notification at a set time
- PDF export — weekly report formatted for sharing with a manager
