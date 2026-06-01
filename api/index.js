const { createClient } = require('@supabase/supabase-js');

const supabaseAuth = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
);

async function verifyAuth(req) {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return null;
    const { data: { user }, error } = await supabaseAuth.auth.getUser(token);
    if (error || !user) return null;
    return { user, token };
}

function userDb(token) {
    return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: 'Bearer ' + token } }
    });
}

// Meter fill: sum of intensity * linear-decay-weight over 30 days, capped at 100.
// Resolved worries (any outcome set) are excluded from the fill.
function computeFill(worries) {
    const now = Date.now();
    const DECAY_MS = 30 * 24 * 60 * 60 * 1000;
    let fill = 0;
    for (const w of worries) {
        if (w.outcome) continue;
        const age = now - new Date(w.logged_at).getTime();
        const weight = Math.max(0, 1 - age / DECAY_MS);
        fill += w.intensity * weight;
    }
    return Math.min(100, Math.round(fill));
}

module.exports = async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).end();

    const auth = await verifyAuth(req);
    if (!auth) return res.status(401).json({ ok: false, error: 'Unauthorized' });

    const { user, token } = auth;
    const db = userDb(token);
    const uid = user.id;
    const action = req.query.action || '';

    try {
        switch (action) {

            case 'people': {
                const { data: people, error: pe } = await db
                    .from('wm_people')
                    .select('id, name, relation, emoji, created_at')
                    .order('created_at', { ascending: true });
                if (pe) throw pe;

                const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
                const { data: worries, error: we } = await db
                    .from('wm_worries')
                    .select('person_id, intensity, logged_at, outcome')
                    .gte('logged_at', cutoff);
                if (we) throw we;

                const byPerson = {};
                for (const w of worries || []) {
                    if (!byPerson[w.person_id]) byPerson[w.person_id] = [];
                    byPerson[w.person_id].push(w);
                }

                return res.json({
                    ok: true,
                    people: people.map(p => ({ ...p, fill: computeFill(byPerson[p.id] || []) }))
                });
            }

            case 'add-person': {
                const body = req.body || {};
                const name = (body.name || '').trim().slice(0, 60);
                const relation = (body.relation || '').trim().slice(0, 40);
                const emoji = (body.emoji || '😟').trim().slice(0, 8);
                if (!name) throw new Error('Name is required');

                const { data, error } = await db
                    .from('wm_people')
                    .insert({ user_id: uid, name, relation, emoji })
                    .select()
                    .single();
                if (error) throw error;
                return res.json({ ok: true, person: { ...data, fill: 0 } });
            }

            case 'edit-person': {
                const body = req.body || {};
                const id = (body.id || '').trim();
                const name = (body.name || '').trim().slice(0, 60);
                const relation = (body.relation || '').trim().slice(0, 40);
                const emoji = (body.emoji || '😟').trim().slice(0, 8);
                if (!id) throw new Error('id required');
                if (!name) throw new Error('Name is required');

                const { error } = await db
                    .from('wm_people')
                    .update({ name, relation, emoji })
                    .eq('id', id);
                if (error) throw error;
                return res.json({ ok: true });
            }

            case 'delete-person': {
                const id = ((req.body || {}).id || req.query.id || '').trim();
                if (!id) throw new Error('id required');
                const { error } = await db.from('wm_people').delete().eq('id', id);
                if (error) throw error;
                return res.json({ ok: true });
            }

            case 'worries': {
                const person_id = (req.query.person_id || '').trim();
                if (!person_id) throw new Error('person_id required');
                const { data, error } = await db
                    .from('wm_worries')
                    .select('id, category, description, intensity, logged_at, outcome')
                    .eq('person_id', person_id)
                    .order('logged_at', { ascending: false })
                    .limit(100);
                if (error) throw error;
                return res.json({ ok: true, worries: data });
            }

            case 'log-worry': {
                const body = req.body || {};
                const person_id = (body.person_id || '').trim();
                const VALID_CATS = ['health', 'money', 'relationships', 'work', 'family', 'world', 'home', 'other'];
                const category = VALID_CATS.includes(body.category) ? body.category : 'other';
                const description = (body.description || '').trim().slice(0, 500);
                const intensity = Math.min(10, Math.max(1, parseInt(body.intensity) || 5));
                if (!person_id) throw new Error('person_id required');

                const { data, error } = await db
                    .from('wm_worries')
                    .insert({ user_id: uid, person_id, category, description, intensity })
                    .select()
                    .single();
                if (error) throw error;
                return res.json({ ok: true, worry: data });
            }

            case 'resolve': {
                const body = req.body || {};
                const id = (body.id || '').trim();
                const VALID = ['happened', 'didnt_happen', null];
                const outcome = (body.outcome === undefined || body.outcome === '') ? null : body.outcome;
                if (!id) throw new Error('id required');
                if (!VALID.includes(outcome)) throw new Error('Invalid outcome');
                const { error } = await db.from('wm_worries').update({ outcome }).eq('id', id);
                if (error) throw error;
                return res.json({ ok: true });
            }

            case 'delete-worry': {
                const id = ((req.body || {}).id || req.query.id || '').trim();
                if (!id) throw new Error('id required');
                const { error } = await db.from('wm_worries').delete().eq('id', id);
                if (error) throw error;
                return res.json({ ok: true });
            }

            default:
                return res.status(400).json({ ok: false, error: 'Unknown action: ' + action });
        }
    } catch (err) {
        console.error('[wm/api]', action, err.message);
        const safe = err.message && err.message.length < 120 ? err.message : 'Server error';
        return res.status(500).json({ ok: false, error: safe });
    }
};
