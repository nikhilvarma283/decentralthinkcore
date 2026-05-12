/**
 * Hotel Search Agent — x402-gated demo agent on Algorand testnet.
 *
 * Same pattern as flightAgent.js — see that file for architecture notes.
 *
 * POST /api/v1/demo/hotel/search
 *   Body: { location, checkin, nights, category, maxResults }
 *   Requires: X-Payment header (500 microALGO on Algorand testnet)
 */

const { Router } = require('express');
const { requirePayment } = require('../payments/x402Middleware');
const logger = require('../lib/logger');

const router = Router();

const PRICE_MICROALGO = 500;

// Dummy hotel data — realistic hotels near Canary Wharf / London
const HOTEL_DATABASE = {
  'canary wharf': [
    { name: 'Canary Riverside Plaza Hotel',   stars: 5, area: 'Canary Wharf, E14',   price_per_night: 380, amenities: ['pool', 'gym', 'spa', 'river view', 'concierge'] },
    { name: 'Novotel London Canary Wharf',     stars: 4, area: 'Canary Wharf, E14',   price_per_night: 220, amenities: ['gym', 'restaurant', 'bar', 'business centre'] },
    { name: 'Ibis Styles London Excel',        stars: 3, area: 'Royal Docks, E16',    price_per_night: 130, amenities: ['restaurant', 'wifi', '24h reception'] },
    { name: 'Aloft London Excel',              stars: 4, area: 'Royal Victoria, E16', price_per_night: 195, amenities: ['gym', 'bar', 'rooftop terrace', 'pet friendly'] },
    { name: 'Doubletree by Hilton Docklands', stars: 4, area: 'London Bridge, SE1',   price_per_night: 260, amenities: ['pool', 'gym', 'river views', 'restaurant'] },
  ],
  'london': [
    { name: 'The Savoy',                stars: 5, area: 'Strand, WC2',     price_per_night: 850, amenities: ['pool', 'spa', 'multiple restaurants', 'butler service'] },
    { name: 'Claridge\'s',              stars: 5, area: 'Mayfair, W1',     price_per_night: 750, amenities: ['spa', 'fine dining', 'bar', 'concierge'] },
    { name: 'Premier Inn London City',  stars: 3, area: 'City of London',  price_per_night: 110, amenities: ['restaurant', 'wifi', 'flexible check-out'] },
    { name: 'citizenM London Shoreditch', stars: 4, area: 'Shoreditch, E1', price_per_night: 160, amenities: ['gym', 'rooftop bar', 'self check-in', 'cloudM app'] },
  ],
};

function findHotels(location, category) {
  const loc = location.toLowerCase();
  let pool = HOTEL_DATABASE['london']; // default

  for (const [key, hotels] of Object.entries(HOTEL_DATABASE)) {
    if (loc.includes(key)) {
      pool = hotels;
      break;
    }
  }

  // Filter by category
  if (category === 'luxury' || category === '5-star') {
    pool = pool.filter((h) => h.stars === 5);
  } else if (category === 'business' || category === '4-star') {
    pool = pool.filter((h) => h.stars >= 4);
  } else if (category === 'budget' || category === '3-star') {
    pool = pool.filter((h) => h.stars <= 3);
  }

  return pool.length > 0 ? pool : HOTEL_DATABASE['london'];
}

// GET /info — public metadata
router.get('/info', (_req, res) => {
  res.json({
    agent_id: 'demo-hotel-search',
    name: 'Hotel Search Agent',
    description: 'Searches available hotels by location, dates and category.',
    capabilities: ['hotel-search', 'travel', 'information-retrieval'],
    pricing: {
      scheme: 'exact',
      amountMicroAlgo: PRICE_MICROALGO,
      asset: 'ALGO',
      network: process.env.ALGORAND_NETWORK || 'testnet',
    },
    x402Version: 1,
    note: 'Demo agent — returns realistic dummy data for Algorand testnet demonstration.',
  });
});

// POST /search — x402 gated
router.post(
  '/search',
  requirePayment({
    amountMicroAlgo: PRICE_MICROALGO,
    agentId: 'demo-hotel-search',
    description: 'Hotel search query (500 microALGO)',
  }),
  (req, res) => {
    const {
      location = 'Canary Wharf',
      checkin,
      nights = 3,
      category = 'business',
      max_results = 3,
    } = req.body || {};

    logger.info('HotelAgent: search request', {
      location, checkin, nights, category,
      paymentTxId: req.payment?.txId,
    });

    const hotels = findHotels(location, category);
    const results = hotels
      .slice(0, Math.min(max_results, 5))
      .map((h) => ({
        ...h,
        checkin: checkin || 'Next Tuesday',
        checkout: `${nights} nights later`,
        total_price_usd: h.price_per_night * nights,
        availability: 'Available',
        booking_ref: `DEMO-${h.name.split(' ')[0].toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
      }));

    res.json({
      agent_id: 'demo-hotel-search',
      query: { location, checkin, nights, category },
      results,
      result_count: results.length,
      currency: 'USD',
      payment: req.payment,
      note: 'Demo data — not real bookings',
    });
  }
);

// ── /execute — called by Cortex executor (x402 gated, natural-language step) ─

router.post(
  '/execute',
  requirePayment({
    amountMicroAlgo: PRICE_MICROALGO,
    agentId: 'demo-hotel-search',
    description: 'Hotel search query (500 microALGO)',
  }),
  (req, res) => {
    const { step = '', context = '' } = req.body || {};
    const text = `${step} ${context}`.toLowerCase();

    logger.info('HotelAgent: execute request', {
      stepLength: step.length,
      paymentTxId: req.payment?.txId,
    });

    // Parse location
    const location = text.includes('canary') ? 'canary wharf' : 'london';

    // Parse category
    const category = (text.includes('5-star') || text.includes('luxury'))    ? 'luxury'
                   : (text.includes('budget') || text.includes('3-star'))    ? 'budget'
                   : 'business';  // default

    // Parse nights
    const nightsMatch = text.match(/(\d+)\s*night/);
    const nights = nightsMatch ? parseInt(nightsMatch[1]) : 3;

    const hotels = findHotels(location, category);
    const results = hotels.slice(0, 3).map((h) => ({
      ...h,
      checkin: 'Next available Tuesday',
      checkout: `${nights} nights later`,
      total_price_usd: h.price_per_night * nights,
      availability: 'Available',
      booking_ref: `DEMO-${h.name.split(' ')[0].toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
    }));

    const summary = results.length === 0
      ? `No ${category} hotels found in ${location}.`
      : [
          `Found ${results.length} ${category} hotel(s) in ${location} (${nights} nights):`,
          ...results.map((h, i) =>
            `  ${i + 1}. ${h.name} (${h.stars}★) — ${h.area}` +
            ` — $${h.price_per_night}/night ($${h.total_price_usd} total)` +
            ` — ${h.amenities.slice(0, 3).join(', ')}`
          ),
        ].join('\n');

    res.json({
      agent_id: 'demo-hotel-search',
      result: summary,
      results,
      usage: { input_tokens: 0, output_tokens: 0 },
      payment: req.payment,
      note: 'Demo data — not real bookings',
    });
  }
);

module.exports = router;
