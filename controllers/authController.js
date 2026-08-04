const fs = require('fs');
const path = require('path');
const { query } = require('../config/db');
const User = require('../models/User');
const Event = require('../models/Event');
const { generateToken } = require('../utils/jwt');
const { verifyLaravelPassword } = require('../utils/password');
const { revokeToken } = require('../utils/tokenBlacklist');
const { validate, rules, sendValidationError } = require('../middlewares/validate');

class AuthController {


  /**
   * POST /api/auth/generate-token
   */
  static async generateSaasToken(req, res) {
    try {
      let { user_id } = req.body || {};
      if (typeof user_id === 'string') {
        user_id = parseInt(user_id, 10);
      }

      // --- Input Validation ---
      const result = validate(req.body, {
        user_id: [rules.required(), rules.positiveInt()],
      });
      if (!result.valid) return sendValidationError(res, result.errors);

      // 1. Fetch user
      const user = await User.findById(user_id);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found.'
        });
      }

      // 2. Verify user has an event with event_type = 'film_festival'
      const hasFestivalEvent = await Event.hasFilmFestivalEvent(user.id);
      if (!hasFestivalEvent) {
        return res.status(403).json({
          success: false,
          message: 'Access restricted: Only users associated with film festival events or registered as volunteers can generate tokens.'
        });
      }

      // 3. Resolve film_festival_id for this user
      const filmFestivalId = await Event.getFilmFestivalIdForUser(user.id);

      // 4. Generate RS256 Asymmetric JWT Token
      const tokenPayload = {
        user_id: user.id,
        sub: user.id,
        userId: user.id,
        email: user.email,
        account_type: user.account_type,
        film_festival_id: filmFestivalId
      };

      const token = generateToken(tokenPayload, '24h');
      return res.json({
        success: true,
        message: 'Token generated successfully',
        token,
        user: {
          user_id: user.id,
          accountType: user.account_type,
          email: user.email,
          film_festival_id: filmFestivalId
        }
      });

    } catch (error) {
      console.error('generateToken error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'An internal error occurred while generating the token.'
      });
    }
  }

  /**
   * POST /api/auth/generate-freecomers-token
   */
  static async generateFreecomersToken(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : req.body.token;

      if (!token) {
        return res.status(401).json({
          success: false,
          message: 'Authorization token is required.'
        });
      }

      const backendUrl = (process.env.FREECOMERS_BACKEND_URL || 'https://api.autovertest.com/').replace(/\/$/, '');
      const frontendUrl = (process.env.FREECOMERS_FRONTEND_URL || 'https://autovertest.com/').replace(/\/$/, '');

      // Call Freecomers backend endpoint to get freecomers token/verification
      let freecomersToken = token;
      try {
        const response = await fetch(`${backendUrl}/api/v1/user/saas-to-freecomers`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          }
        });

        const responseText = await response.text();
        if (responseText && responseText.trim().startsWith('{')) {
          const data = JSON.parse(responseText);
          freecomersToken = data.token || data.data?.token || token;
        }
      } catch (err) {
        console.warn('Freecomers remote endpoint verification fallback:', err.message);
      }

      const redirectUrl = `${frontendUrl}/saas-to-freecomers?token=${encodeURIComponent(freecomersToken)}`;

      return res.json({
        success: true,
        message: 'Token verified successfully',
        redirect_url: redirectUrl
      });
    } catch (error) {
      console.error('generateFreecomersToken error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'An internal error occurred while generating the Freecomers token.',
        error: error.message
      });
    }
  }












  /**
   * GET /api/auth/google/redirect
   * Redirects the browser to Google's OAuth consent screen.
   */
  static googleRedirect(req, res) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_REDIRECT_URL;

    if (!clientId || !redirectUri) {
      return res.status(500).json({ success: false, message: 'Google OAuth is not configured on the server.' });
    }

    // Accept accountType from query (e.g. ?accountType=individual or ?accountType=organization)
    // and carry it through the OAuth flow via the state parameter.
    const accountType = req.query.accountType || req.query.account_type || '';
    const allowedTypes = ['individual', 'organization'];
    if (accountType && !allowedTypes.includes(accountType.trim().toLowerCase())) {
      return res.status(400).json({ success: false, message: 'accountType must be "individual" or "organization".' });
    }

    // Encode accountType in state so the callback can retrieve it
    const state = accountType ? Buffer.from(JSON.stringify({ accountType: accountType.trim().toLowerCase() })).toString('base64') : '';

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'online',
      prompt: 'select_account',
      ...(state ? { state } : {}),
    });

    return res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
  }

  /**
   * GET /api/auth/google/callback
   * Google calls this after the user approves. Exchanges code → tokens → email → JWT.
   * On success, redirects to the frontend login page with ?google-token=JWT
   */
  static async googleCallback(req, res) {
    const frontendUrl = (process.env.FESTEASE_FRONTEND_URL || 'https://festease.autovertest.com').replace(/\/$/, '');

    try {
      const { code, error: oauthError, state } = req.query;

      if (oauthError || !code) {
        return res.redirect(`${frontendUrl}/google-signin?error=${encodeURIComponent(oauthError || 'Access Denied')}`);
      }

      // Decode accountType from state param (set by googleRedirect)
      let accountType = null;
      if (state) {
        try {
          const decoded = JSON.parse(Buffer.from(state, 'base64').toString('utf8'));
          const rawAccountType = decoded.accountType || decoded.account_type;
          if (rawAccountType) accountType = rawAccountType.trim().toLowerCase();
        } catch {
          // Ignore malformed state
        }
      }

      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      const redirectUri = process.env.GOOGLE_REDIRECT_URL;

      // 1. Exchange authorization code for tokens
      let accessToken;
      try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }).toString(),
        });
        const tokenData = await tokenRes.json();
        if (!tokenRes.ok || !tokenData.access_token) {
          throw new Error(tokenData.error_description || 'Failed to exchange code for token');
        }
        accessToken = tokenData.access_token;
      } catch (err) {
        console.error('Google token exchange failed:', err.message);
        return res.redirect(`${frontendUrl}/google-signin?error=${encodeURIComponent('Token Exchange Failed')}`);
      }

      // 2. Fetch user info from Google
      let googleEmail;
      try {
        const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const userData = await userRes.json();
        googleEmail = userData.email;
        if (!googleEmail) throw new Error('No email in Google userinfo');
      } catch (err) {
        console.error('Google userinfo failed:', err.message);
        return res.redirect(`${frontendUrl}/google-signin?error=${encodeURIComponent('User Info Not Found')}`);
      }

      const cleanEmail = googleEmail.trim().toLowerCase();

      // 3. Fetch all user accounts matching email
      let matchingUsers = await User.findAllByEmail(cleanEmail);
      if (!matchingUsers || matchingUsers.length === 0) {
        return res.redirect(`${frontendUrl}/google-signin?error=${encodeURIComponent('Account Not Found')}`);
      }

      // Filter by accountType if provided (mirrors login behaviour)
      if (accountType) {
        matchingUsers = matchingUsers.filter(u => u.account_type === accountType);
        if (matchingUsers.length === 0) {
          return res.redirect(`${frontendUrl}/google-signin?error=${encodeURIComponent('Account Not Found')}`);
        }
      }

      let selectedUser = null;
      let selectedProfile = null;
      let isFestivalAuthorized = false;
      let isSaasDisabled = false;
      let isUserInactive = false;
      let volunteerErrorReason = null;

      for (const candidateUser of matchingUsers) {
        if (Number(candidateUser.status) !== 1) { isUserInactive = true; continue; }

        let isAuthorizedForCandidate = false;

        if (candidateUser.account_type === 'individual') {
          // Individual account: check for active volunteer access on a festival with is_saas = 1
          const volunteerFestivals = await Event.getVolunteerFestivals(candidateUser.id);
          if (volunteerFestivals && volunteerFestivals.length > 0) {
            isAuthorizedForCandidate = true;
          } else {
            // Check if user is associated as volunteer to a festival where is_saas = 0
            const [saasOffRows] = await query(`
              SELECT 1 FROM saas_volunteers sv
              JOIN film_festivals ff ON (sv.festival_id = ff.film_festival_id OR sv.event_id = ff.event_id)
              JOIN events e ON ff.event_id = e.event_id
              WHERE sv.user_id = ? AND (sv.expiry_date IS NULL OR sv.expiry_date > NOW())
                AND sv.is_active = 1 AND sv.status = 'active'
                AND e.event_type = 'film_festival' AND (e.is_deleted = 0 OR e.is_deleted IS NULL)
                AND (e.is_saas = 0 OR e.is_saas IS FALSE)
              LIMIT 1
            `, [candidateUser.id]);

            if (saasOffRows.length > 0) {
              isSaasDisabled = true;
            } else {
              const [allVolRows] = await query(
                'SELECT expiry_date, status FROM saas_volunteers WHERE user_id = ? AND is_active = 1',
                [candidateUser.id]
              );
              if (allVolRows.length === 0) {
                if (!volunteerErrorReason) volunteerErrorReason = 'Not A Volunteer';
              } else {
                const hasNonExpired = allVolRows.some(r => !r.expiry_date || new Date(r.expiry_date) > new Date());
                if (!hasNonExpired) {
                  if (!volunteerErrorReason) volunteerErrorReason = 'Volunteer Expired';
                } else {
                  const nonExpiredRows = allVolRows.filter(r => !r.expiry_date || new Date(r.expiry_date) > new Date());
                  const hasActive = nonExpiredRows.some(r => r.status === 'active');
                  if (!hasActive && !volunteerErrorReason) volunteerErrorReason = 'Volunteer Disabled';
                }
              }
            }
          }
        } else if (candidateUser.account_type === 'organization') {
          // Organization account: check if user is owner of any festival and is_saas is enabled
          const ownerFestivals = await Event.getOwnerFestivals(candidateUser.id);
          if (ownerFestivals && ownerFestivals.length > 0) {
            isAuthorizedForCandidate = true;
          } else {
            // Check if user is owner of a festival where is_saas = 0
            const [saasOffOwnerRows] = await query(`
              SELECT 1 FROM events e
              WHERE e.user_id = ? AND e.event_type = 'film_festival' AND (e.is_deleted = 0 OR e.is_deleted IS NULL) AND (e.is_saas = 0 OR e.is_saas IS FALSE)
              UNION
              SELECT 1 FROM film_festivals ff
              JOIN events e ON ff.event_id = e.event_id
              WHERE ff.user_id = ? AND e.event_type = 'film_festival' AND (e.is_deleted = 0 OR e.is_deleted IS NULL) AND (e.is_saas = 0 OR e.is_saas IS FALSE)
              UNION
              SELECT 1 FROM film_festivals_organisers ffo
              JOIN film_festivals ff ON ffo.film_festival_id = ff.film_festival_id
              JOIN events e ON ff.event_id = e.event_id
              WHERE ffo.user_id = ? AND e.event_type = 'film_festival' AND (e.is_deleted = 0 OR e.is_deleted IS NULL) AND (e.is_saas = 0 OR e.is_saas IS FALSE)
              LIMIT 1
            `, [candidateUser.id, candidateUser.id, candidateUser.id]);

            if (saasOffOwnerRows.length > 0) {
              isSaasDisabled = true;
            }
          }
        } else {
          // Fallback for any other account_type
          const hasSaasFestival = await Event.hasFilmFestivalEvent(candidateUser.id);
          if (hasSaasFestival) {
            isAuthorizedForCandidate = true;
          } else {
            const hasAnyFestival = await Event.hasAnyFestivalAssociation(candidateUser.id);
            if (hasAnyFestival) isSaasDisabled = true;
          }
        }

        if (isAuthorizedForCandidate) {
          isFestivalAuthorized = true;
          const userWithProfile = await User.getProfile(candidateUser.id);
          const candidateProfile = userWithProfile ? userWithProfile.profile : null;

          if (!selectedUser || (candidateProfile?.image_name && !selectedProfile?.image_name)) {
            selectedUser = candidateUser;
            selectedProfile = candidateProfile;
          }
        }
      }

      // Handle authorization failures — redirect with error code
      if (isUserInactive && !selectedUser) {
        return res.redirect(`${frontendUrl}/google-signin?error=${encodeURIComponent('Account Inactive')}`);
      }

      if (isSaasDisabled && !isFestivalAuthorized) {
        return res.redirect(`${frontendUrl}/google-signin?error=${encodeURIComponent('SAAS Disabled')}`);
      }

      if (!isFestivalAuthorized && volunteerErrorReason && !selectedUser) {
        return res.redirect(`${frontendUrl}/google-signin?error=${encodeURIComponent(volunteerErrorReason)}`);
      }

      if (!isFestivalAuthorized || !selectedUser) {
        return res.redirect(`${frontendUrl}/google-signin?error=${encodeURIComponent('No Festival Access')}`);
      }

      // 4. Check ownership & build roles
      const [eventsRows] = await query('SELECT 1 FROM events WHERE user_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1', [selectedUser.id]);
      const [festivalsRows] = await query('SELECT 1 FROM film_festivals WHERE user_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1', [selectedUser.id]);
      const isOwner = eventsRows.length > 0 || festivalsRows.length > 0;

      // 5. Fetch festivals list
      const authPrefix = (process.env.non_auth_image_url_prefix || process.env.auth_image_url_prefix || 'https://api.autovertest.com/api/v1/non-auth-user/retrieve-media').replace(/\/+$/, '');
      let loginFestivals;
      if (isOwner) {
        const ownerFestivals = await Event.getOwnerFestivals(selectedUser.id);
        loginFestivals = ownerFestivals.map(f => ({
          event_id: f.event_id, festival_id: f.festival_id, name: f.event_name,
          banner: f.festival_banner ? `${authPrefix}/images/film-festivals/${f.festival_banner}` : null,
          logo: f.festival_logo ? `${authPrefix}/images/film-festivals/${f.festival_logo}` : null,
          roles: ['admin', 'registration', 'checkin'],
        }));
      } else {
        const volunteerFestivals = await Event.getVolunteerFestivals(selectedUser.id);
        loginFestivals = volunteerFestivals.map(f => {
          let parsedRoles = [];
          if (f.roles) {
            if (typeof f.roles === 'string') { try { parsedRoles = JSON.parse(f.roles); } catch (e) { parsedRoles = [f.roles]; } }
            else if (Array.isArray(f.roles)) { parsedRoles = f.roles; }
          }
          return {
            event_id: f.event_id, festival_id: f.festival_id, name: f.event_name,
            banner: f.festival_banner ? `${authPrefix}/images/film-festivals/${f.festival_banner}` : null,
            logo: f.festival_logo ? `${authPrefix}/images/film-festivals/${f.festival_logo}` : null,
            roles: parsedRoles,
          };
        });

        if (loginFestivals.length === 0) {
          return res.redirect(`${frontendUrl}/google-signin?error=${encodeURIComponent('Volunteer Disabled')}`);
        }
      }

      // 6. Generate JWT and redirect to frontend
      const tokenPayload = {
        user_id: selectedUser.id,
        sub: selectedUser.id,
        userId: selectedUser.id,
        email: selectedUser.email,
        account_type: selectedUser.account_type,
      };
      const jwtToken = generateToken(tokenPayload, '24h');

      // Pass a compact payload so the frontend can read user + festivals without an extra API call
      // const userData = {
      //   user_id:       selectedUser.id,
      //   account_type:  selectedUser.account_type,
      //   name:          selectedProfile?.name          || null,
      //   username:      selectedProfile?.username      || null,
      //   profile_pic:   selectedProfile?.profile_pic   || null,
      //   thumbnail_pic: selectedProfile?.thumbnail_pic || null,
      //   email:         selectedUser.email,
      //   user_is:       isOwner ? 'owner' : 'volunteer',
      //   festivals:     loginFestivals,
      // };

      // const encoded = encodeURIComponent(JSON.stringify({ token: jwtToken, user: userData }));
      return res.redirect(`${frontendUrl}/google-signin?token=${jwtToken}`);

    } catch (error) {
      console.error('googleCallback error:', error.message);
      const frontendUrl = (process.env.FESTEASE_FRONTEND_URL || 'https://festease.autovertest.com').replace(/\/$/, '');
      return res.redirect(`${frontendUrl}/google-signin?error=${encodeURIComponent('Something went wrong.')}`);
    }
  }
  /**
   * POST /api/auth/login
   */
  static async login(req, res) {
    try {
      const accountType = req.body?.accountType || req.body?.account_type;
      const { email, password } = req.body || {};

      // --- Input Validation ---
      const validationRules = {
        email: [rules.required(), rules.email(), rules.maxLength(255)],
        password: [rules.required(), rules.string(), rules.maxLength(128)],
        accountType: [rules.required(), rules.string(), rules.inList(['individual', 'organization'])],
      };
      const result = validate({ ...req.body, accountType }, validationRules);
      if (!result.valid) return sendValidationError(res, result.errors);

      const cleanEmail = email.trim().toLowerCase();

      // 1. Fetch all user accounts matching email (handles dual individual/organization accounts)
      let matchingUsers = await User.findAllByEmail(cleanEmail);
      if (!matchingUsers || matchingUsers.length === 0) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password.'
        });
      }

      // Filter by accountType if provided in request body
      if (accountType) {
        const cleanAccountType = accountType.trim().toLowerCase();
        matchingUsers = matchingUsers.filter(u => u.account_type === cleanAccountType);
        if (matchingUsers.length === 0) {
          return res.status(401).json({
            success: false,
            message: 'Invalid email or password.'
          });
        }
      }

      let selectedUser = null;
      let selectedProfile = null;
      let passwordMatched = false;
      let isFestivalAuthorized = false;
      let isSaasDisabled = false;
      let isUserInactive = false;
      let passwordMatchedUserId = null;
      let volunteerErrorReason = null;

      for (const candidateUser of matchingUsers) {
        if (!candidateUser.password) continue;

        // Verify password
        const isMatch = await verifyLaravelPassword(password, candidateUser.password);
        if (!isMatch) continue;

        passwordMatched = true;
        passwordMatchedUserId = candidateUser.id;

        // Check user status = 1
        if (Number(candidateUser.status) !== 1) {
          isUserInactive = true;
          continue;
        }

        let isAuthorizedForCandidate = false;

        if (candidateUser.account_type === 'individual') {
          // Individual account: check for active volunteer access on a festival with is_saas = 1
          const volunteerFestivals = await Event.getVolunteerFestivals(candidateUser.id);
          if (volunteerFestivals && volunteerFestivals.length > 0) {
            isAuthorizedForCandidate = true;
          } else {
            // Check if user is associated as volunteer to a festival where is_saas = 0
            const [saasOffRows] = await query(`
              SELECT 1 FROM saas_volunteers sv
              JOIN film_festivals ff ON (sv.festival_id = ff.film_festival_id OR sv.event_id = ff.event_id)
              JOIN events e ON ff.event_id = e.event_id
              WHERE sv.user_id = ? AND (sv.expiry_date IS NULL OR sv.expiry_date > NOW())
                AND sv.is_active = 1 AND sv.status = 'active'
                AND e.event_type = 'film_festival' AND (e.is_deleted = 0 OR e.is_deleted IS NULL)
                AND (e.is_saas = 0 OR e.is_saas IS FALSE)
              LIMIT 1
            `, [candidateUser.id]);

            if (saasOffRows.length > 0) {
              isSaasDisabled = true;
            } else {
              const [allVolRows] = await query(
                'SELECT expiry_date, status FROM saas_volunteers WHERE user_id = ? AND is_active = 1',
                [candidateUser.id]
              );
              if (allVolRows.length === 0) {
                if (!volunteerErrorReason) volunteerErrorReason = 'not_a_volunteer';
              } else {
                const hasNonExpired = allVolRows.some(r => !r.expiry_date || new Date(r.expiry_date) > new Date());
                if (!hasNonExpired) {
                  if (!volunteerErrorReason) volunteerErrorReason = 'volunteer_expired';
                } else {
                  const nonExpiredRows = allVolRows.filter(r => !r.expiry_date || new Date(r.expiry_date) > new Date());
                  const hasActive = nonExpiredRows.some(r => r.status === 'active');
                  if (!hasActive && !volunteerErrorReason) volunteerErrorReason = 'volunteer_disabled';
                }
              }
            }
          }
        } else if (candidateUser.account_type === 'organization') {
          // Organization account: check if user is owner of any festival and is_saas is enabled
          const ownerFestivals = await Event.getOwnerFestivals(candidateUser.id);
          if (ownerFestivals && ownerFestivals.length > 0) {
            isAuthorizedForCandidate = true;
          } else {
            // Check if user is owner of a festival where is_saas = 0
            const [saasOffOwnerRows] = await query(`
              SELECT 1 FROM events e
              WHERE e.user_id = ? AND e.event_type = 'film_festival' AND (e.is_deleted = 0 OR e.is_deleted IS NULL) AND (e.is_saas = 0 OR e.is_saas IS FALSE)
              UNION
              SELECT 1 FROM film_festivals ff
              JOIN events e ON ff.event_id = e.event_id
              WHERE ff.user_id = ? AND e.event_type = 'film_festival' AND (e.is_deleted = 0 OR e.is_deleted IS NULL) AND (e.is_saas = 0 OR e.is_saas IS FALSE)
              UNION
              SELECT 1 FROM film_festivals_organisers ffo
              JOIN film_festivals ff ON ffo.film_festival_id = ff.film_festival_id
              JOIN events e ON ff.event_id = e.event_id
              WHERE ffo.user_id = ? AND e.event_type = 'film_festival' AND (e.is_deleted = 0 OR e.is_deleted IS NULL) AND (e.is_saas = 0 OR e.is_saas IS FALSE)
              LIMIT 1
            `, [candidateUser.id, candidateUser.id, candidateUser.id]);

            if (saasOffOwnerRows.length > 0) {
              isSaasDisabled = true;
            }
          }
        } else {
          // Fallback for any other account_type
          const hasSaasFestival = await Event.hasFilmFestivalEvent(candidateUser.id);
          if (hasSaasFestival) {
            isAuthorizedForCandidate = true;
          } else {
            const hasAnyFestival = await Event.hasAnyFestivalAssociation(candidateUser.id);
            if (hasAnyFestival) isSaasDisabled = true;
          }
        }

        if (isAuthorizedForCandidate) {
          isFestivalAuthorized = true;
          const userWithProfile = await User.getProfile(candidateUser.id);
          const candidateProfile = userWithProfile ? userWithProfile.profile : null;

          if (!selectedUser || (candidateProfile?.image_name && !selectedProfile?.image_name)) {
            selectedUser = candidateUser;
            selectedProfile = candidateProfile;
          }
        }
      }

      // Handle Authentication Failure Cases
      if (!passwordMatched) {
        return res.status(401).json({
          success: false,
          message: 'Invalid email or password.'
        });
      }

      if (isUserInactive && !selectedUser) {
        return res.status(403).json({
          success: false,
          message: 'Access restricted: Your account is inactive.'
        });
      }

      if (!isFestivalAuthorized && volunteerErrorReason && !selectedUser) {
        if (volunteerErrorReason === 'not_a_volunteer') {
          return res.status(403).json({
            success: false,
            message: 'Access restricted: You are not registered as a volunteer for any festival.'
          });
        } else if (volunteerErrorReason === 'volunteer_expired') {
          return res.status(403).json({
            success: false,
            message: 'Access restricted: Your volunteer access has expired for all festivals.'
          });
        } else if (volunteerErrorReason === 'volunteer_disabled') {
          return res.status(403).json({
            success: false,
            message: 'Access restricted: Your volunteer account has been disabled for all festivals.'
          });
        }
      }

      // If festival is found but SaaS is disabled on the event, block with a specific error
      if (isSaasDisabled && !isFestivalAuthorized) {
        return res.status(403).json({
          success: false,
          message: 'Access restricted: SaaS access is not enabled for your festival or event.'
        });
      }

      if (!isFestivalAuthorized || !selectedUser) {
        return res.status(403).json({
          success: false,
          message: 'Access restricted: Only users associated with film festival events or registered as volunteers can log in.'
        });
      }

      // 2. Resolve film_festival_id for this user
      const filmFestivalId = await Event.getFilmFestivalIdForUser(selectedUser.id);

      // Check if user is event owner or festival owner
      const [eventsRows] = await query(
        'SELECT 1 FROM events WHERE user_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1',
        [selectedUser.id]
      );
      const [festivalsRows] = await query(
        'SELECT 1 FROM film_festivals WHERE user_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1',
        [selectedUser.id]
      );
      const isOwner = eventsRows.length > 0 || festivalsRows.length > 0;

      let roles = [];
      if (isOwner) {
        roles = ["admin", "registration", "checkin"];
      } else {
        const [volunteerRows] = await query(
          'SELECT roles FROM saas_volunteers WHERE user_id = ? AND (expiry_date IS NULL OR expiry_date > NOW()) AND is_active = 1 AND status = \'active\'',
          [selectedUser.id]
        );
        const rolesSet = new Set();
        for (const row of volunteerRows) {
          if (row.roles) {
            let parsed = [];
            if (typeof row.roles === 'string') {
              try {
                parsed = JSON.parse(row.roles);
              } catch (e) {
                parsed = [row.roles];
              }
            } else if (Array.isArray(row.roles)) {
              parsed = row.roles;
            }
            if (Array.isArray(parsed)) {
              parsed.forEach(r => rolesSet.add(r));
            } else {
              rolesSet.add(parsed);
            }
          }
        }
        roles = Array.from(rolesSet);
      }

      // 3. Fetch festivals with per-festival roles for login response
      const authPrefixLogin = (process.env.non_auth_image_url_prefix || process.env.auth_image_url_prefix || 'https://api.autovertest.com/api/v1/non-auth-user/retrieve-media').replace(/\/+$/, '');
      let loginFestivals;
      if (isOwner) {
        const ownerFestivals = await Event.getOwnerFestivals(selectedUser.id);
        loginFestivals = ownerFestivals.map(f => ({
          event_id: f.event_id,
          festival_id: f.festival_id,
          name: f.event_name,
          banner: f.festival_banner ? `${authPrefixLogin}/images/film-festivals/${f.festival_banner}` : null,
          logo: f.festival_logo ? `${authPrefixLogin}/images/film-festivals/${f.festival_logo}` : null,
          roles: ['admin', 'registration', 'checkin']
        }));
      } else {
        const volunteerFestivals = await Event.getVolunteerFestivals(selectedUser.id);
        loginFestivals = volunteerFestivals.map(f => {
          let parsedRoles = [];
          if (f.roles) {
            if (typeof f.roles === 'string') {
              try { parsedRoles = JSON.parse(f.roles); } catch (e) { parsedRoles = [f.roles]; }
            } else if (Array.isArray(f.roles)) {
              parsedRoles = f.roles;
            }
          }
          return {
            event_id: f.event_id,
            festival_id: f.festival_id,
            name: f.event_name,
            banner: f.festival_banner ? `${authPrefixLogin}/images/film-festivals/${f.festival_banner}` : null,
            logo: f.festival_logo ? `${authPrefixLogin}/images/film-festivals/${f.festival_logo}` : null,
            roles: parsedRoles
          };
        });

        // Block login if volunteer has no active/enabled festivals
        if (loginFestivals.length === 0) {
          // Determine why: expired vs disabled vs not assigned
          const [allVolRows] = await query(
            'SELECT expiry_date, status FROM saas_volunteers WHERE user_id = ? AND is_active = 1',
            [selectedUser.id]
          );

          if (allVolRows.length === 0) {
            return res.status(403).json({
              success: false,
              message: 'Access restricted: You are not registered as a volunteer for any festival.'
            });
          }

          const hasNonExpired = allVolRows.some(r =>
            !r.expiry_date || new Date(r.expiry_date) > new Date()
          );
          if (!hasNonExpired) {
            return res.status(403).json({
              success: false,
              message: 'Access restricted: Your volunteer access has expired for all festivals.'
            });
          }

          return res.status(403).json({
            success: false,
            message: 'Access restricted: Your volunteer account has been disabled for all festivals.'
          });
        }
      }

      // 4. Generate RS256 Asymmetric JWT Token
      const tokenPayload = {
        user_id: selectedUser.id,
        sub: selectedUser.id,
        userId: selectedUser.id,
        email: selectedUser.email,
        account_type: selectedUser.account_type,
      };

      const token = generateToken(tokenPayload, '24h');

      return res.json({
        success: true,
        message: 'Login successful',
        token
        // user: {
        //   user_id: selectedUser.id,
        //   account_type: selectedUser.account_type,
        //   name: selectedProfile ? selectedProfile.name : null,
        //   username: selectedProfile ? selectedProfile.username : null,
        //   profile_pic: selectedProfile ? selectedProfile.profile_pic : null,
        //   thumbnail_pic: selectedProfile ? selectedProfile.thumbnail_pic : null,
        //   email: selectedUser.email,
        //   user_is: isOwner ? 'owner' : 'volunteer',
        //   festivals: loginFestivals
        // }
      });

    } catch (error) {
      console.error('Login message: ', error.message);
      return res.status(500).json({
        success: false,
        message: 'An internal error occurred during login.'
      });
    }
  }

  /**
   * GET /api/auth/my-profile or /api/auth/me
   */
  static async getMe(req, res) {
    try {
      const userId = req.user.user_id || req.user.userId || req.user.sub;
      const userWithProfile = await User.getProfile(userId);

      if (!userWithProfile) {
        return res.status(404).json({
          success: false,
          message: 'User profile not found'
        });
      }



      const profile = userWithProfile.profile;

      // Check if user is event owner or festival owner
      const [eventsRows] = await query(
        'SELECT 1 FROM events WHERE user_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1',
        [userId]
      );
      const [festivalsRows] = await query(
        'SELECT 1 FROM film_festivals WHERE user_id = ? AND (is_deleted = 0 OR is_deleted IS NULL) LIMIT 1',
        [userId]
      );
      const isOwner = eventsRows.length > 0 || festivalsRows.length > 0;

      let roles = [];
      if (isOwner) {
        roles = ["admin", "registration", "checkin"];
      } else {
        const [volunteerRows] = await query(
          'SELECT roles FROM saas_volunteers WHERE user_id = ? AND (expiry_date IS NULL OR expiry_date > NOW()) AND is_active = 1 AND status = \'active\'',
          [userId]
        );
        const rolesSet = new Set();
        for (const row of volunteerRows) {
          if (row.roles) {
            let parsed = [];
            if (typeof row.roles === 'string') {
              try {
                parsed = JSON.parse(row.roles);
              } catch (e) {
                parsed = [row.roles];
              }
            } else if (Array.isArray(row.roles)) {
              parsed = row.roles;
            }
            if (Array.isArray(parsed)) {
              parsed.forEach(r => rolesSet.add(r));
            } else {
              rolesSet.add(parsed);
            }
          }
        }
        roles = Array.from(rolesSet);
      }

      // Fetch list of festivals with per-festival roles
      const authPrefix = (process.env.non_auth_image_url_prefix || process.env.auth_image_url_prefix || 'https://api.autovertest.com/api/v1/non-auth-user/retrieve-media').replace(/\/+$/, '');
      let formattedFestivals;

      if (isOwner) {
        const ownerFestivals = await Event.getOwnerFestivals(userId);
        formattedFestivals = ownerFestivals.map(f => ({
          event_id: f.event_id,
          festival_id: f.festival_id,
          name: f.event_name,
          banner: f.festival_banner ? `${authPrefix}/images/film-festivals/${f.festival_banner}` : null,
          logo: f.festival_logo ? `${authPrefix}/images/film-festivals/${f.festival_logo}` : null,
          roles: ['admin', 'registration', 'checkin']
        }));
      } else {
        const volunteerFestivals = await Event.getVolunteerFestivals(userId);
        formattedFestivals = volunteerFestivals.map(f => {
          let parsedRoles = [];
          if (f.roles) {
            if (typeof f.roles === 'string') {
              try { parsedRoles = JSON.parse(f.roles); } catch (e) { parsedRoles = [f.roles]; }
            } else if (Array.isArray(f.roles)) {
              parsedRoles = f.roles;
            }
          }
          return {
            event_id: f.event_id,
            festival_id: f.festival_id,
            name: f.event_name,
            banner: f.festival_banner ? `${authPrefix}/images/film-festivals/${f.festival_banner}` : null,
            logo: f.festival_logo ? `${authPrefix}/images/film-festivals/${f.festival_logo}` : null,
            roles: parsedRoles
          };
        });
      }

      return res.json({
        success: true,
        message: 'Profile details fetched successfully',
        data: {
          user_id: userWithProfile.id,
          accountType: userWithProfile.account_type,
          name: profile ? profile.name : null,
          username: profile ? profile.username : null,
          profile_pic: profile ? profile.profile_pic : null,
          thumbnail_pic: profile ? profile.thumbnail_pic : null,
          email: userWithProfile.email,
          user_is: isOwner ? 'owner' : 'volunteer',
          festivals: formattedFestivals
        }
      });
    } catch (error) {
      console.error('getMe error:', error.message);
      return res.status(500).json({
        success: false,
        message: 'An internal error occurred while fetching user details.'
      });
    }
  }

  /**
   * POST /api/auth/logout
   */
  static async logout(req, res) {
    try {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        const exp = req.user ? req.user.exp : null;
        await revokeToken(token, exp);
      }

      res.clearCookie('token');
      res.clearCookie('authorization');

      return res.json({
        success: true,
        message: 'Logged out successfully'
      });
    } catch (error) {
      console.error('Logout error: ', error.message);
      return res.status(500).json({
        success: false,
        message: 'An internal error occurred during logout.'
      });
    }
  }
}

module.exports = AuthController;
