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
async function listCustomers(_req, res) {
  console.log(`[ADMIN] GET /admin/customers`);
  try {
    const customers = await db.getAllCustomers();
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
  console.log(`[ADMIN] GET /admin/messages/${phone}`);
  try {
    const [messages, orders] = await Promise.all([
      db.getMessagesByPhone(phone),
      db.getOrdersByPhone(phone),
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
    res.json({ ok: true });
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
  console.log(`[ADMIN] DELETE customer ${phone}`);
  try {
    for (const key of chatSessions.keys()) { if (key.endsWith(`:${phone}`)) chatSessions.delete(key); }
    await db.deleteCustomer(phone);
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
  console.log(`[ADMIN] DELETE messages for ${phone}`);
  try {
    for (const key of chatSessions.keys()) { if (key.endsWith(`:${phone}`)) chatSessions.delete(key); }
    await db.deleteMessages(phone);
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
    const messages = await db.getMessagesByPhone(phone);
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
  const { id, name, type, phone_number_id, wa_token_env, ai_model, system_prompt_mode,
          custom_prompt, temperature, brand_name, brand_color, logo_url,
          order_id_prefix, product_catalog_enabled, order_flow_enabled, admin_password_env } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id and name required' });
  try {
    await db.pgQuery(`INSERT INTO clients (id, name, type) VALUES ($1, $2, $3)`,
      [id, name, type || 'general']);
    await db.pgQuery(`
      INSERT INTO client_configs (client_id, phone_number_id, wa_token_env, ai_model,
        system_prompt_mode, custom_prompt, temperature, brand_name, brand_color, logo_url,
        order_id_prefix, product_catalog_enabled, order_flow_enabled, admin_password_env)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [id, phone_number_id || null, wa_token_env || null, ai_model || 'gemini-2.5-flash',
       system_prompt_mode || 'custom', custom_prompt || null,
       parseFloat(temperature) || 0.70, brand_name || name, brand_color || '#075e54',
       logo_url || null, order_id_prefix || id.toUpperCase().slice(0,6),
       product_catalog_enabled === true || product_catalog_enabled === 'true',
       order_flow_enabled !== false && order_flow_enabled !== 'false',
       admin_password_env || 'ADMIN_PASSWORD']);
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
  const { name, type, active, phone_number_id, wa_token_env, ai_model, system_prompt_mode,
          custom_prompt, temperature, brand_name, brand_color, logo_url,
          order_id_prefix, product_catalog_enabled, order_flow_enabled, admin_password_env } = req.body;
  try {
    if (name || type || active !== undefined) {
      await db.pgQuery(
        `UPDATE clients SET name=COALESCE($1,name), type=COALESCE($2,type), active=COALESCE($3,active) WHERE id=$4`,
        [name || null, type || null, active !== undefined ? active : null, clientId]
      );
    }
    await db.pgQuery(`
      UPDATE client_configs SET
        phone_number_id=$1, wa_token_env=$2, ai_model=$3, system_prompt_mode=$4,
        custom_prompt=$5, temperature=$6, brand_name=$7, brand_color=$8, logo_url=$9,
        order_id_prefix=$10, product_catalog_enabled=$11, order_flow_enabled=$12,
        admin_password_env=$13, updated_at=NOW()
      WHERE client_id=$14`,
      [phone_number_id || null, wa_token_env || null, ai_model || 'gemini-2.5-flash',
       system_prompt_mode || 'custom', custom_prompt || null,
       parseFloat(temperature) || 0.70, brand_name || null, brand_color || '#075e54',
       logo_url || null, order_id_prefix || null,
       product_catalog_enabled === true || product_catalog_enabled === 'true',
       order_flow_enabled !== false && order_flow_enabled !== 'false',
       admin_password_env || 'ADMIN_PASSWORD', clientId]);
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

module.exports = {
  listTemplates, listCustomers, getMessages, sendAdminMessage,
  deleteCustomer, deleteMessages, updateOrderStatus,
  proxyMedia, generateFollowup, getBuiltinPrompt,
  listClients, getClient, uploadImage, createClient, updateClient,
  listProducts, createProduct, updateProduct, deleteProduct,
  listAttributes, createAttribute, deleteAttribute, bulkAttributes, bulkProducts,
};
