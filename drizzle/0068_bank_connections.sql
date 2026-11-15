PRAGMA foreign_keys = ON;

-- Existing manual accounts remain shared; connected personal accounts are private.
ALTER TABLE bank_accounts ADD COLUMN private_owner_user_id TEXT REFERENCES profiles(id);
ALTER TABLE bank_accounts ADD COLUMN provider_balance_verified_at TEXT;
ALTER TABLE bank_accounts ADD COLUMN provider_balance_type TEXT;
ALTER TABLE audit_logs ADD COLUMN private_owner_user_id TEXT REFERENCES profiles(id);

CREATE TABLE bank_connections (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  owner_user_id TEXT NOT NULL REFERENCES profiles(id),
  provider TEXT NOT NULL DEFAULT 'enablebanking' CHECK(provider='enablebanking'),
  provider_environment TEXT NOT NULL CHECK(provider_environment IN ('SANDBOX','PRODUCTION')),
  aspsp_name TEXT NOT NULL,
  country TEXT NOT NULL CHECK(country IN ('BE','LT')),
  status TEXT NOT NULL CHECK(status IN ('starting','awaiting_authorization','completing','connected','failed','disconnected','expired')),
  operation_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  state_hash TEXT NOT NULL UNIQUE,
  state_expires_at TEXT NOT NULL,
  authorization_url_cipher TEXT,
  provider_session_cipher TEXT,
  access_expires_at TEXT,
  completion_token TEXT,
  sync_token TEXT,
  sync_expires_at TEXT,
  last_synced_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(organization_id,owner_user_id,operation_key)
);
CREATE INDEX bank_connections_owner_idx ON bank_connections(organization_id,owner_user_id,status);

CREATE TABLE bank_remote_accounts (
  bank_account_id TEXT PRIMARY KEY NOT NULL REFERENCES bank_accounts(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  owner_user_id TEXT NOT NULL REFERENCES profiles(id),
  connection_id TEXT NOT NULL REFERENCES bank_connections(id),
  provider TEXT NOT NULL DEFAULT 'enablebanking' CHECK(provider='enablebanking'),
  identity_hash TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(aliases_json)),
  provider_account_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(organization_id,provider,identity_hash)
);
CREATE INDEX bank_remote_accounts_connection_idx ON bank_remote_accounts(organization_id,connection_id);

CREATE TABLE bank_sync_runs (
  id TEXT PRIMARY KEY NOT NULL,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  owner_user_id TEXT NOT NULL REFERENCES profiles(id),
  connection_id TEXT NOT NULL REFERENCES bank_connections(id),
  operation_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed')),
  summary_json TEXT CHECK(summary_json IS NULL OR json_valid(summary_json)),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE(organization_id,connection_id,operation_key)
);

-- A failed fence aborts the whole D1/SQLite batch, including its audit records.
CREATE TABLE bank_connection_guards (
  id TEXT PRIMARY KEY NOT NULL,
  valid INTEGER NOT NULL CHECK(valid=1)
);

CREATE TRIGGER bank_remote_account_scope_insert BEFORE INSERT ON bank_remote_accounts
WHEN NOT EXISTS (
 SELECT 1 FROM bank_accounts a JOIN bank_connections c ON c.id=NEW.connection_id
 WHERE a.id=NEW.bank_account_id AND a.organization_id=NEW.organization_id
 AND a.private_owner_user_id=NEW.owner_user_id
 AND c.organization_id=NEW.organization_id AND c.owner_user_id=NEW.owner_user_id
)
BEGIN SELECT RAISE(ABORT,'bank_remote_account_scope'); END;

CREATE TRIGGER bank_remote_account_scope_update BEFORE UPDATE ON bank_remote_accounts
WHEN NOT EXISTS (
 SELECT 1 FROM bank_accounts a JOIN bank_connections c ON c.id=NEW.connection_id
 WHERE a.id=NEW.bank_account_id AND a.organization_id=NEW.organization_id
 AND a.private_owner_user_id=NEW.owner_user_id
 AND c.organization_id=NEW.organization_id AND c.owner_user_id=NEW.owner_user_id
)
BEGIN SELECT RAISE(ABORT,'bank_remote_account_scope'); END;
