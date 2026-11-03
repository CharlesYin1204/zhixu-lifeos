// Existing cookies remain personal sessions; only a new administrator login may
// create an admin-scoped session. This additive migration is rollback compatible.
export async function ensureSessionScope(q){
 const columns=await q("SHOW COLUMNS FROM sessions LIKE 'scope'");
 if(!columns.length)await q("ALTER TABLE sessions ADD COLUMN scope VARCHAR(16) NOT NULL DEFAULT 'user' AFTER user_id");
}
