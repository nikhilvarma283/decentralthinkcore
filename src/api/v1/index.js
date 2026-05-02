const { Router } = require("express");
const invokeRouter = require("./invoke");
const invocationsRouter = require("./invocations");
const authRouter = require("./auth");
const vaultRouter = require("./vault");

const router = Router();

router.use("/auth", authRouter);
router.use("/invoke", invokeRouter);
router.use("/invocations", invocationsRouter);
router.use("/vault", vaultRouter);

module.exports = router;
