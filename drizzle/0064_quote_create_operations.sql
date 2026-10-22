-- Keep creation receipts separate from mutable quotes. Archiving a quote must
-- not turn a retry into a second commercial document.
CREATE UNIQUE INDEX quotes_server_org_identity ON quotes_server(organization_id,id);
CREATE TABLE quote_create_operations (
 organization_id TEXT NOT NULL REFERENCES organizations(id),
 user_id TEXT NOT NULL REFERENCES profiles(id),
 operation_key TEXT NOT NULL,
 request_sha256 TEXT NOT NULL CHECK(length(request_sha256)=64),
 quote_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(organization_id,user_id,operation_key),
 FOREIGN KEY(organization_id,quote_id) REFERENCES quotes_server(organization_id,id)
);
