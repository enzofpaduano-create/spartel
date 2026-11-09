// Spartel — paiements par carte (Stripe Connect Express, charges « destination »).
// Le client paie Spartel, Stripe reverse automatiquement la part du capitaine
// sur son compte Stripe et garde la commission Spartel (SPARTEL_FEE_PCT).
//
// Secrets à définir dans Supabase (Edge Functions → Secrets) :
//   STRIPE_SECRET_KEY        sk_test_… puis sk_live_…
//   STRIPE_PUBLISHABLE_KEY   pk_test_… puis pk_live_…
//   SPARTEL_FEE_PCT          commission en %, 10 par défaut
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

const SK = Deno.env.get('STRIPE_SECRET_KEY') || '';
const PK = Deno.env.get('STRIPE_PUBLISHABLE_KEY') || '';
const FEE = Number(Deno.env.get('SPARTEL_FEE_PCT') ?? '10');
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

function form(obj: Record<string, unknown>, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object' && !Array.isArray(v)) form(v as Record<string, unknown>, key, out);
    else if (Array.isArray(v)) v.forEach((x, i) => out.append(`${key}[${i}]`, String(x)));
    else out.append(key, String(v));
  }
  return out;
}
async function stripe(path: string, params?: Record<string, unknown>, method = 'POST', idem?: string) {
  if (!SK) throw new HttpError(503, 'Paiement par carte pas encore activé sur Spartel');
  const headers: Record<string, string> = { Authorization: `Bearer ${SK}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' };
  if (idem) headers['Idempotency-Key'] = idem;
  const r = await fetch(`https://api.stripe.com/v1${path}`, { method, headers, body: method === 'GET' ? undefined : form(params || {}).toString() });
  const data = await r.json();
  if (!r.ok) throw new HttpError(402, data?.error?.message || 'Erreur Stripe');
  return data;
}
const msg = (booking_id: string, body: string) => admin.from('booking_messages').insert({ booking_id, sender_id: null, kind: 'system', body });
const money = (cents: number, cur: string) => `${(cents / 100).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${cur.toUpperCase()}`;

async function captainOf(userId: string) {
  const { data } = await admin.from('captains').select('*').eq('user_id', userId).maybeSingle();
  return data;
}
async function refreshAccount(cap: { user_id: string; stripe_account_id: string }) {
  const acct = await stripe(`/accounts/${cap.stripe_account_id}`, undefined, 'GET');
  const ready = !!(acct.charges_enabled && acct.details_submitted && acct.capabilities?.transfers === 'active');
  await admin.from('captains').update({ stripe_ready: ready }).eq('user_id', cap.user_id);
  return { ready, details_submitted: !!acct.details_submitted, requirements: acct.requirements?.currently_due?.length || 0 };
}
async function loadBooking(id: string) {
  const { data: b } = await admin.from('bookings').select('*').eq('id', id).maybeSingle();
  if (!b) throw new HttpError(404, 'Réservation introuvable');
  return b;
}
async function syncPayment(b: any) {
  if (!b.stripe_pi || b.status !== 'accepted') return b.status;
  const pi = await stripe(`/payment_intents/${b.stripe_pi}`, undefined, 'GET');
  if (pi.status === 'succeeded') {
    const { data } = await admin.from('bookings').update({ status: 'paid', updated_at: new Date().toISOString() }).eq('id', b.id).eq('status', 'accepted').select('id');
    if (data?.length) await msg(b.id, `Paiement par carte reçu : ${money(b.total_cents, b.currency)}. Place confirmée.`);
    return 'paid';
  }
  return pi.status === 'processing' ? 'processing' : b.status;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const jwt = (req.headers.get('Authorization') || '').replace('Bearer ', '');
    const { data: { user } } = await admin.auth.getUser(jwt);
    if (!user) throw new HttpError(401, 'Connecte-toi');
    const { action, booking_id, return_url } = await req.json().catch(() => ({}));

    if (action === 'config') return json({ enabled: !!(SK && PK), fee_pct: FEE });

    if (action === 'onboard' || action === 'status' || action === 'dashboard') {
      const cap = await captainOf(user.id);
      if (!cap) throw new HttpError(400, 'Crée d’abord ton profil capitaine');
      if (cap.country === 'MA') throw new HttpError(400, 'Au Maroc, le paiement se règle directement avec le client');
      if (action === 'status') return json(cap.stripe_account_id ? await refreshAccount(cap) : { ready: false, details_submitted: false });
      if (action === 'dashboard') {
        if (!cap.stripe_account_id) throw new HttpError(400, 'Compte Stripe non créé');
        const l = await stripe(`/accounts/${cap.stripe_account_id}/login_links`);
        return json({ url: l.url });
      }
      let acctId = cap.stripe_account_id;
      if (!acctId) {
        const acct = await stripe('/accounts', {
          type: 'express', country: cap.country, email: user.email,
          capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
          business_profile: { product_description: 'Sorties de pêche en mer réservées sur Spartel', mcc: '7999' },
          metadata: { spartel_user: user.id },
        }, 'POST', `acct-${user.id}-${cap.country}`);
        acctId = acct.id;
        await admin.from('captains').update({ stripe_account_id: acctId }).eq('user_id', user.id);
      }
      const back = typeof return_url === 'string' && return_url.startsWith('https://') ? return_url : 'https://enzofpaduano-create.github.io/spartel/app/#/captain';
      const link = await stripe('/account_links', { account: acctId, refresh_url: back, return_url: back, type: 'account_onboarding' });
      return json({ url: link.url });
    }

    if (action === 'pay') {
      const b = await loadBooking(booking_id);
      if (b.client_id !== user.id) throw new HttpError(403, 'Accès refusé');
      if (b.pay_mode !== 'card') throw new HttpError(400, 'Cette sortie ne se paie pas par carte');
      if (b.status === 'paid') return json({ status: 'paid' });
      if (b.status !== 'accepted') throw new HttpError(400, 'Le capitaine doit d’abord accepter ta demande');
      const cap = await captainOf(b.host_id);
      if (!cap?.stripe_account_id || !cap.stripe_ready) throw new HttpError(400, 'Le capitaine n’a pas encore activé les paiements par carte');
      if (b.stripe_pi) {
        const pi = await stripe(`/payment_intents/${b.stripe_pi}`, undefined, 'GET');
        if (pi.status === 'succeeded') return json({ status: await syncPayment(b) });
        if (pi.status !== 'canceled') return json({ client_secret: pi.client_secret, pk: PK, amount: b.total_cents, currency: b.currency });
      }
      const { data: o } = await admin.from('outings').select('title, start_at').eq('id', b.outing_id).single();
      const fee = Math.round(b.total_cents * FEE / 100);
      const pi = await stripe('/payment_intents', {
        amount: b.total_cents, currency: b.currency.toLowerCase(),
        automatic_payment_methods: { enabled: true },
        application_fee_amount: fee,
        transfer_data: { destination: cap.stripe_account_id },
        description: `Spartel · ${o?.title || 'Sortie de pêche'}`.slice(0, 200),
        receipt_email: user.email,
        metadata: { booking_id: b.id, outing_id: b.outing_id },
      }, 'POST', `pi-${b.id}-${b.stripe_pi || 'first'}`);
      await admin.from('bookings').update({ stripe_pi: pi.id, fee_cents: fee }).eq('id', b.id);
      return json({ client_secret: pi.client_secret, pk: PK, amount: b.total_cents, currency: b.currency });
    }

    if (action === 'confirm') {
      const b = await loadBooking(booking_id);
      if (b.client_id !== user.id && b.host_id !== user.id) throw new HttpError(403, 'Accès refusé');
      return json({ status: await syncPayment(b) });
    }

    if (action === 'refund') {
      const b = await loadBooking(booking_id);
      if (b.host_id !== user.id) throw new HttpError(403, 'Seul le capitaine peut rembourser');
      if (b.status !== 'paid' || !b.stripe_pi) throw new HttpError(400, 'Rien à rembourser');
      await stripe('/refunds', { payment_intent: b.stripe_pi, reverse_transfer: true, refund_application_fee: true }, 'POST', `refund-${b.id}`);
      await admin.from('bookings').update({ status: 'refunded', updated_at: new Date().toISOString() }).eq('id', b.id);
      await msg(b.id, `Réservation annulée et remboursée : ${money(b.total_cents, b.currency)} (sous 5 à 10 jours sur la carte).`);
      return json({ status: 'refunded' });
    }

    throw new HttpError(400, 'Action inconnue');
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return json({ error: e instanceof Error ? e.message : 'Erreur' }, status);
  }
});
