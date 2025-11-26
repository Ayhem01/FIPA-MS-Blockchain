const express = require('express');
const router = express.Router();
const web3Service = require('../services/web3Service');

// API key security (non-GET)
router.use((req, res, next) => {
  if (req.method === 'GET') return next();
  const expected = process.env.API_KEY;
  if (!expected) return next();
  const provided = req.headers['x-api-key'] || req.query.apiKey;
  if (provided !== expected) {
    return res.status(401).json({ success: false, error: 'Unauthorized: invalid API key' });
  }
  next();
});

// Helpers
const toUint = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
};

function mapProjetStatus(input) {
  if (input === undefined || input === null) return null;
  
  // Convertir en string et normaliser
  const normalized = String(input).trim().toLowerCase().replace(/[-_\s]/g, '');
  
  // Mapping exhaustif
  const mapping = {
    // Format Laravel (snake_case)
    'planned': 0,
    'inprogress': 1,
    'completed': 2,
    'abandoned': 3,
    'suspended': 4,
    'onhold': 5,
    
    // Variantes françaises
    'planifie': 0,
    'planifié': 0,
    'encours': 1,
    'termine': 2,
    'terminé': 2,
    'abandonne': 3,
    'abandonné': 3,
    'suspendu': 4,
    'enattente': 5,
    
    // Valeurs numériques directes
    '0': 0,
    '1': 1,
    '2': 2,
    '3': 3,
    '4': 4,
    '5': 5
  };
  
  if (mapping.hasOwnProperty(normalized)) {
    return mapping[normalized];
  }
  
  console.warn(`⚠️ Statut projet inconnu: "${input}" (normalisé: "${normalized}")`);
  return null;
}

/**
 * Convertir enum vers string lisible (PascalCase pour Solidity)
 */
function projetStatusToString(n) {
  const statuses = {
    0: 'Planned',
    1: 'InProgress',
    2: 'Completed',
    3: 'Abandoned',
    4: 'Suspended',
    5: 'OnHold'
  };
  return statuses[Number(n)] || 'Unknown';
}

module.exports = {
  mapProjetStatus,
  projetStatusToString
};

async function ensureContractReady() {
  if (!web3Service.web3) await web3Service.initialize();
  await web3Service.loadContract();
  if (!web3Service.contract) throw new Error('Contract not loaded: set CONTRACT_ADDRESS');
}
async function getAccountFromPk(pkRaw) {
  const pk = (pkRaw || '').trim();
  const hex = pk.startsWith('0x') ? pk : `0x${pk}`;
  return web3Service.web3.eth.accounts.privateKeyToAccount(hex);
}
async function ensureOwnerAccount(account) {
  try {
    const owner = await web3Service.callMethod('owner', []);
    if (String(owner).toLowerCase() !== account.address.toLowerCase()) {
      throw new Error('Only contract owner can call this function');
    }
  } catch { /* ignore if owner() missing */ }
}
async function tryGetProjet(id) {
  try {
    const p = await web3Service.callMethod('projets', [id]);
    if (p && p.id && Number(p.id) > 0) return p;
  } catch {}
  return null;
}
async function tryGetInvestisseur(id) {
  try {
    const inv = await web3Service.callMethod('investisseurs', [id]);
    if (inv && inv.id && Number(inv.id) > 0) return inv;
  } catch {}
  return null;
}

// Index / diagnostics
router.get('/', (_req, res) => {
  res.json({
    success: true,
    route: 'projet',
    endpoints: [
      'POST   /api/projet',
      'GET    /api/projet/all',
      'GET    /api/projet/:projetId',
      'PUT    /api/projet/:projetId',
      'PUT    /api/projet/:projetId/status',
      'DELETE /api/projet/:projetId',
      'POST   /api/projet/convert-from-investisseur/:investisseurId'
    ]
  });
});

