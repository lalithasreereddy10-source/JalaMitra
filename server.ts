import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFile } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import {
  initAuthDatabase,
  getUserByEmail,
  getUserById,
  getAllUsers,
  createUser,
  updateUser,
  updateUserPassword,
  verifyPassword,
  createSession,
  validateSession,
  destroySession,
  createPasswordResetToken,
  verifyAndConsumeResetToken,
  toPublicProfile,
  UserRole,
} from './server_auth.js';

dotenv.config();

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize secure file-based persistent authentication database with baseline roles
initAuthDatabase();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

// Helper: Parse cookie header
function parseCookies(req: express.Request): Record<string, string> {
  const list: Record<string, string> = {};
  const rc = req.headers.cookie;
  if (!rc) return list;
  rc.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      list[parts[0].trim()] = decodeURIComponent(parts.slice(1).join('=').trim());
    }
  });
  return list;
}

// Authentication & Session Extraction Middleware
function getSessionFromReq(req: express.Request) {
  const cookies = parseCookies(req);
  const cookieSession = cookies['jm_session'];
  const authHeader = req.headers.authorization;
  let bearerSession: string | undefined;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    bearerSession = authHeader.substring(7).trim();
  }
  const token = bearerSession || cookieSession;
  if (!token) return null;
  return validateSession(token);
}

// Authentication API Endpoints

// 1. Session status / Current User Profile
app.get('/api/auth/me', (req, res) => {
  const auth = getSessionFromReq(req);
  if (!auth) {
    return res.status(401).json({ authenticated: false, error: 'Not authenticated' });
  }
  return res.json({
    authenticated: true,
    user: toPublicProfile(auth.user),
    role: auth.user.role,
  });
});

// 2. User Login
app.post('/api/auth/login', (req, res) => {
  const { email, password, rememberMe = false } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email address and password are required.' });
  }

  const user = getUserByEmail(email);
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const isValid = verifyPassword(password, user.passwordHash);
  if (!isValid) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const sessionId = createSession(user.id, user.role, !!rememberMe);
  const maxAge = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

  // Secure HttpOnly Cookie
  res.cookie('jm_session', sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge,
    path: '/',
  });

  return res.json({
    success: true,
    message: 'Login successful.',
    token: sessionId, // Returned for environments where cross-origin cookies may be blocked
    user: toPublicProfile(user),
  });
});

// 3. User Registration
app.post('/api/auth/register', (req, res) => {
  const { fullName, email, password, confirmPassword, role, agreeTerms, adminSecretKey } = req.body;

  if (!fullName || !fullName.trim()) {
    return res.status(400).json({ error: 'Full name is required.' });
  }
  if (!email || !email.trim() || !email.includes('@')) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }
  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
  }
  if (password !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }
  if (!agreeTerms) {
    return res.status(400).json({ error: 'You must agree to the Terms and Conditions.' });
  }

  const validRoles: UserRole[] = ['Farmer', 'Water Resource Officer', 'Researcher', 'Administrator'];
  if (!validRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid user role selected.' });
  }

  // Enforce backend restriction: Administrator role cannot be self-registered without secret approval key
  if (role === 'Administrator') {
    const expectedSecret = process.env.ADMIN_REGISTRATION_SECRET || 'JalaMitra@APWRD2026';
    if (!adminSecretKey || adminSecretKey !== expectedSecret) {
      return res.status(403).json({
        error: 'Administrator accounts require institutional approval. Please provide a valid Administrator Secret Key or choose a standard role.',
      });
    }
  }

  const result = createUser({
    fullName,
    email,
    password,
    role,
    isApprovedAdmin: role === 'Administrator',
  });

  if (result.error || !result.user) {
    return res.status(409).json({ error: result.error || 'Failed to create user account.' });
  }

  // Create session for instant login
  const sessionId = createSession(result.user.id, result.user.role, false);
  res.cookie('jm_session', sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
    path: '/',
  });

  return res.status(201).json({
    success: true,
    message: 'Account created successfully.',
    token: sessionId,
    user: toPublicProfile(result.user),
  });
});

// 4. User Logout
app.post('/api/auth/logout', (req, res) => {
  const cookies = parseCookies(req);
  const sessionId = cookies['jm_session'] || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.substring(7).trim() : '');
  if (sessionId) {
    destroySession(sessionId);
  }
  res.clearCookie('jm_session', { path: '/' });
  return res.json({ success: true, message: 'Logged out successfully.' });
});

// 5. Password Reset Request (Forgot Password)
app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email address is required.' });
  }

  const user = getUserByEmail(email);
  if (!user) {
    // Avoid user enumeration
    return res.json({
      success: true,
      message: 'If the email exists in our records, a secure reset link has been dispatched.',
    });
  }

  const resetToken = createPasswordResetToken(user.id);

  // In production this sends an email; in demo/dev mode we return the token and instructions
  return res.json({
    success: true,
    message: 'Reset token generated successfully. Valid for 60 minutes.',
    resetToken, // For instant local demo testing
  });
});

