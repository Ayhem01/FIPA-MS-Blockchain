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
const mapProspectStatus = (s) => {
  const v = String(s).toLowerCase();
  if (v === '0' || v === 'nouveau') return 0;
  if (v === '1' || v === 'encours' || v === 'en_cours') return 1;
  if (v === '2' || v === 'qualifie') return 2;
  if (v === '3' || v === 'nonqualifie' || v === 'non_qualifie') return 3;
  if (v === '4' || v === 'converti') return 4;
  if (v === '5' || v === 'perdu') return 5;
  return null;
};
const mapInvestisseurStatus = (s) => {
  const v = String(s).toLowerCase();
  // Actif, Negociation, Engagement, Finalisation, Investi, Suspendu, Inactif
  if (v === '0' || v === 'actif') return 0;
  if (v === '1' || v === 'negociation' || v === 'négociation') return 1;
  if (v === '2' || v === 'engagement') return 2;
  if (v === '3' || v === 'finalisation') return 3;
  if (v === '4' || v === 'investi') return 4;
  if (v === '5' || v === 'suspendu') return 5;
  if (v === '6' || v === 'inactif') return 6;
  return null;
};

// Index
router.get('/', (_req, res) => {
  res.json({
    success: true,
    route: 'prospect',
    endpoints: [
      'POST   /api/prospect',
      'PUT    /api/prospect/:prospectId',
      'PUT    /api/prospect/:prospectId/status',
      'DELETE /api/prospect/:prospectId',
      'GET    /api/prospect/:prospectId',
      'GET    /api/prospect/all',
      'POST   /api/prospect/:prospectId/advance',
      'POST   /api/prospect/:prospectId/convert-investisseur',
      'GET    /api/prospect/:prospectId/tasks',
      'GET    /api/prospect/:prospectId/tasks/stage/:stageId',
      'GET    /api/prospect/:prospectId/progress',
      'GET    /api/prospect/:prospectId/can-convert',
      'GET    /api/prospect/stages'
    ]
  });
});
router.get('/stages', async (_req, res) => {
  try {
    await ensureContractReady();
    const nextId = await web3Service.callMethod('nextStageId', []);
    const stages = [];
    for (let i = 1; i < Number(nextId); i++) {
      try {
        const st = await web3Service.callMethod('pipelineStages', [i]);
        if (st && st.isActive) {
          stages.push({
            id: st.id,
            name: st.name,
            order: st.order,
            isFinal: st.isFinal,
            isActive: st.isActive
          });
        }
      } catch { /* skip */ }
    }
    stages.sort((a, b) => Number(a.order) - Number(b.order));
    res.json({ success: true, data: { count: stages.length, stages } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});



router.get('/all', async (_req, res) => {
  try {
    await ensureContractReady();
    const prospectIds = await web3Service.callMethod('getAllProspects', []);

    // Déduplication
    const seen = new Set();
    const uniqueIds = [];
    for (const id of prospectIds) {
      const key = String(id);
      if (!seen.has(key)) {
        seen.add(key);
        uniqueIds.push(id);
      }
    }

    const prospects = [];
    for (const id of uniqueIds) {
      try {
        const p = await web3Service.callMethod('prospects', [id]);
        if (p && Number(p.id) > 0) {
          prospects.push({
            id: p.id?.toString?.() ?? String(id),
            inviterId: p.inviterId?.toString?.() ?? '0',
            nom: p.nom || '',
            adresse: p.adresse || '',
            valeur_potentielle: p.valeur_potentielle?.toString?.() ?? '0',
            notes_internes: p.notes_internes || '',
            status: p.status?.toString?.() ?? '0',
            createdAt: p.createdAt?.toString?.() ?? '',
            convertedAt: p.convertedAt?.toString?.() ?? '',
            investisseurId: p.investisseurId?.toString?.() ?? '0'
          });
        }
      } catch (err) {
        console.error(`Error fetching prospect ${String(id)}:`, err.message);
      }
    }

    // Tri par id croissant
    prospects.sort((a, b) => Number(a.id) - Number(b.id));

    res.json({ success: true, data: { count: prospects.length, prospects } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// Create a new prospect (onlyOwner) - UPDATED
router.post('/', async (req, res) => {
  try {
    const {
      nom = '',
      adresse = '',
      valeur_potentielle,
      valeurPotentielle,
      notes_internes = '',
      notesInternes = '',
      privateKey: pkIn
    } = req.body || {};

    const privateKey = (pkIn || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
    const valPotRaw = valeur_potentielle ?? valeurPotentielle ?? 0;
    const valPot = toUint(valPotRaw);
    const notes = notes_internes || notesInternes || '';

    if (!nom) return res.status(400).json({ success: false, error: 'nom is required' });
    if (!adresse) return res.status(400).json({ success: false, error: 'adresse is required' });
    if (valPot === null) return res.status(400).json({ success: false, error: 'valeur_potentielle must be a positive integer' });
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey is required' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    // Simulation
    try {
      await web3Service.contract.methods
        .createProspect(nom, adresse, valPot, notes)
        .call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.message || 'call failed'}` });
    }

    // Transaction
    const result = await web3Service.sendTransaction(
      'createProspect',
      [nom, adresse, valPot, notes],
      null,
      privateKey
    );

    // Récupérer l'ID depuis l'event ProspectCreated(id)
    let prospectId;
    if (result.events?.ProspectCreated?.returnValues?.id) {
      prospectId = result.events.ProspectCreated.returnValues.id.toString();
    } else if (result.events?.ProspectCreated?.returnValues?.['0']) {
      prospectId = result.events.ProspectCreated.returnValues['0'].toString();
    }

    res.json({
      success: true,
      data: {
        prospectId,
        transactionHash: result.transactionHash,
        blockNumber: String(result.blockNumber),
        gasUsed: result.gasUsed
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, details: error.details || undefined });
  }
});


// Update prospect (onlyOwner) - conforme à updateProspect Solidity
router.put('/:prospectId', async (req, res) => {
  try {
    const idNum = toUint(req.params.prospectId);
    if (idNum === null) {
      return res.status(400).json({ success: false, error: 'prospectId must be numeric' });
    }

    const {
      nom,
      adresse,
      valeur_potentielle,
      valeurPotentielle,
      notes_internes,
      notesInternes,
      status,
      privateKey: pkIn
    } = req.body || {};

    const privateKey = (pkIn || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey is required' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    // Lire l’état actuel pour compléter les champs manquants
    const current = await web3Service.callMethod('prospects', [idNum]);
    if (!current || Number(current.id) === 0) {
      return res.status(404).json({ success: false, error: 'Prospect not found' });
    }

    // Résolution des champs (fallback sur l’état actuel si non fournis)
    const newNom = (nom ?? current.nom ?? '').toString();
    const newAdresse = (adresse ?? current.adresse ?? '').toString();

    const valPotRaw =
      valeur_potentielle ??
      valeurPotentielle ??
      current.valeur_potentielle ??
      current.valeurPotentielle ??
      null;
    const newValPot = toUint(valPotRaw);

    const newNotes = (notes_internes ?? notesInternes ?? current.notes_internes ?? current.notesInternes ?? '').toString();

    const newStatus =
      status !== undefined ? mapProspectStatus(status) : Number(current.status);

    // Validations
    if (!newNom) return res.status(400).json({ success: false, error: 'nom is required' });
    if (!newAdresse) return res.status(400).json({ success: false, error: 'adresse is required' });
    if (newValPot === null) return res.status(400).json({ success: false, error: 'valeur_potentielle must be a positive integer' });
    if (!Number.isFinite(newStatus)) return res.status(400).json({ success: false, error: 'status must be in {Nouveau, EnCours, Qualifie, NonQualifie, Converti, Perdu} or 0..5' });

    // Simulation
    try {
      await web3Service.contract.methods
        .updateProspect(idNum, newNom, newAdresse, newValPot, newNotes, newStatus)
        .call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.message || 'call failed'}` });
    }

    // Transaction
    const result = await web3Service.sendTransaction(
      'updateProspect',
      [idNum, newNom, newAdresse, newValPot, newNotes, newStatus],
      null,
      privateKey
    );

    res.json({
      success: true,
      data: {
        prospectId: String(idNum),
        transactionHash: result.transactionHash,
        blockNumber: String(result.blockNumber),
        gasUsed: result.gasUsed
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, details: error.details || undefined });
  }
});


// Update prospect status (onlyOwner)
router.put('/:prospectId/status', async (req, res) => {
  try {
    const idNum = toUint(req.params.prospectId);
    const { status, privateKey: pkIn } = req.body || {};
    const privateKey = (pkIn || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
    const statusNum = mapProspectStatus(status);
    if (idNum === null || statusNum === null || !privateKey) {
      return res.status(400).json({
        success: false,
        error: 'status and privateKey are required. status in {Nouveau, EnCours, Qualifie, NonQualifie, Converti, Perdu or 0..5}'
      });
    }
    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);
    try {
      await web3Service.contract.methods.updateProspectStatus(idNum, statusNum).call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.message || 'call failed'}` });
    }
    const result = await web3Service.sendTransaction('updateProspectStatus', [idNum, statusNum], null, privateKey);
    res.json({ success: true, data: { prospectId: String(idNum), transactionHash: result.transactionHash, blockNumber: result.blockNumber } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete prospect (onlyOwner)
router.delete('/:prospectId', async (req, res) => {
  try {
    const idNum = toUint(req.params.prospectId);
    const privateKey = req.body?.privateKey || process.env.DEPLOYER_PRIVATE_KEY;
    if (idNum === null || !privateKey) {
      return res.status(400).json({ success: false, error: 'prospectId and privateKey are required' });
    }

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    // Simulate
    try {
      await web3Service.contract.methods.deleteProspect(idNum).call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.message || 'call failed'}` });
    }

    const result = await web3Service.sendTransaction('deleteProspect', [idNum], null, privateKey);
    res.json({ success: true, data: { prospectId: String(idNum), transactionHash: result.transactionHash, blockNumber: result.blockNumber } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get('/:prospectId', async (req, res) => {
  try {
    const idNum = toUint(req.params.prospectId);
    if (idNum === null) return res.status(400).json({ success: false, error: 'prospectId must be numeric' });

    await ensureContractReady();
    const prospect = await web3Service.callMethod('prospects', [idNum]);
    if (!prospect || Number(prospect.id) === 0) return res.status(404).json({ success: false, error: 'Prospect not found' });

    res.json({
      success: true,
      data: {
        id: prospect.id?.toString?.() ?? String(idNum),
        inviterId: prospect.inviterId?.toString?.() ?? '0',
        nom: prospect.nom || '',
        adresse: prospect.adresse || '',
        valeur_potentielle: prospect.valeur_potentielle?.toString?.() ?? '0',
        notes_internes: prospect.notes_internes || '',
        status: prospect.status?.toString?.() ?? '0',
        createdAt: prospect.createdAt?.toString?.() ?? '',
        convertedAt: prospect.convertedAt?.toString?.() ?? '',
        investisseurId: prospect.investisseurId?.toString?.() ?? '0'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Advance prospect to next stage
router.post('/:prospectId/advance', async (req, res) => {
  try {
    const idNum = toUint(req.params.prospectId);
    const notes = (req.body?.notes ?? '').toString();
    const privateKey = (req.body?.privateKey || process.env.DEPLOYER_PRIVATE_KEY || '').trim();

    // Validate input
    if (idNum === null || !privateKey) {
      return res.status(400).json({ success: false, error: 'prospectId and privateKey are required' });
    }

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);

    // Check if the method exists on the contract ABI
    if (
      !web3Service.contract ||
      !web3Service.contract.methods ||
      typeof web3Service.contract.methods.advanceProspectToNextStage !== 'function'
    ) {
      return res.status(500).json({
        success: false,
        error: 'advanceProspectToNextStage method not found on contract. Check contract ABI and deployment.'
      });
    }

    // Simulate the call to catch any revert reason
    try {
      await web3Service.contract.methods
        .advanceProspectToNextStage(idNum, notes)
        .call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.message || 'call failed'}` });
    }

    // Send the transaction
    const result = await web3Service.sendTransaction(
      'advanceProspectToNextStage',
      [idNum, notes],
      null,
      privateKey
    );

    res.json({
      success: true,
      data: {
        prospectId: String(idNum),
        transactionHash: result.transactionHash,
        blockNumber: result.blockNumber,
        gasUsed: result.gasUsed
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


router.post('/:prospectId/convert-investisseur', async (req, res) => {
  try {
    const idNum = toUint(req.params.prospectId);
    const {
      nom = '',
      montant,
      montant_investissement,
      interets_specifiques = '',
      criteres_investissement = '',
      interetsSpecifiques = '',
      criteresInvestissement = '',
      statut = 'Actif',
      privateKey: pkIn
    } = req.body || {};

    const mont = toUint(montant !== undefined ? montant : montant_investissement);
    const interets = interets_specifiques || interetsSpecifiques || '';
    const criteres = criteres_investissement || criteresInvestissement || '';
    const st = mapInvestisseurStatus(statut);
    const privateKey = (pkIn || process.env.DEPLOYER_PRIVATE_KEY || '').trim();

    if (idNum === null) return res.status(400).json({ success: false, error: 'prospectId invalide' });
    if (!nom) return res.status(400).json({ success: false, error: 'nom requis' });
    if (mont === null) return res.status(400).json({ success: false, error: 'montant invalide' });
    if (st === null) return res.status(400).json({ success: false, error: 'statut invalide (Actif|Negociation|Engagement|Finalisation|Investi|Suspendu|Inactif)' });
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey requis' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    // Vérifier existence et non conversion préalable
    const prospect = await web3Service.callMethod('prospects', [idNum]);
    if (!prospect || Number(prospect.id) === 0) {
      return res.status(404).json({ success: false, error: 'Prospect introuvable' });
    }
    if (Number(prospect.investisseurId || prospect.investorId) > 0) {
      return res.status(400).json({ success: false, error: 'Prospect déjà converti' });
    }

    // Simulation
    try {
      await web3Service.contract.methods
        .convertProspectToInvestisseur(idNum, nom, mont, interets, criteres, st)
        .call({ from: account.address });
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: `Revert (simulation): ${e?.data?.reason || e?.message || 'call failed'}`
      });
    }

    // Transaction
    const receipt = await web3Service.sendTransaction(
      'convertProspectToInvestisseur',
      [idNum, nom, mont, interets, criteres, st],
      null,
      privateKey
    );

    // Récupération de l’investisseurId depuis les events
    let investisseurId = null;
    if (receipt.events?.InvestisseurCreated?.returnValues?.id) {
      investisseurId = receipt.events.InvestisseurCreated.returnValues.id.toString();
    } else if (receipt.events?.InvestisseurCreated?.returnValues?.['0']) {
      investisseurId = receipt.events.InvestisseurCreated.returnValues['0'].toString();
    } else if (receipt.events?.ProspectConverted?.returnValues?.['1']) {
      investisseurId = receipt.events.ProspectConverted.returnValues['1'].toString();
    }

    res.json({
      success: true,
      data: {
        prospectId: String(idNum),
        investisseurId,
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber),
        gasUsed: receipt.gasUsed
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, details: error.details || undefined });
  }
});

// Get prospect tasks (filter off-chain)
router.get('/:prospectId/tasks', async (req, res) => {
  try {
    const idNum = toUint(req.params.prospectId);
    if (idNum === null) return res.status(400).json({ success: false, error: 'prospectId must be numeric' });

    await ensureContractReady();
    const taskIds = await web3Service.callMethod('getAllTasks', []);
    const tasks = [];
    for (const tid of taskIds) {
      try {
        const t = await web3Service.callMethod('tasks', [tid]);
        if (t && String(t.entityType).toLowerCase() === 'prospect' && Number(t.entityId) === idNum) {
          tasks.push({
            id: t.id,
            title: t.title,
            description: t.description,
            start: t.start,
            end: t.end,
            taskType: t.taskType,
            status: t.status,
            priority: t.priority,
            userId: t.userId,
            assigneeId: t.assigneeId,
            entityType: t.entityType,
            entityId: t.entityId,
            pipelineStageId: t.pipelineStageId
          });
        }
      } catch (err) {
        console.error(`Error fetching task ${tid}:`, err.message);
      }
    }
    res.json({ success: true, data: { prospectId: String(idNum), count: tasks.length, tasks } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get prospect tasks for specific stage (filter off-chain)
router.get('/:prospectId/tasks/stage/:stageId', async (req, res) => {
  try {
    const idNum = toUint(req.params.prospectId);
    const stageId = toUint(req.params.stageId);
    if (idNum === null || stageId === null) return res.status(400).json({ success: false, error: 'prospectId and stageId must be numeric' });

    await ensureContractReady();
    const taskIds = await web3Service.callMethod('getAllTasks', []);
    const tasks = [];
    for (const tid of taskIds) {
      try {
        const t = await web3Service.callMethod('tasks', [tid]);
        if (t && String(t.entityType).toLowerCase() === 'prospect' && Number(t.entityId) === idNum && Number(t.pipelineStageId) === stageId) {
          tasks.push({
            id: t.id,
            title: t.title,
            description: t.description,
            start: t.start,
            end: t.end,
            taskType: t.taskType,
            status: t.status,
            priority: t.priority,
            userId: t.userId,
            assigneeId: t.assigneeId,
            entityType: t.entityType,
            entityId: t.entityId,
            pipelineStageId: t.pipelineStageId
          });
        }
      } catch (err) {
        console.error(`Error fetching task ${tid}:`, err.message);
      }
    }
    res.json({ success: true, data: { prospectId: String(idNum), stageId: String(stageId), count: tasks.length, tasks } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Progression percentage (computed off-chain)
router.get('/:prospectId/progress', async (req, res) => {
  try {
    const idNum = toUint(req.params.prospectId);
    if (idNum === null) return res.status(400).json({ success: false, error: 'prospectId must be numeric' });

    await ensureContractReady();
    const prospect = await web3Service.callMethod('prospects', [idNum]);
    if (!prospect || Number(prospect.id) === 0) return res.status(404).json({ success: false, error: 'Prospect not found' });

    // Count active stages
    const nextId = await web3Service.callMethod('nextStageId', []);
    const stages = [];
    for (let i = 1; i < Number(nextId); i++) {
      try {
        const st = await web3Service.callMethod('pipelineStages', [i]);
        if (st && st.isActive) stages.push({ id: Number(st.id), order: Number(st.order) });
      } catch { /* skip */ }
    }
    stages.sort((a, b) => a.order - b.order);
    const total = stages.length || 1;

    // Count completed stages from progressions
    let completed = 0;
    for (const st of stages) {
      try {
        const prog = await web3Service.callMethod('progressions', [idNum, st.id]);
        if (prog && prog.completed) completed++;
      } catch { /* skip */ }
    }
    let percent = Math.floor((completed / total) * 100);
    if (prospect.isPipelineCompleted) percent = 100;

    res.json({ success: true, data: { prospectId: String(idNum), progressPercentage: percent } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Can convert (heuristic)
router.get('/:prospectId/can-convert', async (req, res) => {
  try {
    const idNum = toUint(req.params.prospectId);
    if (idNum === null) return res.status(400).json({ success: false, error: 'prospectId must be numeric' });

    await ensureContractReady();
    const p = await web3Service.callMethod('prospects', [idNum]);
    if (!p || Number(p.id) === 0) return res.status(404).json({ success: false, error: 'Prospect not found' });

    const canConvert = Number(p.investorId) === 0;
    res.json({ success: true, data: { prospectId: String(idNum), canConvert } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});





module.exports = router;