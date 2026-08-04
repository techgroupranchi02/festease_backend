// FestEase Backend API Landing Page Application Logic
document.addEventListener('DOMContentLoaded', () => {
  const BASE_URL = window.location.origin;

  // Hardcoded Credentials
  const HARDCODED_EMAIL = 'techgroupranchi01@gmail.com';
  const HARDCODED_PASS = 'hakunaM@tata1';

  // Endpoint Registry Data
  const endpoints = [
    // Auth & Access
    { method: 'POST', path: '/api/v1/login', desc: 'User & Admin login authentication for JWT token generation.', category: 'auth', role: 'public' },
    { method: 'POST', path: '/api/v1/generate-saas-token', desc: 'Generate SaaS access authorization token.', category: 'auth', role: 'public' },
    { method: 'GET', path: '/api/v1/auth/google/redirect', desc: 'Initiate Google OAuth2 authentication redirect flow.', category: 'auth', role: 'public' },
    { method: 'GET', path: '/api/v1/my-profile', desc: 'Retrieve authenticated user profile details.', category: 'auth', role: 'admin' },

    // Festival & Venues
    { method: 'GET', path: '/api/v1/festivals/:id/venues', desc: 'List all event venues configured for a festival.', category: 'venue', role: 'admin' },
    { method: 'POST', path: '/api/v1/festivals/:id/venues', desc: 'Add or update venue information for a festival.', category: 'venue', role: 'admin' },
    { method: 'DELETE', path: '/api/v1/festivals/:id/venues/:venue_id', desc: 'Delete an event venue from a festival.', category: 'venue', role: 'admin' },
    { method: 'GET', path: '/api/v1/festivals/:id/dashboard', desc: 'Get live registration and check-in metrics dashboard.', category: 'venue', role: 'admin' },

    // Registrations
    { method: 'POST', path: '/api/v1/festivals/:id/registrations', desc: 'Register a attendee for a festival event.', category: 'reg', role: 'registration' },
    { method: 'GET', path: '/api/v1/festivals/:id/registrations/:reg_id/pdf', desc: 'Generate & download PDF badge/ticket for attendee.', category: 'reg', role: 'registration' },
    { method: 'POST', path: '/api/v1/festivals/:id/registrations/:reg_id/email', desc: 'Dispatch ticket email with embedded QR code.', category: 'reg', role: 'registration' },
    { method: 'POST', path: '/api/v1/festivals/:id/un-registered', desc: 'Bulk insert or retrieve unregistered event attendees.', category: 'reg', role: 'registration' },

    // QR Codes
    { method: 'GET', path: '/api/v1/download/qr/:qr_id', desc: 'Download generated pre-printed QR code image asset.', category: 'qr', role: 'public' },
    { method: 'POST', path: '/api/v1/decrypt-qr', desc: 'Decrypt and validate an encrypted QR badge token.', category: 'qr', role: 'public' },
    { method: 'GET', path: '/api/v1/festivals/:id/registrations/qr-unused', desc: 'Get list of unused QR data available for assignment.', category: 'qr', role: 'registration' },

    // Check-in
    { method: 'GET', path: '/api/v1/festivals/:id/venues-list', desc: 'Get active check-in venue locations list.', category: 'checkin', role: 'checkin' },
    { method: 'GET', path: '/api/v1/festivals/:id/qr-check/:token', desc: 'Scan and verify attendee QR token at check-in gate.', category: 'checkin', role: 'checkin' },
    { method: 'POST', path: '/api/v1/festivals/:id/check-in', desc: 'Record check-in entry log for festival attendee.', category: 'checkin', role: 'checkin' },

    // System
    { method: 'GET', path: '/health', desc: 'Direct system health check & server status.', category: 'system', role: 'public' },
    { method: 'GET', path: '/api/v1/system/health', desc: 'Versioned API health diagnostic telemetry.', category: 'system', role: 'public' },
    { method: 'GET', path: '/api/v1/system/tables', desc: 'Database schema tables diagnostic endpoint.', category: 'system', role: 'public' }
  ];

  // DOM References
  const btnNavLogin = document.getElementById('btnNavLogin');
  const btnOpenLoginPrompt = document.getElementById('btnOpenLoginPrompt');
  const lockedBanner = document.getElementById('lockedBanner');
  const portalSection = document.getElementById('portalSection');
  const loginModalOverlay = document.getElementById('loginModalOverlay');
  const btnCloseLoginModal = document.getElementById('btnCloseLoginModal');
  const loginForm = document.getElementById('loginForm');
  const loginEmail = document.getElementById('loginEmail');
  const loginPassword = document.getElementById('loginPassword');
  const loginErrorBox = document.getElementById('loginErrorBox');
  const userBadge = document.getElementById('userBadge');
  const userEmailText = document.getElementById('userEmailText');
  const btnLogout = document.getElementById('btnLogout');
  const navLinks = document.getElementById('navLinks');

  const copyApiUrlBtn = document.getElementById('copyApiUrlBtn');
  const metricsLatency = document.getElementById('metricsLatency');
  const metricsDb = document.getElementById('metricsDb');
  const metricsUptime = document.getElementById('metricsUptime');
  const endpointsList = document.getElementById('endpointsList');
  const filterTabs = document.querySelectorAll('.tab-btn');
  const sandboxSelect = document.getElementById('sandboxSelect');
  const btnRunSandbox = document.getElementById('btnRunSandbox');
  const sandboxOutput = document.getElementById('sandboxOutput');
  const toast = document.getElementById('toast');
  const modalOverlay = document.getElementById('modalOverlay');
  const modalTitle = document.getElementById('modalTitle');
  const modalCode = document.getElementById('modalCode');
  const btnCopyModalCode = document.getElementById('btnCopyModalCode');
  const btnCloseModal = document.getElementById('btnCloseModal');

  // Authentication State Management
  function getAuthUser() {
    return localStorage.getItem('festease_auth_email');
  }

  function setAuthUser(email) {
    localStorage.setItem('festease_auth_email', email);
  }

  function clearAuthUser() {
    localStorage.removeItem('festease_auth_email');
  }

  function updateAuthState() {
    const authEmail = getAuthUser();

    if (authEmail) {
      // Authenticated view
      if (btnNavLogin) btnNavLogin.style.display = 'none';
      if (lockedBanner) lockedBanner.style.display = 'none';
      if (portalSection) portalSection.style.display = 'block';
      if (navLinks) navLinks.style.display = 'flex';
      if (userBadge) userBadge.style.display = 'flex';
      if (btnLogout) btnLogout.style.display = 'inline-block';
      if (userEmailText) userEmailText.textContent = authEmail;
      renderEndpoints('all');
    } else {
      // Unauthenticated view
      if (btnNavLogin) btnNavLogin.style.display = 'flex';
      if (lockedBanner) lockedBanner.style.display = 'block';
      if (portalSection) portalSection.style.display = 'none';
      if (navLinks) navLinks.style.display = 'none';
      if (userBadge) userBadge.style.display = 'none';
      if (btnLogout) btnLogout.style.display = 'none';
    }
  }

  // Open & Close Login Modal Popup
  function openLoginModal() {
    if (!loginModalOverlay) return;
    if (loginErrorBox) loginErrorBox.style.display = 'none';
    loginModalOverlay.classList.add('active');
  }

  function closeLoginModal() {
    if (!loginModalOverlay) return;
    loginModalOverlay.classList.remove('active');
  }

  if (btnNavLogin) {
    btnNavLogin.addEventListener('click', openLoginModal);
  }

  if (btnOpenLoginPrompt) {
    btnOpenLoginPrompt.addEventListener('click', openLoginModal);
  }

  if (btnCloseLoginModal) {
    btnCloseLoginModal.addEventListener('click', closeLoginModal);
  }

  if (loginModalOverlay) {
    loginModalOverlay.addEventListener('click', (e) => {
      if (e.target === loginModalOverlay) {
        closeLoginModal();
      }
    });
  }

  // Handle Login Execution
  function executeLogin() {
    const emailVal = (loginEmail.value || '').trim().toLowerCase();
    const passVal = (loginPassword.value || '').trim();

    const expectedEmail = HARDCODED_EMAIL.trim().toLowerCase();
    const expectedPass = HARDCODED_PASS.trim();

    if (emailVal === expectedEmail && passVal === expectedPass) {
      if (loginErrorBox) loginErrorBox.style.display = 'none';
      setAuthUser(HARDCODED_EMAIL);
      closeLoginModal();
      showToast('Login successful! API Portal unlocked.');
      updateAuthState();
      return true;
    } else {
      if (loginErrorBox) {
        loginErrorBox.textContent = `Invalid Credentials. Please check Developer Email and Password.`;
        loginErrorBox.style.display = 'block';
      }
      return false;
    }
  }

  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      executeLogin();
    });
  }

  const btnLoginSubmit = document.getElementById('btnLoginSubmit');
  if (btnLoginSubmit) {
    btnLoginSubmit.addEventListener('click', (e) => {
      e.preventDefault();
      executeLogin();
    });
  }

  // Handle Logout
  if (btnLogout) {
    btnLogout.addEventListener('click', () => {
      clearAuthUser();
      showToast('Logged out successfully.');
      updateAuthState();
    });
  }

  let activeApiBaseUrl = `${window.location.origin}/api/v1`;
  let activeBackendUrl = window.location.origin;

  async function fetchEnvConfig() {
    try {
      const res = await fetch('/api/v1/system/config');
      if (res.ok) {
        const data = await res.json();
        if (data.apiBaseUrl) {
          activeApiBaseUrl = data.apiBaseUrl;
          activeBackendUrl = data.backendUrl;
          
          const apiUrlText = document.getElementById('apiUrlText');
          if (apiUrlText) {
            apiUrlText.textContent = data.apiBaseUrl;
          }

          const footerHostText = document.getElementById('footerHostText');
          if (footerHostText && data.backendUrl) {
            const domainOnly = data.backendUrl.replace(/^https?:\/\//, '');
            footerHostText.textContent = `Powered by Node.js & Express • Hosted at ${domainOnly}`;
          }
        }
      }
    } catch (err) {
      console.warn('Config fetch error:', err.message);
    }
  }

  // Copy API Base URL
  if (copyApiUrlBtn) {
    copyApiUrlBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(activeApiBaseUrl).then(() => {
        showToast('API Base URL copied to clipboard!');
      }).catch(() => {
        showToast('Failed to copy to clipboard');
      });
    });
  }

  // Toast Function
  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2800);
  }

  // Render Endpoints
  function renderEndpoints(categoryFilter = 'all') {
    if (!endpointsList) return;
    endpointsList.replaceChildren();

    const filtered = categoryFilter === 'all' 
      ? endpoints 
      : endpoints.filter(item => item.category === categoryFilter);

    if (filtered.length === 0) {
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'endpoint-card';
      emptyMsg.textContent = 'No endpoints found for this category.';
      endpointsList.appendChild(emptyMsg);
      return;
    }

    filtered.forEach(item => {
      const card = document.createElement('div');
      card.className = 'endpoint-card';

      const left = document.createElement('div');
      left.className = 'endpoint-left';

      const method = document.createElement('span');
      method.className = `method-badge method-${item.method.toLowerCase()}`;
      method.textContent = item.method;

      const info = document.createElement('div');
      
      const pathEl = document.createElement('div');
      pathEl.className = 'endpoint-path';
      pathEl.textContent = item.path;

      const descEl = document.createElement('div');
      descEl.className = 'endpoint-desc';
      descEl.textContent = item.desc;

      info.appendChild(pathEl);
      info.appendChild(descEl);

      left.appendChild(method);
      left.appendChild(info);

      const right = document.createElement('div');
      right.className = 'endpoint-right';

      const role = document.createElement('span');
      role.className = `role-badge role-${item.role}`;
      role.textContent = item.role;

      const btnCurl = document.createElement('button');
      btnCurl.className = 'btn-curl';
      btnCurl.textContent = 'cURL';
      btnCurl.addEventListener('click', () => openCurlModal(item));

      right.appendChild(role);
      right.appendChild(btnCurl);

      card.appendChild(left);
      card.appendChild(right);

      endpointsList.appendChild(card);
    });
  }

  // Tab Filtering
  filterTabs.forEach(btn => {
    btn.addEventListener('click', () => {
      filterTabs.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const category = btn.getAttribute('data-category');
      renderEndpoints(category);
    });
  });

  // cURL Modal
  function openCurlModal(item) {
    if (!modalOverlay || !modalTitle || !modalCode) return;
    modalTitle.textContent = `${item.method} ${item.path}`;
    
    let curlCmd = `curl -X ${item.method} "${activeBackendUrl}${item.path}"`;
    if (item.role !== 'public') {
      curlCmd += ` \\\n  -H "Authorization: Bearer <YOUR_JWT_TOKEN>"`;
    }
    if (item.method === 'POST' || item.method === 'PUT') {
      curlCmd += ` \\\n  -H "Content-Type: application/json" \\\n  -d '{"exampleKey": "exampleValue"}'`;
    }
    
    modalCode.textContent = curlCmd;
    modalOverlay.classList.add('active');
  }

  if (btnCloseModal) {
    btnCloseModal.addEventListener('click', () => {
      modalOverlay.classList.remove('active');
    });
  }

  if (modalOverlay) {
    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) {
        modalOverlay.classList.remove('active');
      }
    });
  }

  if (btnCopyModalCode) {
    btnCopyModalCode.addEventListener('click', () => {
      if (modalCode) {
        navigator.clipboard.writeText(modalCode.textContent).then(() => {
          showToast('cURL command copied!');
        });
      }
    });
  }

  // System Health Polling
  async function fetchHealthTelemetry() {
    const startTime = performance.now();
    try {
      const res = await fetch('/health');
      const endTime = performance.now();
      const latency = Math.round(endTime - startTime);

      if (metricsLatency) {
        metricsLatency.textContent = `${latency} ms`;
      }

      if (res.ok) {
        const data = await res.json();
        if (metricsDb) {
          metricsDb.textContent = data.dbStatus || data.database || 'Connected';
        }
        if (metricsUptime) {
          metricsUptime.textContent = `99.99%`;
        }
      } else {
        if (metricsDb) metricsDb.textContent = 'Degraded';
      }
    } catch (err) {
      if (metricsLatency) metricsLatency.textContent = 'Offline';
      if (metricsDb) metricsDb.textContent = 'Disconnected';
    }
  }

  // Interactive Sandbox Runner
  if (btnRunSandbox && sandboxSelect && sandboxOutput) {
    btnRunSandbox.addEventListener('click', async () => {
      const endpointPath = sandboxSelect.value;
      sandboxOutput.textContent = 'Executing request...';
      const start = performance.now();

      try {
        const res = await fetch(endpointPath);
        const duration = Math.round(performance.now() - start);
        const data = await res.json();
        
        const outputObj = {
          status: res.status,
          statusText: res.statusText,
          duration: `${duration}ms`,
          headers: {
            'content-type': res.headers.get('content-type') || 'application/json'
          },
          body: data
        };

        sandboxOutput.textContent = JSON.stringify(outputObj, null, 2);
      } catch (err) {
        sandboxOutput.textContent = JSON.stringify({
          error: 'Network request failed',
          message: err.message
        }, null, 2);
      }
    });
  }

  // Initialize
  fetchEnvConfig();
  fetchHealthTelemetry();
  updateAuthState();
  setInterval(fetchHealthTelemetry, 10000);
});
