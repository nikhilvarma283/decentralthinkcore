/**
 * Flight Search Agent — x402-gated demo agent on Algorand testnet.
 *
 * Demonstrates how an external specialist agent works in the DecentralThink
 * architecture:
 *   1. Cortex anonymizes the task (strips user identity)
 *   2. Cortex recruits this agent via x402 (pays 500 microALGO)
 *   3. Agent receives an abstract query — no user identity, no org context
 *   4. Agent returns structured flight options
 *   5. Cortex assembles the results locally inside the TEE
 *
 * In production this would be a separate deployed service, possibly run by
 * a third-party travel API provider. For the demo it runs on the same server.
 *
 * POST /api/v1/demo/flight/search
 *   Body: { origin, destination, date, class, maxResults }
 *   Requires: X-Payment header (500 microALGO on Algorand testnet)
 */

const { Router } = require('express');
const { requirePayment } = require('../payments/x402Middleware');
const logger = require('../lib/logger');

const router = Router();

const PRICE_MICROALGO = 500;

// Dummy flight data — realistic routes and prices
const FLIGHT_DATABASE = [
  { airline: 'Delta Air Lines',    flight: 'DL401',  departs: '07:00', arrives: '19:15', duration: '7h 15m', stops: 0, price_usd: 3200, class: 'business' },
  { airline: 'British Airways',    flight: 'BA178',  departs: '09:45', arrives: '21:50', duration: '7h 05m', stops: 0, price_usd: 2950, class: 'business' },
  { airline: 'Virgin Atlantic',    flight: 'VS4',    departs: '11:30', arrives: '23:25', duration: '6h 55m', stops: 0, price_usd: 3100, class: 'business' },
  { airline: 'American Airlines',  flight: 'AA100',  departs: '17:00', arrives: '05:20', duration: '7h 20m', stops: 0, price_usd: 2800, class: 'business' },
  { airline: 'United Airlines',    flight: 'UA18',   departs: '19:30', arrives: '08:05', duration: '7h 35m', stops: 0, price_usd: 2750, class: 'business' },
  { airline: 'Iberia',             flight: 'IB6251', departs: '10:15', arrives: '23:40', duration: '8h 25m', stops: 1, price_usd: 2400, class: 'business' },
];

// GET /info — public metadata (no payment)
router.get('/info', (_req, res) => {
  res.json({
    agent_id: 'demo-flight-search',
    name: 'Flight Search Agent',
    description: 'Searches available flights by route, date and cabin class.',
    capabilities: ['flight-search', 'travel', 'information-retrieval'],
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
    agentId: 'demo-flight-search',
    description: 'Flight search query (500 microALGO)',
  }),
  (req, res) => {
    const {
      origin = 'JFK',
      destination = 'LHR',
      date,
      cabin_class = 'business',
      max_results = 3,
    } = req.body || {};

    logger.info('FlightAgent: search request', {
      origin, destination, date, cabin_class,
      paymentTxId: req.payment?.txId,
    });

    // Filter by cabin class, sort by price, limit results
    const results = FLIGHT_DATABASE
      .filter((f) => f.class === cabin_class.toLowerCase())
      .sort((a, b) => a.price_usd - b.price_usd)
      .slice(0, Math.min(max_results, 5))
      .map((f) => ({
        ...f,
        origin,
        destination,
        date: date || 'Next available Tuesday',
        availability: 'Available',
        booking_ref: `DEMO-${f.flight}-${Date.now().toString(36).toUpperCase()}`,
      }));

    res.json({
      agent_id: 'demo-flight-search',
      query: { origin, destination, date, cabin_class },
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
    agentId: 'demo-flight-search',
    description: 'Flight search query (500 microALGO)',
  }),
  (req, res) => {
    const { step = '', context = '' } = req.body || {};
    const text = `${step} ${context}`.toLowerCase();

    logger.info('FlightAgent: execute request', {
      stepLength: step.length,
      paymentTxId: req.payment?.txId,
    });

    // Parse origin / destination from step description
    const originMatch  = text.match(/\b(jfk|lga|ewr|lhr|cdg|fra|ams|dxb|sfo|lax|ord|bos|mia)\b/g);
    const origin      = originMatch?.[0]?.toUpperCase() || 'JFK';
    const destination = originMatch?.[1]?.toUpperCase() || (origin === 'JFK' ? 'LHR' : 'JFK');

    // Parse cabin class
    const cabin_class = text.includes('first')    ? 'first'
                      : text.includes('economy')  ? 'economy'
                      : 'business';                // default for exec travel

    const results = FLIGHT_DATABASE
      .filter((f) => f.class === cabin_class || cabin_class === 'first')
      .sort((a, b) => a.price_usd - b.price_usd)
      .slice(0, 3)
      .map((f) => ({
        ...f,
        origin,
        destination,
        date: 'Next available Tuesday',
        availability: 'Available',
        booking_ref: `DEMO-${f.flight}-${Date.now().toString(36).toUpperCase()}`,
      }));

    // Return a human-readable result string (Cortex assembles results as text)
    const summary = results.length === 0
      ? `No ${cabin_class} class flights found.`
      : [
          `Found ${results.length} ${cabin_class} class flight(s) from ${origin} to ${destination}:`,
          ...results.map((f, i) =>
            `  ${i + 1}. ${f.airline} ${f.flight} — departs ${f.departs}, arrives ${f.arrives}` +
            ` (${f.duration}, ${f.stops === 0 ? 'non-stop' : f.stops + ' stop(s)'}) — $${f.price_usd} USD`
          ),
        ].join('\n');

    res.json({
      agent_id: 'demo-flight-search',
      result: summary,
      results,
      usage: { input_tokens: 0, output_tokens: 0 },
      payment: req.payment,
      note: 'Demo data — not real bookings',
    });
  }
);

module.exports = router;
