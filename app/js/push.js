// Notifications push (Web Push / VAPID). Sur iPhone : seulement une fois l'appli installée sur l'écran d'accueil.
import { isIOS, isStandalone } from './install.js';
import { VAPID_PUBLIC } from './config.js';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export async function pushStatus() {
  if (isIOS && !isStandalone()) return 'need-install';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  try {
    const reg = await navigator.serviceWorker.ready;
    return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
  } catch (e) { return 'off'; }
}

const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };

async function store(sb, uid, sub) {
  const j = sub.toJSON();
  const { error } = await sb.from('push_subscriptions').upsert({ user_id: uid, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' });
  if (error) throw error;
}

export async function enablePush(sb, uid) {
  if (!pushSupported()) throw new Error('Notifications non disponibles sur cet appareil');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications refusées : autorise-les dans les réglages de ton téléphone');
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(VAPID_PUBLIC) }));
  await store(sb, uid, sub);
}

export async function disablePush(sb) {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); await sub.unsubscribe(); }
  } catch (e) {}
}

// Au démarrage : si déjà autorisé, s'assure que l'abonnement est bien enregistré pour ce compte.
export async function syncPush(sb, uid) {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await store(sb, uid, sub);
  } catch (e) {}
}
