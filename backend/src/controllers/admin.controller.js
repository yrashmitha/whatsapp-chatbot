/**
 * @module controllers/admin.controller
 * @description Handlers for legacy admin routes (customers, messages, send, orders,
 * templates, products, attributes, clients, follow-up, media proxy).
 */

'use strict';

const axios   = require('axios');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const db      = require('../db');
const clientRouter = require('../services/clientRouter');
const buildSystemInstruction = require('../services/buildInstruction');
const { sendWhatsAppMessage } = require('../services/whatsapp');
const { model, calcCost }    = require('../services/gemini');
const { chatSessions }       = require('../workers/sessionManager');
const { embedText, productToText } = require('../services/embedder');
const { META_ACCESS_TOKEN, PHONE_NUMBER_ID, UPLOADS_DIR } = require('../config/env');

const TEMPLATES_DIR = path.join(__dirname, '../../public', 'templates');

/**
 * GET /admin/templates — list images in public/templates/.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {void}
 */
function listTemplates(_req, res) {
  if (!fs.existsSync(TEMPLATES_DIR)) return res.json([]);
  const files = fs.readdirSync(TEMPLATES_DIR)
    .filter(f => /\.(jpg|jpeg|png|webp|gif)$/i.test(f))
    .map(f => ({ name: f, url: `/templates/${f}` }));
  res.json(files);
}

