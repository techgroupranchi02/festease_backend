const express = require('express');
const AuthController = require('../controllers/authController');
const SystemController = require('../controllers/systemController');
const DashboardController = require('../controllers/dashboardController');
const VolunteerController = require('../controllers/volunteerController');
const RegistrationController = require('../controllers/registrationController');
const CheckinController = require('../controllers/checkinController');
const QrController = require('../controllers/qrController');
const VenueController = require('../controllers/venueController');
const DriveController = require('../controllers/driveController');
const { authenticateJwt } = require('../middlewares/authMiddleware');
const authorizeRole = require('../middlewares/authorizeRole');

const router = express.Router();

/* ==========================================================================
   Auth Routes
   ========================================================================== */
router.get('/download/qr/:qr_id', QrController.generatePreListQrImage);
router.get('/download/all/pre-qr-images', QrController.generateAllPreListQrImage);
router.post('/decrypt-qr', QrController.decryptQr);

/* ==========================================================================
   Google Drive Image Proxy  [public — no auth required]
   GET /drive/images            → list all images in the configured Drive folder
   GET /drive/images/:file_id   → stream / proxy a single image
   ========================================================================== */
// const driveRouter = express.Router();
// driveRouter.use(authenticateJwt);
// driveRouter.get('/drive/images',          DriveController.listImages);
// driveRouter.get('/drive/images/:file_id', DriveController.proxyImage);
// router.use('/festivals/:festival_id', driveRouter);

router.post('/generate-saas-token', AuthController.generateSaasToken);
router.post('/login', AuthController.login);
// Google OAuth – server-side redirect flow (same pattern as Freecomers backend)
router.get('/auth/google/redirect', AuthController.googleRedirect);
router.get('/auth/google/callback', AuthController.googleCallback);

// Public System Routes
router.get('/system/config', SystemController.getConfig);
router.get('/system/health', SystemController.getHealth);
router.get('/system/tables', SystemController.getTables);
router.get('/health', SystemController.getHealth);

const authRouter = express.Router();
authRouter.use(authenticateJwt);
authRouter.get('/my-profile', AuthController.getMe); 
authRouter.post('/logout', AuthController.logout); 
authRouter.post('/saas-to-freecomers', AuthController.generateFreecomersToken);
router.use('/', authRouter);

/* ==========================================================================
   Festival: Dashboard  [owner only — admin role]
   ========================================================================== */
const dashRouter = express.Router({ mergeParams: true });
dashRouter.use(authenticateJwt, authorizeRole(['admin']));
dashRouter.get('/', DashboardController.getStats);
dashRouter.get('/checkedins-users', DashboardController.getCheckedInList);
dashRouter.get('/checkedins-filter-list', DashboardController.getCheckedInFilterList);
dashRouter.get('/registrations-users', DashboardController.getRegistrationsList);
dashRouter.get('/registrations-filter-list', DashboardController.getRegistrationsFilterList);
// dashRouter.get('/:festival_id/drive/images', DriveController.listImages);
// dashRouter.get('/:festival_id/drive/images/:file_id', DriveController.proxyImage);
dashRouter.get('/qr-attendees', DashboardController.getQrWithAttendees);
router.use('/festivals/:festival_id/dashboard', dashRouter);

/* ==========================================================================
   Festival: Users for Volunteer Assignment  [owner only — admin role]
   ========================================================================== */
const usersRouter = express.Router({ mergeParams: true });
usersRouter.use(authenticateJwt, authorizeRole(['admin']));
usersRouter.get('/', VolunteerController.getUsers);
usersRouter.get('/:user_id', VolunteerController.getUserById);
router.use('/festivals/:festival_id/users', usersRouter);

/* ==========================================================================
   Festival: Volunteer Assignment  [owner only — admin role]
   ========================================================================== */
const volunteerRouter = express.Router({ mergeParams: true });
volunteerRouter.use(authenticateJwt, authorizeRole(['admin']));
volunteerRouter.post('/', VolunteerController.assignVolunteer);
router.use('/festivals/:festival_id/volunteers', volunteerRouter);

/* ==========================================================================
   Festival: Venues  [owner only — admin role]
   ========================================================================== */
const venueRouter = express.Router({ mergeParams: true });
venueRouter.use(authenticateJwt, authorizeRole(['admin']));
venueRouter.post('/', VenueController.addUpdateVenues);
venueRouter.put('/:venue_id', VenueController.addUpdateVenues);
venueRouter.delete('/:venue_id', VenueController.deleteVenue);
venueRouter.get('/', VenueController.getVenues);
venueRouter.get('/:venue_id', VenueController.getVenue);
router.use('/festivals/:festival_id/venues', venueRouter);
router.use('/festivals/:festival_id/venue', venueRouter);

/* ==========================================================================
   Festival: Registrations / Attendees  [registration role]
   ========================================================================== */
const regRouter = express.Router({ mergeParams: true });
regRouter.use(authenticateJwt, authorizeRole(['registration']));
regRouter.post('/', RegistrationController.register);
regRouter.get('/:registration_id/pdf', RegistrationController.downloadPdf);
regRouter.post('/:registration_id/email', RegistrationController.sendTicket);
regRouter.get('/:registration_id/qr', QrController.generateQr); 
regRouter.get('/qr-unused', QrController.getUnusedQrData);
regRouter.get('/qr-prelist', QrController.getPreListQrData);
// regRouter.get('/qr-prelist/:qr_id/image', QrController.generatePreListQrImage);
regRouter.get('/:registration_id', CheckinController.getRegistration); 
regRouter.get('/', CheckinController.getRegistration); 
router.use('/festivals/:festival_id/registrations', regRouter);

/* ==========================================================================
   Festival: UnRegistrations / Attendees  [registration role]
   ========================================================================== */
const unregisteredRegRouter = express.Router({ mergeParams: true });
unregisteredRegRouter.use(authenticateJwt, authorizeRole(['registration']));
unregisteredRegRouter.post('/', RegistrationController.bulkUnregisteredRegister);
unregisteredRegRouter.get('/', RegistrationController.bulkGetUnregistered);
router.use('/festivals/:festival_id/un-registered', unregisteredRegRouter);


/* ==========================================================================
   Festival: Check-in  [checkin role]
   ========================================================================== */
const checkRouter = express.Router({ mergeParams: true });
checkRouter.use(authenticateJwt, authorizeRole(['checkin']));
checkRouter.get('/venues-list', CheckinController.getVenues); 
checkRouter.get('/qr-check/:qr_token', CheckinController.scanQrCode); 
checkRouter.post('/check-in', CheckinController.checkIn); 
router.use('/festivals/:festival_id', checkRouter);
module.exports = router;
