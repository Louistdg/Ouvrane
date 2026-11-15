PRAGMA foreign_keys = ON;

CREATE TABLE personal_calendar_events (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 user_id TEXT NOT NULL REFERENCES profiles(id),
 title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 240),
 starts_at TEXT NOT NULL,
 ends_at TEXT NOT NULL,
 time_zone TEXT NOT NULL DEFAULT 'Europe/Brussels' CHECK(time_zone='Europe/Brussels'),
 notes TEXT NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 remind_at TEXT,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 operation_key TEXT NOT NULL,
 request_json TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 cancelled_at TEXT,
 UNIQUE(organization_id,user_id,operation_key),
 CHECK(ends_at>starts_at)
);
CREATE INDEX personal_calendar_owner_range ON personal_calendar_events(organization_id,user_id,starts_at,ends_at) WHERE cancelled_at IS NULL;

CREATE TABLE personal_followup_reminders (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 user_id TEXT NOT NULL REFERENCES profiles(id),
 source_kind TEXT NOT NULL CHECK(source_kind IN ('task','reminder','message')),
 source_id TEXT NOT NULL,
 remind_at TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 cancelled_at TEXT,
 UNIQUE(organization_id,user_id,source_kind,source_id)
);
CREATE INDEX personal_followup_owner_due ON personal_followup_reminders(organization_id,user_id,remind_at) WHERE cancelled_at IS NULL;

CREATE TABLE personal_notification_receipts (
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 user_id TEXT NOT NULL REFERENCES profiles(id),
 source_key TEXT NOT NULL,
 source_revision TEXT NOT NULL,
 read_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,user_id,source_key)
);

CREATE TABLE personal_message_notifications (
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 message_id TEXT NOT NULL REFERENCES messages(id),
 recipient_user_id TEXT NOT NULL REFERENCES profiles(id),
 requested_by TEXT NOT NULL REFERENCES profiles(id),
 created_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,message_id,recipient_user_id)
);
