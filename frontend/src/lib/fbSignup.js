/**
 * WhatsApp Embedded Signup — browser side.
 *
 * Loads Meta's JS SDK once, then launches the Embedded Signup popup and resolves
 * with everything the backend needs to finish onboarding:
 *   { code, waba_id, phone_number_id }
 *
 * `code` comes from the FB.login callback; `waba_id` / `phone_number_id` arrive
 * separately via a postMessage event, so we wait for both.
 */

let sdkPromise = null;

/** Inject connect.facebook.net/sdk.js and resolve when FB.init has run. */
export function loadFbSdk({ appId, graphVersion = 'v21.0' }) {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    if (window.FB) return resolve(window.FB);
    window.fbAsyncInit = function () {
      window.FB.init({ appId, cookie: true, xfbml: false, version: graphVersion });
      resolve(window.FB);
    };
    const s = document.createElement('script');
    s.src = 'https://connect.facebook.net/en_US/sdk.js';
    s.async = true;
    s.defer = true;
    s.crossOrigin = 'anonymous';
    s.onerror = () => reject(new Error('Failed to load the Facebook SDK'));
    document.body.appendChild(s);
  });
  return sdkPromise;
}

/**
 * Launch the Embedded Signup flow.
 * @param {{ appId: string, configId: string, graphVersion?: string }} cfg
 * @returns {Promise<{ code: string, waba_id: string|null, phone_number_id: string|null }>}
 */
export async function launchWhatsAppSignup(cfg) {
  const FB = await loadFbSdk(cfg);

  return new Promise((resolve, reject) => {
    let sessionInfo = {};
    let settled = false;

    const onMessage = (event) => {
      if (!/facebook\.com$/.test(new URL(event.origin).hostname)) return;
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      if (data.type !== 'WA_EMBEDDED_SIGNUP') return;
      if (data.event === 'FINISH' || data.event === 'FINISH_ONLY_WABA') {
        sessionInfo = data.data || {};
      } else if (data.event === 'CANCEL' || data.event === 'ERROR') {
        cleanup();
        if (!settled) { settled = true; reject(new Error(data.data?.error_message || 'Signup cancelled')); }
      }
    };

    const cleanup = () => window.removeEventListener('message', onMessage);
    window.addEventListener('message', onMessage);

    FB.login((response) => {
      cleanup();
      if (settled) return;
      settled = true;
      const code = response?.authResponse?.code;
      if (!code) return reject(new Error('No authorization code returned'));
      resolve({
        code,
        waba_id: sessionInfo.waba_id || null,
        phone_number_id: sessionInfo.phone_number_id || null,
      });
    }, {
      config_id: cfg.configId,
      response_type: 'code',
      override_default_response_type: true,
      extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
    });
  });
}