/**
 * GET /admin/customers — list all customers.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function listCustomers(req, res) {
  const clientId = req.query.client_id || req.user?.clientId || null;
  console.log(`[ADMIN] GET /admin/customers client=${clientId}`);
  try {
    const customers = await db.getAllCustomers(clientId);
    res.json(customers);
  } catch (err) {
    console.error(`[ADMIN] customers error:`, err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /admin/messages/:phone — get messages and orders for a phone number.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function getMessages(req, res) {
  const phone = req.params.phone;
  const clientId = req.query.client_id || req.user?.clientId || null;
  console.log(`[ADMIN] GET /admin/messages/${phone}`);
  try {
    const [messages, orders] = await Promise.all([
      db.getMessagesByPhone(phone, clientId),
      db.getOrdersByPhone(phone, clientId),
    ]);
    res.json({ messages, orders });
  } catch (err) {
    console.error(`[ADMIN] messages error:`, err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /admin/send — send a human reply (text, image, or PDF) from the admin panel.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function sendAdminMessage(req, res) {
  const { phone, text, imageBase64, imageType, imageUrl, fileName } = req.body;
  console.log(`[ADMIN] POST /admin/send → ${phone} type=${imageUrl ? 'url' : imageBase64 ? 'upload' : 'text'}`);
  if (!phone) return res.status(400).json({ error: 'phone required' });

  try {
    if (imageUrl) {
      const publicUrl = `${process.env.PUBLIC_URL || `https://whatsapp-chatbot-production-038d.up.railway.app`}${imageUrl}`;
      await axios.post(
        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
        { messaging_product: 'whatsapp', to: phone, type: 'image', image: { link: publicUrl, caption: text || '' } },
        { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
      );
      await db.insertMessage(phone, `[Image]${text ? ': ' + text : ''}`, 'bot', null, null, 'image', null);
      console.log(`[ADMIN] Template image sent to ${phone}: ${publicUrl}`);
    } else if (imageBase64 && imageType) {
      const isPdf = imageType === 'application/pdf';
      const buffer = Buffer.from(imageBase64, 'base64');
      const formData = new FormData();
      formData.append('messaging_product', 'whatsapp');
      formData.append('type', imageType);
      formData.append('file', new Blob([buffer], { type: imageType }), fileName || (isPdf ? 'document.pdf' : 'image.jpg'));

      const uploadRes = await fetch(
        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/media`,
        { method: 'POST', headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` }, body: formData }
      );
      const uploadData = await uploadRes.json();
      if (!uploadData.id) throw new Error(`Media upload failed: ${JSON.stringify(uploadData)}`);
      console.log(`[ADMIN] Media uploaded, id=${uploadData.id} isPdf=${isPdf}`);

      if (isPdf) {
        await axios.post(
          `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
          { messaging_product: 'whatsapp', to: phone, type: 'document', document: { id: uploadData.id, filename: fileName || 'document.pdf', caption: text || '' } },
          { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
        );
        const pdfSaveName = `admin-pdf-${Date.now()}-${(fileName || 'document.pdf').replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
        fs.writeFileSync(path.join(UPLOADS_DIR, pdfSaveName), buffer);
        const pdfHostedUrl = `/uploads/${pdfSaveName}`;
        await db.insertMessage(phone, `[PDF: ${fileName || 'document.pdf'}]${text ? ' ' + text : ''}`, 'bot', null, null, 'pdf', pdfHostedUrl);
      } else {
        await axios.post(
          `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
          { messaging_product: 'whatsapp', to: phone, type: 'image', image: { id: uploadData.id, caption: text || '' } },
          { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}`, 'Content-Type': 'application/json' } }
        );
        await db.insertMessage(phone, `[Image]${text ? ': ' + text : ''}`, 'bot', null, null, 'image', null);
      }
    } else if (text) {
      await sendWhatsAppMessage(phone, text);
      await db.insertMessage(phone, text, 'bot');
    } else {
      return res.status(400).json({ error: 'text or image required' });
    }
    // Check 24-hour window and warn if closed
    const custRow = await db.pgQuery(
      `SELECT last_customer_message_at FROM customers WHERE phone_number=$1`,
      [phone]
    ).catch(() => ({ rows: [] }));
    const lastMsg = custRow.rows[0]?.last_customer_message_at;
    const windowOpen = !lastMsg || (Date.now() - new Date(lastMsg).getTime()) < 23 * 36e5;
    res.json({ ok: true, window_warning: !windowOpen });
  } catch (err) {
    console.error(`[ADMIN] send error:`, err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * DELETE /admin/customer/:phone — delete customer and all related data.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function deleteCustomer(req, res) {
  const phone = decodeURIComponent(req.params.phone);
  const clientId = req.query.client_id || req.user?.clientId || null;
  console.log(`[ADMIN] DELETE customer ${phone} client=${clientId}`);
  try {
    for (const key of chatSessions.keys()) { if (key.endsWith(`:${phone}`)) chatSessions.delete(key); }
    await db.deleteCustomer(phone, clientId);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[ADMIN] delete customer error:`, err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * DELETE /admin/customer/:phone/messages — delete chat history only.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function deleteMessages(req, res) {
  const phone = decodeURIComponent(req.params.phone);
  const clientId = req.query.client_id || req.user?.clientId || null;
  console.log(`[ADMIN] DELETE messages for ${phone}`);
  try {
    for (const key of chatSessions.keys()) { if (key.endsWith(`:${phone}`)) chatSessions.delete(key); }
    await db.deleteMessages(phone, clientId);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[ADMIN] delete messages error:`, err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * PATCH /admin/order/:orderId/status — update order status.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function updateOrderStatus(req, res) {
  const { orderId } = req.params;
  const { status }  = req.body;
  const allowed = ['pending', 'payment_received', 'paid', 'complete', 'cancelled'];
  if (!status || !allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
  }
  console.log(`[ADMIN] PATCH /admin/order/${orderId}/status → ${status}`);
  try {
    await db.updateOrderStatusById(orderId, status);
    res.json({ ok: true });
  } catch (err) {
    console.error(`[ADMIN] order status update error:`, err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /admin/media/:mediaId — proxy a WhatsApp media file.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function proxyMedia(req, res) {
  const { mediaId } = req.params;
  try {
    const metaRes = await axios.get(
      `https://graph.facebook.com/v18.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` } }
    );
    const mediaUrl = metaRes.data.url;
    if (!mediaUrl) return res.status(404).json({ error: 'media URL not found' });

    const imgRes = await axios.get(mediaUrl, {
      headers: { Authorization: `Bearer ${META_ACCESS_TOKEN}` },
      responseType: 'stream',
    });
    res.setHeader('Content-Type', imgRes.headers['content-type'] || 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    imgRes.data.pipe(res);
  } catch (err) {
    console.error(`[ADMIN] media proxy error for ${mediaId}:`, err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /admin/followup — generate an AI follow-up message for a lead.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function generateFollowup(req, res) {
  const { phone } = req.body;
  console.log(`[ADMIN] POST /admin/followup → ${phone}`);
  if (!phone) return res.status(400).json({ error: 'phone required' });
  try {
    const clientId = req.query.client_id || req.body?.client_id || req.user?.clientId || null;
    const messages = await db.getMessagesByPhone(phone, clientId);
    const historyText = messages
      .map(m => `${m.sender_type === 'user' ? 'Customer' : 'Assistant'}: ${m.message_text}`)
      .join('\n');

    const result = await model.generateContent(
      `You are a warm assistant for a professional astrology service. Below is a conversation with a potential customer who has NOT placed an order yet.\n\nConversation:\n${historyText}\n\nWrite a single short, warm, natural follow-up WhatsApp message to re-engage this customer. Be genuine — not pushy. Do not list packages or prices unless they previously asked. Just warmly re-open the conversation.`
    );
    const followupText = result.response.text().trim();
    const usage = result.response.usageMetadata || {};
    const cost  = calcCost(usage.promptTokenCount || 0, usage.candidatesTokenCount || 0);
    console.log(`[ADMIN] Follow-up generated for ${phone}: "${followupText.substring(0, 80)}" cost=$${cost.toFixed(6)}`);
    res.json({ ok: true, message: followupText, costUSD: +cost.toFixed(6) });
  } catch (err) {
    console.error(`[ADMIN] followup error:`, err.message);
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /admin/builtin-prompt — return the rendered built-in system prompt.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {void}
 */
