const { Router } = require("express");
const invokeRouter = require("./invoke");
const invocationsRouter = require("./invocations");

const router = Router();

router.use("/invoke", invokeRouter);
router.use("/invocations", invocationsRouter);

module.exports = router;
