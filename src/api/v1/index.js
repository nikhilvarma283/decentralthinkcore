const { Router } = require("express");
const invokeRouter = require("./invoke");
const invocationsRouter = require("./invocations");
const authRouter = require("./auth");
const vaultRouter = require("./vault");
const auditRouter = require("./audit");
const marketplaceRouter = require("./marketplace");

const router = Router();

router.use("/auth", authRouter);
router.use("/invoke", invokeRouter);
router.use("/invocations", invocationsRouter);
router.use("/vault", vaultRouter);
router.use("/audit", auditRouter);
router.use("/marketplace", marketplaceRouter);

module.exports = router;