function getBuiltinPrompt(_req, res) {
  try {
    const text = buildSystemInstruction();
    res.type('text/plain').send(text);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /admin/clients — list all clients.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function listClients(_req, res) {
  try {
    const clients = await clientRouter.getAllClients();
    res.json(clients);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /admin/clients/:clientId — get a single client and its config.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function getClient(req, res) {
  try {
    const client = await clientRouter.getClientById(req.params.clientId);
    if (!client) return res.status(404).json({ error: 'Client not found' });
    res.json(client);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /admin/upload-image — upload a product image to Cloudinary.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function uploadImage(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { CLOUDINARY_CLOUD_NAME: cloud, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = process.env;
  if (!cloud || !apiKey || !apiSecret) return res.status(500).json({ error: 'Cloudinary not configured' });
  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = crypto.createHash('sha1')
      .update(`folder=products&timestamp=${timestamp}${apiSecret}`)
      .digest('hex');
    const form = new FormData();
    form.append('file', new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname);
    form.append('folder', 'products');
    form.append('timestamp', String(timestamp));
    form.append('api_key', apiKey);
    form.append('signature', signature);
    const r = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/image/upload`, { method: 'POST', body: form });
    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: data.error?.message || 'Cloudinary error' });
    res.json({ url: data.secure_url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /admin/clients — create a new client and its config row.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function createClient(req, res) {
  const { id, name, type, phone_number_id, wa_token_env, wa_token, use_system_wa_token,
          webhook_verify_token, ai_model, system_prompt_mode, custom_prompt, temperature,
          brand_name, brand_color, logo_url, order_id_prefix, product_catalog_enabled,
          order_flow_enabled, admin_password_env, contact_number, knowledge_base_enabled,
          plugin_enabled, ai_enabled, gemini_api_key, use_system_gemini_key,
          package_id, bonus_messages, overage_limit, per_message_cost } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  try {
    await db.pgQuery(`INSERT INTO clients (id, name, type) VALUES ($1, $2, $3)`,
      [id, name, type || 'general']);
    await db.pgQuery(`
      INSERT INTO client_configs (client_id, phone_number_id, wa_token_env, wa_token, use_system_wa_token,
        webhook_verify_token, ai_model, system_prompt_mode, custom_prompt, temperature, brand_name,
        brand_color, logo_url, order_id_prefix, product_catalog_enabled, order_flow_enabled,
        admin_password_env, contact_number, knowledge_base_enabled, plugin_enabled, ai_enabled,
        gemini_api_key, use_system_gemini_key,
        package_id, bonus_messages, overage_limit, per_message_cost)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
      [id, phone_number_id || null, wa_token_env || null, wa_token || null,
       use_system_wa_token === true || use_system_wa_token === 'true',
       webhook_verify_token || null,
       ai_model || 'gemini-2.5-flash', system_prompt_mode || 'builtin', custom_prompt || null,
       parseFloat(temperature) || 0.70, brand_name || name, brand_color || '#075e54',
       logo_url || null, order_id_prefix || id.toUpperCase().slice(0,6),
       product_catalog_enabled === true || product_catalog_enabled === 'true',
       order_flow_enabled !== false && order_flow_enabled !== 'false',
       admin_password_env || 'ADMIN_PASSWORD',
       contact_number || null,
       knowledge_base_enabled === true || knowledge_base_enabled === 'true',
       plugin_enabled === true || plugin_enabled === 'true',
       ai_enabled !== false && ai_enabled !== 'false',
       gemini_api_key || null,
       use_system_gemini_key === true || use_system_gemini_key === 'true',
       package_id || null,
       Number(bonus_messages) || 0,
       Number(overage_limit) || 0,
       Number(per_message_cost) || 0]);
    clientRouter.invalidateCache(id);
    res.json({ ok: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * PUT /admin/clients/:clientId — update a client and its config.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function updateClient(req, res) {
  const { clientId } = req.params;
  const { name, type, active, phone_number_id, wa_token_env, wa_token, use_system_wa_token,
          webhook_verify_token, ai_model, system_prompt_mode, custom_prompt, temperature,
          brand_name, brand_color, logo_url, order_id_prefix, product_catalog_enabled,
          order_flow_enabled, admin_password_env, contact_number, knowledge_base_enabled,
          plugin_enabled, ai_enabled, gemini_api_key, use_system_gemini_key,
          package_id, bonus_messages, overage_limit, per_message_cost,
          thinking_budget, typing_delay_ms } = req.body;
  try {
    if (name !== undefined || type !== undefined || active !== undefined) {
      await db.pgQuery(
        `UPDATE clients SET name=COALESCE($1,name), type=COALESCE($2,type), active=COALESCE($3,active) WHERE id=$4`,
        [name || null, type || null, active !== undefined ? active : null, clientId]
      );
    }
    // Only update config fields that were explicitly sent
    if (Object.keys(req.body).some(k => k !== 'name' && k !== 'type' && k !== 'active')) {
      await db.pgQuery(`
        UPDATE client_configs SET
          phone_number_id=COALESCE($1,phone_number_id),
          wa_token_env=COALESCE($2,wa_token_env),
          wa_token=COALESCE($3,wa_token),
          use_system_wa_token=COALESCE($4,use_system_wa_token),
          webhook_verify_token=COALESCE($5,webhook_verify_token),
          ai_model=COALESCE($6,ai_model),
          system_prompt_mode=COALESCE($7,system_prompt_mode),
          custom_prompt=COALESCE($8,custom_prompt),
          temperature=COALESCE($9,temperature),
          brand_name=COALESCE($10,brand_name),
          brand_color=COALESCE($11,brand_color),
          logo_url=COALESCE($12,logo_url),
          order_id_prefix=COALESCE($13,order_id_prefix),
          product_catalog_enabled=COALESCE($14,product_catalog_enabled),
          order_flow_enabled=COALESCE($15,order_flow_enabled),
          admin_password_env=COALESCE($16,admin_password_env),
          contact_number=COALESCE($17,contact_number),
          knowledge_base_enabled=COALESCE($18,knowledge_base_enabled),
          plugin_enabled=COALESCE($19,plugin_enabled),
          ai_enabled=COALESCE($20,ai_enabled),
          gemini_api_key=COALESCE($21,gemini_api_key),
          use_system_gemini_key=COALESCE($22,use_system_gemini_key),
          package_id=COALESCE($23,package_id),
          bonus_messages=COALESCE($24,bonus_messages),
          overage_limit=COALESCE($25,overage_limit),
          per_message_cost=COALESCE($26,per_message_cost),
          thinking_budget=COALESCE($28,thinking_budget),
          typing_delay_ms=COALESCE($29,typing_delay_ms),
          updated_at=NOW()
        WHERE client_id=$27`,
        [
          phone_number_id !== undefined ? (phone_number_id || null) : null,
          wa_token_env !== undefined ? (wa_token_env || null) : null,
          wa_token !== undefined ? (wa_token || null) : null,
          use_system_wa_token !== undefined ? (use_system_wa_token === true || use_system_wa_token === 'true') : null,
          webhook_verify_token !== undefined ? (webhook_verify_token || null) : null,
          ai_model || null,
          system_prompt_mode || null,
          custom_prompt !== undefined ? (custom_prompt || null) : null,
          temperature !== undefined ? (parseFloat(temperature) || null) : null,
          brand_name || null,
          brand_color || null,
          logo_url !== undefined ? (logo_url || null) : null,
          order_id_prefix || null,
          product_catalog_enabled !== undefined ? (product_catalog_enabled === true || product_catalog_enabled === 'true') : null,
          order_flow_enabled !== undefined ? (order_flow_enabled !== false && order_flow_enabled !== 'false') : null,
          admin_password_env || null,
          contact_number !== undefined ? (contact_number || null) : null,
          knowledge_base_enabled !== undefined ? (knowledge_base_enabled === true || knowledge_base_enabled === 'true') : null,
          plugin_enabled !== undefined ? (plugin_enabled === true || plugin_enabled === 'true') : null,
          ai_enabled !== undefined ? (ai_enabled !== false && ai_enabled !== 'false') : null,
          gemini_api_key !== undefined ? (gemini_api_key || null) : null,
          use_system_gemini_key !== undefined ? (use_system_gemini_key === true || use_system_gemini_key === 'true') : null,
          package_id !== undefined ? (package_id || null) : null,
          bonus_messages !== undefined ? Number(bonus_messages) : null,
          overage_limit !== undefined ? Number(overage_limit) : null,
          per_message_cost !== undefined ? Number(per_message_cost) : null,
          clientId,
          thinking_budget !== undefined ? (thinking_budget === null || thinking_budget === '' ? null : Number(thinking_budget)) : null,
          typing_delay_ms !== undefined ? Number(typing_delay_ms) : null,
        ]);
    }
    clientRouter.invalidateCache(clientId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /admin/products?client_id=CLIENT_ID — list products for a client.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function listProducts(req, res) {
  const clientId = req.query.client_id || req.query.client;
  if (!clientId) return res.status(400).json({ error: 'client_id required' });
  try {
    const result = await db.pgQuery(
      `SELECT * FROM client_products WHERE client_id = $1 ORDER BY category, sort_order, name`,
      [clientId]
    );
    res.json(result.rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /admin/products — create a product.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function createProduct(req, res) {
  const { client_id, name, description, price, price_max, currency, category, subcategory, sku, image_url, sort_order, attributes } = req.body;
  if (!client_id || !name) return res.status(400).json({ error: 'client_id and name required' });
  try {
    const result = await db.pgQuery(
      `INSERT INTO client_products (client_id, name, description, price, price_max, currency, category, subcategory, sku, image_url, sort_order, attributes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [client_id, name, description || null, price || null, price_max || null,
       currency || 'LKR', category || null, subcategory || null, sku || null,
       image_url || null, sort_order || 0, JSON.stringify(attributes || {})]
    );
    const newId = result.rows[0].id;
    if (db.IS_PG) {
      embedText(productToText(req.body)).then(emb => db.saveProductEmbedding(newId, emb))
        .catch(e => console.warn('[EMBED] POST product:', e.message));
    }
    res.json({ ok: true, id: newId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * PUT /admin/products/:id — update a product.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function updateProduct(req, res) {
  const { id } = req.params;
  const { name, description, price, price_max, currency, category, subcategory, sku, image_url, sort_order, attributes, active } = req.body;
  try {
    await db.pgQuery(
      `UPDATE client_products SET name=$1, description=$2, price=$3, price_max=$4, currency=$5,
       category=$6, subcategory=$7, sku=$8, image_url=$9, sort_order=$10,
       attributes=$11, active=$12, updated_at=NOW() WHERE id=$13`,
      [name, description || null, price || null, price_max || null,
       currency || 'LKR', category || null, subcategory || null, sku || null,
       image_url || null, sort_order || 0, JSON.stringify(attributes || {}),
       active !== false, id]
    );
    if (db.IS_PG) {
      embedText(productToText(req.body)).then(emb => db.saveProductEmbedding(id, emb))
        .catch(e => console.warn('[EMBED] PUT product:', e.message));
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * DELETE /admin/products/:id — delete a product.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function deleteProduct(req, res) {
  try {
    await db.pgQuery(`DELETE FROM client_products WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * GET /admin/attributes?client=CLIENT_ID — list attribute schemas.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function listAttributes(req, res) {
  const clientId = req.query.client || 'astrology_001';
  try {
    const result = await db.pgQuery(
      `SELECT * FROM client_attribute_schemas WHERE client_id = $1 ORDER BY sort_order`,
      [clientId]
    );
    res.json(result.rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /admin/attributes — create or update an attribute schema field.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function createAttribute(req, res) {
  const { client_id, field_key, field_label, field_type, options, unit, filterable, sort_order } = req.body;
  if (!client_id || !field_key || !field_label) return res.status(400).json({ error: 'client_id, field_key, field_label required' });
  try {
    await db.pgQuery(
      `INSERT INTO client_attribute_schemas (client_id, field_key, field_label, field_type, options, unit, filterable, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (client_id, field_key) DO UPDATE SET
         field_label=$3, field_type=$4, options=$5, unit=$6, filterable=$7, sort_order=$8`,
      [client_id, field_key, field_label, field_type || 'text',
       options ? JSON.stringify(options) : null, unit || null,
       filterable !== false, sort_order || 0]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * DELETE /admin/attributes/:id — delete an attribute schema field.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function deleteAttribute(req, res) {
  try {
    await db.pgQuery(`DELETE FROM client_attribute_schemas WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

/**
 * POST /admin/attributes/bulk — upsert full attribute schema from JSON array.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function bulkAttributes(req, res) {
  const { client_id, attributes } = req.body;
  if (!client_id || !Array.isArray(attributes)) return res.status(400).json({ error: 'client_id and attributes[] required' });
  const errors = [];
  for (let i = 0; i < attributes.length; i++) {
    const a = attributes[i];
    if (!a.field_key || !a.field_label) { errors.push(`Item ${i}: field_key and field_label required`); continue; }
    try {
      await db.pgQuery(
        `INSERT INTO client_attribute_schemas (client_id, field_key, field_label, field_type, options, unit, filterable, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (client_id, field_key) DO UPDATE SET
           field_label=$3, field_type=$4, options=$5, unit=$6, filterable=$7, sort_order=$8`,
        [client_id, a.field_key, a.field_label, a.field_type || 'text',
         a.options ? JSON.stringify(a.options) : null, a.unit || null,
         a.filterable !== false, a.sort_order || i]
      );
    } catch (e) { errors.push(`Item ${i} (${a.field_key}): ${e.message}`); }
  }
  res.json({ ok: true, saved: attributes.length - errors.length, errors });
}

/**
 * POST /admin/products/bulk — import JSON array of products.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function bulkProducts(req, res) {
  const { client_id, products } = req.body;
  if (!client_id || !Array.isArray(products)) return res.status(400).json({ error: 'client_id and products[] required' });
  let schema = [];
  try {
    const r = await db.pgQuery(`SELECT field_key, field_type FROM client_attribute_schemas WHERE client_id=$1`, [client_id]);
    schema = r.rows;
  } catch (_) {}
  const validKeys = new Set(schema.map(s => s.field_key));

  const saved = [], errors = [];
  for (let i = 0; i < products.length; i++) {
    const p = products[i];
    if (!p.name) { errors.push(`Row ${i+1}: name is required`); continue; }
    if (p.attributes && validKeys.size > 0) {
      const unknown = Object.keys(p.attributes).filter(k => !validKeys.has(k));
      if (unknown.length) { errors.push(`Row ${i+1} (${p.name}): unknown attribute keys: ${unknown.join(', ')}`); continue; }
    }
    try {
      const r = await db.pgQuery(
        `INSERT INTO client_products (client_id,name,description,price,price_max,currency,category,subcategory,sku,image_url,sort_order,attributes,active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [client_id, p.name, p.description||null, p.price||null, p.price_max||null, p.currency||'LKR',
         p.category||null, p.subcategory||null, p.sku||null, p.image_url||null, p.sort_order||i,
         p.attributes ? JSON.stringify(p.attributes) : null, p.active !== false]
      );
      saved.push(r.rows[0].id);
    } catch (e) { errors.push(`Row ${i+1} (${p.name}): ${e.message}`); }
  }
  res.json({ ok: true, saved: saved.length, errors });
}

// ── Packages ──────────────────────────────────────────────────────────────────
async function listPackages(req, res) {
  try {
    const r = await db.pgQuery(`SELECT * FROM packages ORDER BY message_limit ASC`);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
}

async function createPackage(req, res) {
  const { id, name, message_limit, per_message_cost = 0 } = req.body;
  if (!id || !name || !message_limit) return res.status(400).json({ error: 'id, name, message_limit required' });
  try {
    await db.pgQuery(
      `INSERT INTO packages (id, name, message_limit, per_message_cost) VALUES ($1,$2,$3,$4)`,
      [id.trim(), name.trim(), Number(message_limit), Number(per_message_cost)]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

async function updatePackage(req, res) {
  const { packageId } = req.params;
  const { name, message_limit, per_message_cost } = req.body;
  try {
    await db.pgQuery(
      `UPDATE packages SET
        name=COALESCE($1,name),
        message_limit=COALESCE($2,message_limit),
        per_message_cost=COALESCE($3,per_message_cost)
       WHERE id=$4`,
      [name || null, message_limit != null ? Number(message_limit) : null, per_message_cost != null ? Number(per_message_cost) : null, packageId]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

async function deletePackage(req, res) {
  const { packageId } = req.params;
  try {
    await db.pgQuery(`DELETE FROM packages WHERE id=$1`, [packageId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

async function changeClientPackage(req, res) {
  const { clientId } = req.params;
  const { package_id } = req.body;
  if (!package_id) return res.status(400).json({ error: 'package_id required' });
  try {
    // Get current client config
    const clientRes = await db.pgQuery(
      `SELECT cc.package_id, cc.bonus_messages, p.message_limit AS package_message_limit
       FROM client_configs cc
       LEFT JOIN packages p ON p.id = cc.package_id
       WHERE cc.client_id=$1`, [clientId]
    );
    if (!clientRes.rows.length) return res.status(404).json({ error: 'Client not found' });
    const current = clientRes.rows[0];

    // Calculate remaining free messages this month
    const usageRes = await db.pgQuery(
      `SELECT COUNT(*)::int AS cnt FROM messages
       WHERE client_id=$1 AND sender_type='bot'
       AND created_at >= date_trunc('month', NOW())`, [clientId]
    );
    const used = usageRes.rows[0].cnt;
    const currentFreeLimit = (current.package_message_limit || 0) + (current.bonus_messages || 0);
    const remaining = Math.max(0, currentFreeLimit - used);

    // Update package and set rollover as bonus_messages
    await db.pgQuery(
      `UPDATE client_configs SET package_id=$1, bonus_messages=$2 WHERE client_id=$3`,
      [package_id, remaining, clientId]
    );
    res.json({ ok: true, bonus_messages: remaining });
  } catch (e) { res.status(500).json({ error: e.message }); }
}

module.exports = {
  listTemplates, listCustomers, getMessages, sendAdminMessage,
  deleteCustomer, deleteMessages, updateOrderStatus,
  proxyMedia, generateFollowup, getBuiltinPrompt,
  listClients, getClient, uploadImage, createClient, updateClient,
  listProducts, createProduct, updateProduct, deleteProduct,
  listAttributes, createAttribute, deleteAttribute, bulkAttributes, bulkProducts,
  listPackages, createPackage, updatePackage, deletePackage, changeClientPackage,
};