// 6. Complete Password Reset
app.post('/api/auth/reset-password', (req, res) => {
  const { token, newPassword, confirmPassword } = req.body;
  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Token and new password are required.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters long.' });
  }
  if (newPassword !== confirmPassword) {
    return res.status(400).json({ error: 'Passwords do not match.' });
  }

  const userId = verifyAndConsumeResetToken(token);
  if (!userId) {
    return res.status(400).json({ error: 'Invalid or expired password reset token.' });
  }

  const updated = updateUserPassword(userId, newPassword);
  if (!updated) {
    return res.status(500).json({ error: 'Failed to update password.' });
  }

  return res.json({ success: true, message: 'Password has been updated. You can now log in.' });
});

// 7. Update User Profile
app.put('/api/auth/profile', (req, res) => {
  const auth = getSessionFromReq(req);
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  const { fullName, phone, organization, district, commandArea } = req.body;
  const updatedUser = updateUser(auth.user.id, {
    fullName: fullName?.trim() || auth.user.fullName,
    phone: phone?.trim() || auth.user.phone,
    organization: organization?.trim() || auth.user.organization,
    district: district?.trim() || auth.user.district,
    commandArea: commandArea?.trim() || auth.user.commandArea,
  });

  if (!updatedUser) {
    return res.status(500).json({ error: 'Failed to update user profile.' });
  }

  return res.json({
    success: true,
    user: toPublicProfile(updatedUser),
  });
});

// 8. Admin Only: List Users
app.get('/api/admin/users', (req, res) => {
  const auth = getSessionFromReq(req);
  if (!auth) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }
  if (auth.user.role !== 'Administrator') {
    return res.status(403).json({ error: 'Forbidden. Administrator privileges required.' });
  }

  const allUsers = getAllUsers().map(toPublicProfile);
  return res.json({
    users: allUsers,
    total: allUsers.length,
  });
});


// Qiskit Quantum Optimization Backend Endpoints
app.get('/api/quantum/status', async (_req, res) => {
  try {
    const pythonScript = path.resolve(__dirname, 'qiskit_qaoa_water_allocator.py');
    const { stdout } = await execFileAsync('python3', [
      pythonScript,
      '--json',
      '--supply',
      '460',
      '--reps',
      '1',
      '--maxiter',
      '2',
    ]);
    const parsed = JSON.parse(stdout.trim());
    return res.json({
      success: true,
      qiskitAvailable: parsed.qiskit_available ?? true,
      qiskitVersion: parsed.qiskit_version ?? '2.5.2',
      backendName: parsed.qaoa?.backend_name ?? 'Qiskit Aer Simulator (StatevectorSampler)',
      hardwareDistinctionNote: parsed.hardware_distinction_note,
      quantumSupremacyClaim: parsed.quantum_supremacy_claim,
    });
  } catch (error: any) {
    console.warn('Qiskit status probe notice:', error?.message);
    return res.json({
      success: false,
      qiskitAvailable: false,
      error: error?.message || 'Qiskit environment probe failed',
    });
  }
});

app.post('/api/quantum/solve', async (req, res) => {
  const startTime = Date.now();
  try {
    const { supplyLimitMCM = 460, reps = 2, maxiter = 25 } = req.body;
    const rawSupply = typeof supplyLimitMCM === 'number' ? supplyLimitMCM : parseFloat(supplyLimitMCM);
    const sanitizedSupply = isNaN(rawSupply) ? 460 : Math.max(0, Math.min(1000, rawSupply));
    const sanitizedReps = Math.max(1, Math.min(3, Number(reps) || 2));
    const sanitizedMaxiter = Math.max(5, Math.min(40, Number(maxiter) || 25));

    const pythonScript = path.resolve(__dirname, 'qiskit_qaoa_water_allocator.py');
    const { stdout, stderr } = await execFileAsync('python3', [
      pythonScript,
      '--json',
      '--supply',
      String(sanitizedSupply),
      '--reps',
      String(sanitizedReps),
      '--maxiter',
      String(sanitizedMaxiter),
    ]);

    if (stderr && stderr.trim().length > 0) {
      console.info('Python stderr output:', stderr.trim());
    }

    const payload = JSON.parse(stdout.trim());
    const roundtripMs = Date.now() - startTime;

    return res.json({
      ...payload,
      serverRoundtripMs: roundtripMs,
    });
  } catch (err: any) {
    console.error('Error executing qiskit_qaoa_water_allocator.py:', err);
    return res.status(500).json({
      success: false,
      qiskit_available: false,
      error: err?.message || 'Failed to execute Qiskit QAOA backend script',
      hint: 'Verify python3 and Qiskit packages (qiskit, qiskit-optimization, qiskit-aer, scipy).',
    });
  }
});

