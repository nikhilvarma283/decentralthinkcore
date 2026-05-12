/**
 * Demo Router — mounts the x402 demo specialist agents.
 *
 * Routes:
 *   GET  /api/v1/demo/flight/info       — agent metadata (no payment)
 *   POST /api/v1/demo/flight/search     — human-friendly search (500 microALGO)
 *   POST /api/v1/demo/flight/execute    — Cortex executor entrypoint (500 microALGO)
 *
 *   GET  /api/v1/demo/hotel/info        — agent metadata (no payment)
 *   POST /api/v1/demo/hotel/search      — human-friendly search (500 microALGO)
 *   POST /api/v1/demo/hotel/execute     — Cortex executor entrypoint (500 microALGO)
 *
 * All payment-gated endpoints require a valid X-Payment header (Algorand testnet).
 * See src/payments/x402Middleware.js for payment verification details.
 */

const { Router } = require('express');
const flightAgent = require('../../demo/flightAgent');
const hotelAgent  = require('../../demo/hotelAgent');

const router = Router();

router.use('/flight', flightAgent);
router.use('/hotel',  hotelAgent);

// Directory: list all available demo agents
router.get('/', (_req, res) => {
  res.json({
    demo_agents: [
      {
        id: 'demo-flight-search',
        info: '/api/v1/demo/flight/info',
        search: '/api/v1/demo/flight/search',
        execute: '/api/v1/demo/flight/execute',
        payment_required: true,
        price_microalgo: 500,
      },
      {
        id: 'demo-hotel-search',
        info: '/api/v1/demo/hotel/info',
        search: '/api/v1/demo/hotel/search',
        execute: '/api/v1/demo/hotel/execute',
        payment_required: true,
        price_microalgo: 500,
      },
    ],
    network: process.env.ALGORAND_NETWORK || 'testnet',
    note: 'Demo agents — x402 payments on Algorand testnet. Not real bookings.',
  });
});

module.exports = router;