router.get('/all', async (_req, res) => {
  try {
    await ensureContractReady();
    const ids = await web3Service.callMethod('getAllProjets', []);
    const seen = new Set();
    const unique = [];
    for (const id of ids) {
      const k = String(id);
      if (!seen.has(k)) { seen.add(k); unique.push(id); }
    }
    const projets = [];
    for (const id of unique) {
      try {
        const p = await tryGetProjet(id);
        if (p) {
          projets.push({
            id: p.id?.toString?.() ?? String(id),
            company_name: p.company_name || '',
            market_target: p.market_target || '',
            investment_amount: p.investment_amount?.toString?.() ?? '0',
            jobs_expected: p.jobs_expected?.toString?.() ?? '0',
            industrial_zone: p.industrial_zone || '',
            investisseurId: p.investisseurId?.toString?.() ?? '0',
            status: p.status?.toString?.() ?? '0',
            statusLabel: projetStatusToString(p.status),
            createdAt: p.createdAt?.toString?.() ?? '',
            createdBy: p.createdBy || ''
          });
        }
      } catch (e) {
        console.error('Projet fetch error', String(id), e.message);
      }
    }
    projets.sort((a, b) => Number(a.id) - Number(b.id));
    res.json({ success: true, data: { count: projets.length, projets } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create projet (createProjet)
router.post('/', async (req, res) => {
  try {
    const {
      company_name,
      companyName,
      market_target,
      marketTarget,
      investment_amount,
      investmentAmount,
      jobs_expected,
      jobsExpected,
      industrial_zone,
      industrialZone,
      investisseur_id,
      investisseurId,
      status,
      statut,
      privateKey: pkIn
    } = req.body || {};

    const company = (company_name ?? companyName ?? '').toString();
    const market = (market_target ?? marketTarget ?? '').toString();
    const investAmt = toUint(investment_amount ?? investmentAmount);
    const jobs = toUint(jobs_expected ?? jobsExpected);
    const zone = (industrial_zone ?? industrialZone ?? '').toString();
    const invIdRaw = toUint(investisseur_id ?? investisseurId ?? 0);
    const st = mapProjetStatus(status ?? statut);
    const privateKey = (pkIn || process.env.DEPLOYER_PRIVATE_KEY || '').trim();

    if (!company) return res.status(400).json({ success: false, error: 'company_name requis' });
    if (!market) return res.status(400).json({ success: false, error: 'market_target requis' });
    if (investAmt === null) return res.status(400).json({ success: false, error: 'investment_amount invalide' });
    if (jobs === null) return res.status(400).json({ success: false, error: 'jobs_expected invalide' });
    if (!zone) return res.status(400).json({ success: false, error: 'industrial_zone requis' });
    if (st === null) return res.status(400).json({ success: false, error: 'status projet invalide' });
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey requis' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    // Optional: verify investisseur if provided
    if (invIdRaw && !(await tryGetInvestisseur(invIdRaw))) {
      return res.status(404).json({ success: false, error: 'Investisseur lié introuvable' });
    }

    // Simulation
    try {
      await web3Service.contract.methods
        .createProjet(company, market, investAmt, jobs, zone, invIdRaw, st)
        .call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.message || 'call failed'}` });
    }

    // Transaction
    const receipt = await web3Service.sendTransaction(
      'createProjet',
      [company, market, investAmt, jobs, zone, invIdRaw, st],
      null,
      privateKey
    );

    let projetId = receipt.events?.ProjetCreated?.returnValues?.id
      ? receipt.events.ProjetCreated.returnValues.id.toString()
      : receipt.events?.ProjetCreated?.returnValues?.['0']
        ? receipt.events.ProjetCreated.returnValues['0'].toString()
        : null;

    res.json({
      success: true,
      data: {
        projetId,
        investisseurId: String(invIdRaw),
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber),
        gasUsed: receipt.gasUsed
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});



// Update projet (updateProjet)
router.put('/:projetId', async (req, res) => {
  try {
    const idNum = toUint(req.params.projetId);
    if (idNum === null) return res.status(400).json({ success: false, error: 'projetId invalide' });

    const {
      company_name,
      companyName,
      market_target,
      marketTarget,
      investment_amount,
      investmentAmount,
      jobs_expected,
      jobsExpected,
      industrial_zone,
      industrialZone,
      status,
      statut,
      privateKey: pkIn
    } = req.body || {};

    const privateKey = (pkIn || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey requis' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    const current = await tryGetProjet(idNum);
    if (!current) return res.status(404).json({ success: false, error: 'Projet introuvable' });

    const company = (company_name ?? companyName ?? current.company_name ?? '').toString();
    const market = (market_target ?? marketTarget ?? current.market_target ?? '').toString();
    const investAmtRaw = investment_amount ?? investmentAmount ?? current.investment_amount;
    const investAmt = toUint(investAmtRaw);
    const jobsRaw = jobs_expected ?? jobsExpected ?? current.jobs_expected;
    const jobs = toUint(jobsRaw);
    const zone = (industrial_zone ?? industrialZone ?? current.industrial_zone ?? '').toString();
    const st = statut !== undefined || status !== undefined
      ? mapProjetStatus(statut ?? status)
      : Number(current.status);

    if (!company) return res.status(400).json({ success: false, error: 'company_name requis' });
    if (!market) return res.status(400).json({ success: false, error: 'market_target requis' });
    if (investAmt === null) return res.status(400).json({ success: false, error: 'investment_amount invalide' });
    if (jobs === null) return res.status(400).json({ success: false, error: 'jobs_expected invalide' });
    if (!zone) return res.status(400).json({ success: false, error: 'industrial_zone requis' });
    if (st === null) return res.status(400).json({ success: false, error: 'status projet invalide' });

    // Simulation
    try {
      await web3Service.contract.methods
        .updateProjet(idNum, company, market, investAmt, jobs, zone, st)
        .call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.message || 'call failed'}` });
    }

    const receipt = await web3Service.sendTransaction(
      'updateProjet',
      [idNum, company, market, investAmt, jobs, zone, st],
      null,
      privateKey
    );

    res.json({
      success: true,
      data: {
        projetId: String(idNum),
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.put('/:projetId/status', async (req, res) => {
  try {
    const idNum = toUint(req.params.projetId);
    if (idNum === null) return res.status(400).json({ success: false, error: 'projetId invalide' });

    const { status, statut, privateKey: pkIn } = req.body || {};
    const st = mapProjetStatus(status ?? statut);
    const privateKey = (pkIn || process.env.DEPLOYER_PRIVATE_KEY || '').trim();

    if (st === null) return res.status(400).json({ success: false, error: 'status projet invalide (Planned|InProgress|Completed|Abandoned|Suspended|OnHold ou 0..5)' });
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey requis' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    const current = await tryGetProjet(idNum);
    if (!current) return res.status(404).json({ success: false, error: 'Projet introuvable' });

    // Simulation
    try {
      await web3Service.contract.methods
        .updateProjetStatus(idNum, st)
        .call({ from: account.address });
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: `Revert (simulation): ${e?.data?.reason || e?.message || 'call failed'}`
      });
    }

    // Transaction
    const receipt = await web3Service.sendTransaction(
      'updateProjetStatus',
      [idNum, st],
      null,
      privateKey
    );

    // Event (optionnel)
    let eventStatus;
    if (receipt.events?.ProjetStatusUpdated?.returnValues?.status) {
      eventStatus = receipt.events.ProjetStatusUpdated.returnValues.status.toString();
    } else if (receipt.events?.ProjetStatusUpdated?.returnValues?.['1']) {
      eventStatus = receipt.events.ProjetStatusUpdated.returnValues['1'].toString();
    }

    res.json({
      success: true,
      data: {
        projetId: String(idNum),
        status: eventStatus || st.toString(),
        statusLabel: projetStatusToString(eventStatus || st),
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete projet (deleteProjet)
router.delete('/:projetId', async (req, res) => {
  try {
    const idNum = toUint(req.params.projetId);
    const privateKey = (req.body?.privateKey || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
    if (idNum === null) return res.status(400).json({ success: false, error: 'projetId invalide' });
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey requis' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    const current = await tryGetProjet(idNum);
    if (!current) return res.status(404).json({ success: false, error: 'Projet introuvable' });

    try {
      await web3Service.contract.methods.deleteProjet(idNum).call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.message || 'call failed'}` });
    }

    const receipt = await web3Service.sendTransaction('deleteProjet', [idNum], null, privateKey);

    res.json({
      success: true,
      data: {
        projetId: String(idNum),
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get one projet
router.get('/:projetId', async (req, res) => {
  try {
    const idNum = toUint(req.params.projetId);
    if (idNum === null) return res.status(400).json({ success: false, error: 'projetId invalide' });

    await ensureContractReady();
    const p = await tryGetProjet(idNum);
    if (!p) return res.status(404).json({ success: false, error: 'Projet introuvable' });

    res.json({
      success: true,
      data: {
        id: p.id?.toString?.() ?? String(idNum),
        company_name: p.company_name || '',
        market_target: p.market_target || '',
        investment_amount: p.investment_amount?.toString?.() ?? '0',
        jobs_expected: p.jobs_expected?.toString?.() ?? '0',
        industrial_zone: p.industrial_zone || '',
        investisseurId: p.investisseurId?.toString?.() ?? '0',
        status: p.status?.toString?.() ?? '0',
        statusLabel: projetStatusToString(p.status),
        createdAt: p.createdAt?.toString?.() ?? '',
        createdBy: p.createdBy || ''
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});



module.exports = router;