// Server-side Gemini AI Advisor Endpoint
app.post('/api/advisor', async (req, res) => {
  try {
    const { question, context, language = 'English' } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    const apiKey = process.env.GEMINI_API_KEY;

    const systemPrompt = `You are "JalaMitra Advisor", an elite Senior Irrigation Engineer and Hydro-Quantum Systems Consultant for the Andhra Pradesh Water Resources Department, specializing in the Krishna-Godavari command areas.
Your objective is to provide actionable, mathematically sound, and hydrologically precise answers to irrigation officers, canal operators, and planners.
You should reply in the user's requested language: ${language} (if non-English, provide natural, fluent phrasing with technical terms clearly explained).

Key domain principles:
1. River Basins: Krishna and Godavari basins (Srisailam, Nagarjuna Sagar, Prakasam Barrage, Sir Arthur Cotton Barrage Dowleswaram, Polavaram).
2. Prioritization: High-priority food staples (Paddy, coastal salinity buffer) take precedence, while equitable sharing (Jain's Fairness Index) prevents catastrophic crop failure in tail-end uplands (Palnadu, Prakasam).
3. Optimization Concepts: You understand both classical constrained linear/quadratic allocation and QUBO/QAOA quantum formulation (mapping water tranches to Pauli-Z binary spin operators, penalty multipliers, and QAOA variational circuits).
4. Tone: Professional, authoritative, empathetic to farmers and canal operators, clear, and structured with bullet points.
5. Grounding: You MUST ground your explanation in the current active simulation figures provided in the context below.

Current Active Simulation Context:
Scenario: ${context?.scenario || 'Normal'}
Total Reservoir Available Water: ${context?.summary?.totalAvailableMCM ?? 'N/A'} MCM
Total Crop Water Demand: ${context?.summary?.totalDemandMCM ?? 'N/A'} MCM
Total Water Allocated: ${context?.summary?.totalAllocatedMCM ?? 'N/A'} MCM
Total Water Shortage: ${context?.summary?.totalShortageMCM ?? 'N/A'} MCM
Water Utilisation: ${context?.summary?.waterUtilisationPct ?? 'N/A'}%
Jain's Fairness Index: ${context?.summary?.jainsFairnessIndex ?? 'N/A'} (1.0 = perfect equity)

Active Zone Statuses:
${(context?.zones || []).map((z: any) => `- ${z.zoneName} (${z.cropType}): Demand ${z.demandMCM} MCM | Allocated ${z.allocatedMCM} MCM (${z.satisfactionPct}%) | Priority ${z.priority}/5 | Status: ${z.status}`).join('\n')}

Active Reservoir Storages:
${(context?.reservoirs || []).map((r: any) => `- ${r.reservoirName}: Available ${r.availableMCM} MCM | Released ${r.releasedMCM} MCM | Remaining ${r.remainingStorageMCM} MCM (Min Required: ${r.minStorageMCM} MCM)`).join('\n')}

Active Canal Bottlenecks:
${(context?.bottlenecks || []).join('\n') || 'No critical bottlenecks identified.'}
`;

    if (apiKey) {
      try {
        const ai = new GoogleGenAI({
          apiKey,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });

        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: question,
          config: {
            systemInstruction: systemPrompt,
          },
        });

        const text = response.text || 'No response generated.';
        return res.json({ text, isAiPowered: true });
      } catch (geminiError: any) {
        console.error('Gemini API call failed, falling back to expert engine:', geminiError?.message);
      }
    }

    // Fallback expert hydrological engine when API key is unconfigured or rate-limited
    const fallbackAnswer = generateExpertHydrologyResponse(question, context);
    return res.json({
      text: fallbackAnswer,
      isAiPowered: false,
      note: 'Generated via JalaMitra Built-in Hydrological Rule Engine (Gemini API offline or secret unconfigured).',
    });
  } catch (err: any) {
    console.error('Error in /api/advisor:', err);
    return res.status(500).json({ error: 'Internal server error while processing advisory request' });
  }
});

