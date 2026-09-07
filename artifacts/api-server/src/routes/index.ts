import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import passwordResetRouter from "./passwordReset";
import categoriesRouter from "./categories";
import officesRouter from "./offices";
import favouritesRouter from "./favourites";
import platformRouter from "./platform";
import adminRouter from "./admin";
import contactRouter from "./contact";
import storageRouter from "./storage";
import serviceRequestsRouter from "./serviceRequests";
import analyticsRouter from "./analytics";
import { analyticsOfficeReportRouter } from "./analyticsOfficeReport";
import adminHealthRouter from "./adminHealth";
import subscriptionsRouter from "./subscriptions";
import commercialActivationRouter from "./commercialActivation";
import supplySlotRouter from "./supplySlots";
import paymentsRouter, { webhookRawBodyMiddleware } from "./payments";
import officeSlotsRouter from "./officeSlots";
import providerVerificationRouter from "./providerVerification";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(passwordResetRouter);
router.use(categoriesRouter);
router.use(officesRouter);
router.use(favouritesRouter);
router.use(platformRouter);
router.use(adminRouter);
router.use(contactRouter);
router.use(storageRouter);
router.use(serviceRequestsRouter);
router.use(analyticsRouter);
router.use(analyticsOfficeReportRouter);
router.use(adminHealthRouter);
router.use(subscriptionsRouter);
router.use(commercialActivationRouter);
router.use(supplySlotRouter);
router.use(officeSlotsRouter);
router.use(providerVerificationRouter);
// Webhook MUST be mounted before express.json() — raw-body middleware applied per-route.
// Note: this router is mounted at /api in app.ts, so the path here is /payments/webhook
// (not /api/payments/webhook).
router.post("/payments/webhook", webhookRawBodyMiddleware);
router.use(paymentsRouter);

export default router;
