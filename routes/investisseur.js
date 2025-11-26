const express = require('express');
const router = express.Router();
const web3Service = require('../services/web3Service');

// Security: API key for non-GET requests
router.use((req, res, next) => {
  if (req.method === 'GET') return next();
  const expected = process.env.API_KEY;
  if (!expected) return next();
  const auth = (req.headers['authorization'] || '').toString();
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const provided = req.headers['x-api-key'] || bearer || req.query.apiKey;
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
async function ensureContractReady() {
  if (!web3Service.web3) await web3Service.initialize();
  if (!web3Service.contract) await web3Service.loadContract();
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
      const err = new Error('Only contract owner can call this function');
      err.details = { contractOwner: owner, sender: account.address };
      throw err;
    }
  } catch { /* contract will enforce onlyOwner */ }
}
const mapInvestisseurStatus = (s) => {
  const v = String(s).toLowerCase();
  if (v === '0' || v === 'actif') return 0;
  if (v === '1' || v === 'negociation' || v === 'négociation') return 1;
  if (v === '2' || v === 'engagement') return 2;
  if (v === '3' || v === 'finalisation') return 3;
  if (v === '4' || v === 'investi') return 4;
  if (v === '5' || v === 'suspendu') return 5;
  if (v === '6' || v === 'inactif') return 6;
  return null;
};
const investisseurStatusLabel = (n) => {
  switch (Number(n)) {
    case 0: return 'Actif';
    case 1: return 'Negociation';
    case 2: return 'Engagement';
    case 3: return 'Finalisation';
    case 4: return 'Investi';
    case 5: return 'Suspendu';
    case 6: return 'Inactif';
    default: return 'Inconnu';
  }
};
const mapProjetStatus = (s) => {
  if (s === undefined || s === null) return null;
  
  // Convertir en string et normaliser (lowercase, sans espaces/tirets)
  const normalized = String(s).trim().toLowerCase().replace(/[-_\s]/g, '');
  
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
  
  // Recherche dans le mapping
  if (mapping.hasOwnProperty(normalized)) {
    return mapping[normalized];
  }
  
  console.warn(`⚠️ Statut projet inconnu: "${s}" (normalisé: "${normalized}")`);
  return null;
};

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

// Index
router.get('/', (_req, res) => {
  res.json({
    success: true,
    route: 'investisseur',
    endpoints: [
      'POST   /api/investisseur',
      'PUT    /api/investisseur/:investisseurId',
      'PUT    /api/investisseur/:investisseurId/status',
      'DELETE /api/investisseur/:investisseurId',
      'GET    /api/investisseur/:investisseurId',
      'GET    /api/investisseur/all',
      'POST   /api/investisseur/:investisseurId/convert-projet' 
    ]
  });
});