function generateExpertHydrologyResponse(question: string, context: any): string {
  const q = question.toLowerCase();
  const summary = context?.summary;
  const zones = context?.zones || [];
  const bottlenecks = context?.bottlenecks || [];

  if (q.includes('why') && (q.includes('less') || q.includes('shortage') || q.includes('paddy') || q.includes('cotton') || q.includes('chilli'))) {
    return `### Diagnostic Assessment: Water Allocation Hierarchy

Under the current **${context?.scenario || 'Active'}** scenario, water is rationed based on a constrained multi-tier optimization function:

1. **Priority Weighting**:
   - High-priority zones like **Krishna Delta Paddy** (Priority 5) and **Konaseema Buffer** (Priority 5) receive baseline protection to prevent crop desiccation and saline backwater intrusion into coastal aquifers.
   - Secondary cash crops like **Guntur Chilli** (Priority 4) or **Palnadu Millets** (Priority 2) receive partial tranches once fundamental safety floors are respected.

2. **Canal Constraints & Conveyance Losses**:
   - Each canal has physical flow limits ($K_c$) and transit evaporation/seepage losses ($1 - \\eta$). When canals reach $\\ge 90\\%$ carrying capacity, additional water cannot be physically delivered regardless of reservoir storage.

3. **Current Figures**:
   - Total System Demand: **${summary?.totalDemandMCM || 1600} MCM**
   - Total Deliverable Water: **${summary?.totalAllocatedMCM || 1400} MCM**
   - Resulting Deficit: **${summary?.totalShortageMCM || 200} MCM**

**Recommendation**: To boost allocation to affected crops, consider rotational canal scheduling (*Warabandi* system) or reducing conveyance losses through canal bed lining.`;
  }

  if (q.includes('inflow') || q.includes('30%') || q.includes('drop') || q.includes('drought')) {
    return `### Inflow Reduction Impact Analysis (30% Deficit)

A 30% reduction in inflows to the Krishna-Godavari reservoirs (Srisailam, Nagarjuna Sagar, Sir Arthur Cotton Barrage) triggers the following operational dynamics:

1. **Dead Storage Buffer**:
   - Srisailam must maintain at least 350 MCM and Nagarjuna Sagar at least 480 MCM for drinking water security and dam safety.
   - Active release potential shrinks non-linearly because fixed dead-storage reserves cannot be tapped.

2. **Impact on Crop Zones**:
   - **Severe Stress**: Low-priority zones like Palnadu Millets (Priority 2) and Rayalaseema Pulses (Priority 3) will face allocation drops of 35% to 45%.
   - **Protected Core**: Fine grain paddy and drinking supply are safeguarded at 60-70% requirement.

3. **Suggested Mitigation**:
   - Activate the Drought Scenario in the JalaMitra top bar to view exact recalibrated canal schedules.
   - Implement staggered sowing dates and alternate wetting and drying (AWD) for rice paddies.`;
  }

  if (q.includes('qubo') || q.includes('qaoa') || q.includes('quantum')) {
    return `### Understanding QUBO & QAOA in JalaMitra

1. **What is QUBO?**
   - **Quadratic Unconstrained Binary Optimisation (QUBO)** maps discrete water allocation decisions (e.g., allocating 0%, 50%, or 100% of water demand to a canal) into binary variables $b_i \\in \\{0, 1\\}$.
   - The objective rewards water satisfaction and penalizes exceeding dam supplies or creating unfair disparities using quadratic penalty multipliers ($P_{\\text{supply}} \\cdot (\\sum V_i b_i - W_{\\text{avail}})^2$).

2. **What is QAOA?**
   - **Quantum Approximate Optimisation Algorithm (QAOA)** is a hybrid quantum-classical algorithm that prepares a quantum superposition of all allocation states.
   - It alternates between applying a problem Hamiltonian (encoding water constraints) and a mixer Hamiltonian, tuning angle parameters $(\\vec{\\gamma}, \\vec{\\beta})$ to steer probability toward the lowest-energy (optimal) allocation plan.

3. **NISQ Perspective**:
   - Today's quantum processors evaluate small instances to validate the mapping. Quantum advantage is not yet claimed, but QUBO provides the mathematical bridge to future quantum co-processors for complex multi-river basins.`;
  }

  return `### Operational Overview for Krishna-Godavari Command Area

- **Active Scenario**: ${context?.scenario?.toUpperCase() || 'NORMAL'}
- **Current System Status**:
  - Available Inflow: **${summary?.totalAvailableMCM || 'N/A'} MCM**
  - Allocated Deliveries: **${summary?.totalAllocatedMCM || 'N/A'} MCM**
  - Unmet Demand (Shortage): **${summary?.totalShortageMCM || 'N/A'} MCM**
  - System Fairness (Jain's Index): **${summary?.jainsFairnessIndex || '0.94'}**

**Key Recommendations**:
1. Monitor canal reaches with high utilization to prevent breach risks during peak discharge.
2. In case of declining reservoir levels, utilize the **Quantum Lab** or **Scenario Selector** to review pre-computed equitable rationing policies.`;
}

// Development or Production handler
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: process.env.DISABLE_HMR !== 'true' },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`JalaMitra server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
