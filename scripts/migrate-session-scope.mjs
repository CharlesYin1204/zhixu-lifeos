import {q,pool} from '../lib/db.mjs';
import {ensureSessionScope} from '../lib/session-schema.mjs';
try{await ensureSessionScope(q);console.log('Session scopes ready; existing sessions preserved as user sessions.');}
finally{await pool.end();}
