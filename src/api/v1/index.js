const { Router } = require("express");
const invokeRouter = require("./invoke");
const invocationsRouter = require("./invocations");
const authRouter = require("./auth");
const vaultRouter = require("./vault");
const auditRouter = require("./audit");
const marketplaceRouter = require("./marketplace");
const paymentsRouter = require("./payments");
const agentRouter = require("./agent");
const builderRouter = require("./builder");
const messagingRouter = require("./messaging");
const demoRouter = require("./demo");

const router = Router();

router.use("/auth", authRouter);
router.use("/invoke", invokeRouter);
router.use("/invocations", invocationsRouter);
router.use("/vault", vaultRouter);
router.use("/audit", auditRouter);
router.use("/marketplace", marketplaceRouter);
router.use("/payments", paymentsRouter);
router.use("/agent", agentRouter);
router.use("/builder", builderRouter);
router.use("/messaging", messagingRouter);
router.use("/demo", demoRouter);

module.exports = router;
