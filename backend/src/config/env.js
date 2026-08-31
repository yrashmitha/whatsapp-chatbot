/**
 * @module config/env
 * @description Centralised environment variable exports.
 * All other modules must import environment constants from here.
 */

'use strict';

require('dotenv').config();

/** @type {boolean} True when running in WhatsApp test mode */
const IS_TEST = (process.env.WHATSAPP_MODE || 'test') !== 'prod';

/** @type {string} Active Meta access token (test or prod) */
const META_ACCESS_TOKEN = IS_TEST
  ? process.env.TEST_META_ACCESS_TOKEN
  : process.env.PROD_META_ACCESS_TOKEN;

/** @type {string} Active WhatsApp Phone Number ID (test or prod) */
const PHONE_NUMBER_ID = IS_TEST
  ? process.env.TEST_PHONE_NUMBER_ID
  : process.env.PROD_PHONE_NUMBER_ID;

/** @type {string} JWT signing secret */
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod';

/** @type {number} HTTP listen port */
const PORT = parseInt(process.env.PORT, 10) || 3000;

/** @type {string} Public base URL for media links */
const PUBLIC_URL = process.env.PUBLIC_URL || 'https://whatsapp-chatbot-production-038d.up.railway.app';

/** @type {string} Persistent uploads directory (Railway volume at /data) */
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/data/uploads';

/**
 * @type {string} Public base URL of the customer report-delivery site
 * (the pahantharu_web Next.js app, live at www.puranajothirwedaya.com). The
 * token link handed to customers is `${DELIVERY_BASE_URL}/r/<token>`.
 */
const DELIVERY_BASE_URL = (process.env.DELIVERY_BASE_URL || 'https://www.puranajothirwedaya.com').replace(/\/+$/, '');

/**
 * @type {string} Shared secret the delivery site presents (X-Delivery-Key) to
 * reach the /internal/delivery/* endpoints. Fail closed when unset.
 */
const DELIVERY_INTERNAL_KEY = process.env.DELIVERY_INTERNAL_KEY || '';

module.exports = {
  IS_TEST,
  META_ACCESS_TOKEN,
  PHONE_NUMBER_ID,
  JWT_SECRET,
  PORT,
  PUBLIC_URL,
  UPLOADS_DIR,
  DELIVERY_BASE_URL,
  DELIVERY_INTERNAL_KEY,
};