router.get('/all', async (_req, res) => {
  try {
    await ensureContractReady();
    const investisseurIds = await web3Service.callMethod('getAllInvestisseurs', []);
    const seen = new Set();
    const uniqueIds = [];
    for (const id of investisseurIds) {
      const k = String(id);
      if (!seen.has(k)) { seen.add(k); uniqueIds.push(id); }
    }
    const investisseurs = [];
    for (const id of uniqueIds) {
      try {
        const inv = await web3Service.callMethod('investisseurs', [id]);
        if (inv && Number(inv.id) > 0) {
          investisseurs.push({
            id: inv.id?.toString?.() ?? String(id),
            nom: inv.nom || '',
            prospect_id: inv.prospect_id?.toString?.() ?? '0',
            montant_investissement: inv.montant_investissement?.toString?.() ?? '0',
            interets_specifiques: inv.interets_specifiques || '',
            criteres_investissement: inv.criteres_investissement || '',
            status: inv.status?.toString?.() ?? '0',
            createdAt: inv.createdAt?.toString?.() ?? '',
            createdBy: inv.createdBy || ''
          });
        }
      } catch (e) {
        console.error('Fetch investisseur', String(id), e.message);
      }
    }
    investisseurs.sort((a, b) => Number(a.id) - Number(b.id));
    res.json({ success: true, data: { count: investisseurs.length, investisseurs } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create investisseur (NOUVELLE SIGNATURE)
router.post('/', async (req, res) => {
  try {
    const {
      nom = '',
      prospect_id = 0,
      montant_investissement,
      montant,
      interets_specifiques = '',
      criteres_investissement = '',
      statut = 'Actif',
      privateKey: pkIn
    } = req.body || {};

    const pid = toUint(prospect_id);
    const mont = toUint(montant_investissement !== undefined ? montant_investissement : montant);
    const st = mapInvestisseurStatus(statut);
    const interets = interets_specifiques || '';
    const criteres = criteres_investissement || '';
    const privateKey = (pkIn || process.env.DEPLOYER_PRIVATE_KEY || '').trim();

    if (!nom) return res.status(400).json({ success: false, error: 'nom requis' });
    if (pid === null) return res.status(400).json({ success: false, error: 'prospect_id invalide' });
    if (mont === null) return res.status(400).json({ success: false, error: 'montant_investissement invalide' });
    if (st === null) return res.status(400).json({ success: false, error: 'statut invalide' });
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey requis' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    // Simulation
    try {
      await web3Service.contract.methods
        .createInvestisseur(nom, pid, mont, interets, criteres, st)
        .call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.message || 'call failed'}` });
    }

    // Transaction
    const receipt = await web3Service.sendTransaction(
      'createInvestisseur',
      [nom, pid, mont, interets, criteres, st],
      null,
      privateKey
    );

    let investisseurId = receipt.events?.InvestisseurCreated?.returnValues?.id
      ? receipt.events.InvestisseurCreated.returnValues.id.toString()
      : receipt.events?.InvestisseurCreated?.returnValues?.['0']
        ? receipt.events.InvestisseurCreated.returnValues['0'].toString()
        : null;

    res.json({
      success: true,
      data: {
        investisseurId,
        prospect_id: String(pid),
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber),
        gasUsed: receipt.gasUsed
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, details: error.details || undefined });
  }
});

// Update investisseur (NOUVELLE SIGNATURE)
router.put('/:investisseurId', async (req, res) => {
  try {
    const idNum = toUint(req.params.investisseurId);
    if (idNum === null) return res.status(400).json({ success: false, error: 'investisseurId invalide' });

    const {
      nom,
      montant_investissement,
      montant,
      interets_specifiques,
      criteres_investissement,
      statut,
      privateKey: pkIn
    } = req.body || {};

    const privateKey = (pkIn || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey requis' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    const current = await web3Service.callMethod('investisseurs', [idNum]);
    if (!current || Number(current.id) === 0) {
      return res.status(404).json({ success: false, error: 'Investisseur introuvable' });
    }

    const newNom = (nom ?? current.nom ?? '').toString();
    const newMontRaw = montant_investissement !== undefined ? montant_investissement : montant !== undefined ? montant : current.montant_investissement;
    const newMont = toUint(newMontRaw);
    const newInterets = (interets_specifiques ?? current.interets_specifiques ?? '').toString();
    const newCriteres = (criteres_investissement ?? current.criteres_investissement ?? '').toString();
    const newStatus = statut !== undefined ? mapInvestisseurStatus(statut) : Number(current.status);

    if (!newNom) return res.status(400).json({ success: false, error: 'nom requis' });
    if (newMont === null) return res.status(400).json({ success: false, error: 'montant_investissement invalide' });
    if (newStatus === null || !Number.isFinite(newStatus)) {
      return res.status(400).json({ success: false, error: 'statut invalide' });
    }

    // Simulation
    try {
      await web3Service.contract.methods
        .updateInvestisseur(idNum, newNom, newMont, newInterets, newCriteres, newStatus)
        .call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.message || 'call failed'}` });
    }

    // Transaction
    const receipt = await web3Service.sendTransaction(
      'updateInvestisseur',
      [idNum, newNom, newMont, newInterets, newCriteres, newStatus],
      null,
      privateKey
    );

    res.json({
      success: true,
      data: {
        investisseurId: String(idNum),
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, details: error.details || undefined });
  }
});

router.put('/:investisseurId/status', async (req, res) => {
  try {
    const idNum = toUint(req.params.investisseurId);
    if (idNum === null) return res.status(400).json({ success: false, error: 'investisseurId invalide' });

    const { statut, status, privateKey: pkIn } = req.body || {};
    const stRaw = statut !== undefined ? statut : status;
    const st = mapInvestisseurStatus(stRaw);
    const privateKey = (pkIn || process.env.DEPLOYER_PRIVATE_KEY || '').trim();

    if (st === null) {
      return res.status(400).json({
        success: false,
        error: 'statut invalide (Actif|Negociation|Engagement|Finalisation|Investi|Suspendu|Inactif ou 0..6)'
      });
    }
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey requis' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    const current = await web3Service.callMethod('investisseurs', [idNum]);
    if (!current || Number(current.id) === 0) {
      return res.status(404).json({ success: false, error: 'Investisseur introuvable' });
    }

    // Simulation
    try {
      await web3Service.contract.methods
        .updateInvestisseurStatus(idNum, st)
        .call({ from: account.address });
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: `Revert (simulation): ${e?.data?.reason || e?.message || 'call failed'}`
      });
    }

    // Transaction
    const receipt = await web3Service.sendTransaction(
      'updateInvestisseurStatus',
      [idNum, st],
      null,
      privateKey
    );

    let newStatus = st;
    if (receipt.events?.InvestisseurStatusUpdated?.returnValues?.status) {
      newStatus = receipt.events.InvestisseurStatusUpdated.returnValues.status;
    } else if (receipt.events?.InvestisseurStatusUpdated?.returnValues?.['1']) {
      newStatus = receipt.events.InvestisseurStatusUpdated.returnValues['1'];
    }

    res.json({
      success: true,
      data: {
        investisseurId: String(idNum),
        status: String(newStatus),
        statusLabel: investisseurStatusLabel(newStatus),
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete investisseur (ADAPTÉ)
router.delete('/:investisseurId', async (req, res) => {
  try {
    const idNum = toUint(req.params.investisseurId);
    const privateKey = (req.body?.privateKey || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
    if (idNum === null) return res.status(400).json({ success: false, error: 'investisseurId invalide' });
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey requis' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    const current = await web3Service.callMethod('investisseurs', [idNum]);
    if (!current || Number(current.id) === 0) {
      return res.status(404).json({ success: false, error: 'Investisseur introuvable' });
    }

    // Simulation
    try {
      await web3Service.contract.methods.deleteInvestisseur(idNum).call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.message || 'call failed'}` });
    }

    const receipt = await web3Service.sendTransaction('deleteInvestisseur', [idNum], null, privateKey);

    res.json({
      success: true,
      data: {
        investisseurId: String(idNum),
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get investisseur (NOUVELLE STRUCT)
router.get('/:investisseurId', async (req, res) => {
  try {
    const idNum = toUint(req.params.investisseurId);
    if (idNum === null) return res.status(400).json({ success: false, error: 'investisseurId invalide' });

    await ensureContractReady();
    const inv = await web3Service.callMethod('investisseurs', [idNum]);
    if (!inv || Number(inv.id) === 0) return res.status(404).json({ success: false, error: 'Investisseur introuvable' });

    res.json({
      success: true,
      data: {
        id: inv.id?.toString?.() ?? String(idNum),
        nom: inv.nom || '',
        prospect_id: inv.prospect_id?.toString?.() ?? '0',
        montant_investissement: inv.montant_investissement?.toString?.() ?? '0',
        interets_specifiques: inv.interets_specifiques || '',
        criteres_investissement: inv.criteres_investissement || '',
        status: inv.status?.toString?.() ?? '0',
        createdAt: inv.createdAt?.toString?.() ?? '',
        createdBy: inv.createdBy || ''
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
router.post('/:investisseurId/convert-projet', async (req, res) => {
  try {
    const idNum = toUint(req.params.investisseurId);
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
      statut,
      status,
      privateKey: pkIn
    } = req.body || {};

    const company = (company_name ?? companyName ?? '').toString();
    const market = (market_target ?? marketTarget ?? '').toString();
    const investAmt = toUint(investment_amount ?? investmentAmount);
    const jobs = toUint(jobs_expected ?? jobsExpected);
    const zone = (industrial_zone ?? industrialZone ?? '').toString();
    const projStatus = mapProjetStatus(statut ?? status);
    const privateKey = (pkIn || process.env.DEPLOYER_PRIVATE_KEY || '').trim();

    if (idNum === null) return res.status(400).json({ success: false, error: 'investisseurId invalide' });
    if (!company) return res.status(400).json({ success: false, error: 'company_name requis' });
    if (!market) return res.status(400).json({ success: false, error: 'market_target requis' });
    if (investAmt === null) return res.status(400).json({ success: false, error: 'investment_amount invalide' });
    if (jobs === null) return res.status(400).json({ success: false, error: 'jobs_expected invalide' });
    if (!zone) return res.status(400).json({ success: false, error: 'industrial_zone requis' });
    if (projStatus === null) return res.status(400).json({ success: false, error: 'status/ statut projet invalide' });
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey requis' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    // Vérifier l’existence de l’investisseur
    const inv = await web3Service.callMethod('investisseurs', [idNum]);
    if (!inv || Number(inv.id) === 0) {
      return res.status(404).json({ success: false, error: 'Investisseur introuvable' });
    }

    // Simulation
    try {
      await web3Service.contract.methods
        .convertInvestisseurToProjet(idNum, company, market, investAmt, jobs, zone, projStatus)
        .call({ from: account.address });
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: `Revert (simulation): ${e?.data?.reason || e?.message || 'call failed'}`
      });
    }

    // Transaction
    const receipt = await web3Service.sendTransaction(
      'convertInvestisseurToProjet',
      [idNum, company, market, investAmt, jobs, zone, projStatus],
      null,
      privateKey
    );

    // Récupération du projetId via events
    let projetId = null;
    if (receipt.events?.ProjetCreated?.returnValues?.id) {
      projetId = receipt.events.ProjetCreated.returnValues.id.toString();
    } else if (receipt.events?.ProjetCreated?.returnValues?.['0']) {
      projetId = receipt.events.ProjetCreated.returnValues['0'].toString();
    } else if (receipt.events?.InvestisseurConverted?.returnValues?.projetId) {
      projetId = receipt.events.InvestisseurConverted.returnValues.projetId.toString();
    } else if (receipt.events?.InvestisseurConverted?.returnValues?.['1']) {
      projetId = receipt.events.InvestisseurConverted.returnValues['1'].toString();
    }

    res.json({
      success: true,
      data: {
        investisseurId: String(idNum),
        projetId,
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber),
        gasUsed: receipt.gasUsed
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, details: error.details || undefined });
  }
});

module.exports = router;