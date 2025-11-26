const express = require('express');
const router = express.Router();
const web3Service = require('../services/web3Service');

// API key security for non-GET
router.use((req, res, next) => {
  if (req.method === 'GET') return next();
  const expected = process.env.API_KEY;
  if (!expected) return next();
  const provided = req.headers['x-api-key'] || req.query.apiKey;
  if (provided !== expected) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  next();
});

// Helpers
const toUint = v => {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
};

function mapActionStatus(s) {
  if (s === undefined || s === null) return null;
  const v = String(s).trim().toLowerCase();
  if (v === '0' || v === 'planned') return 0;
  if (v === '1' || v === 'executed') return 1;
  if (v === '2' || v === 'canceled' || v === 'cancelled') return 2;
  return null;
}
function actionStatusLabel(n) {
  switch (Number(n)) {
    case 0: return 'Planned';
    case 1: return 'Executed';
    case 2: return 'Canceled';
    default: return 'Unknown';
  }
}

async function ensureContractReady() {
  if (!web3Service.web3) await web3Service.initialize();
  await web3Service.loadContract();
  if (!web3Service.contract) throw new Error('Contract not loaded');
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
      throw new Error('Only owner');
    }
  } catch {
    throw new Error('Owner check failed');
  }
}
async function getActionStruct(id) {
  try {
    const a = await web3Service.callMethod('actions', [id]);
    if (a && Number(a.id) > 0) return a;
  } catch {}
  return null;
}

// Index
router.get('/', (_req, res) => {
  res.json({
    success: true,
    route: 'action',
    endpoints: [
      'POST   /api/action',
      'GET    /api/action/all',
      'GET    /api/action/:actionId',
      'PUT    /api/action/:actionId',
      'PUT    /api/action/:actionId/status',
      'DELETE /api/action/:actionId'
    ]
  });
});

// Create Action (createAction simplified)
router.post('/', async (req, res) => {
  try {
    const {
      nom = '',
      description = '',
      typeAction = '',
      dateDebut,
      ville = '',
      responsableId,
      privateKey: pkIn
    } = req.body || {};

    const dDebut = toUint(dateDebut);
    const respId = toUint(responsableId);
    const privateKey = (pkIn || process.env.DEPLOYER_PRIVATE_KEY || '').trim();

    if (!nom) return res.status(400).json({ success: false, error: 'nom requis' });
    if (dDebut === null) return res.status(400).json({ success: false, error: 'dateDebut invalide' });
    if (!ville) return res.status(400).json({ success: false, error: 'ville requise' });
    if (respId === null) return res.status(400).json({ success: false, error: 'responsableId invalide' });
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey requis' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    // Simulation
    try {
      await web3Service.contract.methods
        .createAction(nom, description, typeAction, dDebut, ville, respId)
        .call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.data?.reason || e?.message || 'call failed'}` });
    }

    const receipt = await web3Service.sendTransaction(
      'createAction',
      [nom, description, typeAction, dDebut, ville, respId],
      null,
      privateKey
    );

    let actionId = null;
    if (receipt.events?.ActionCreated?.returnValues?.id) {
      actionId = receipt.events.ActionCreated.returnValues.id.toString();
    } else if (receipt.events?.ActionCreated?.returnValues?.['0']) {
      actionId = receipt.events.ActionCreated.returnValues['0'].toString();
    }

    res.json({
      success: true,
      data: {
        actionId,
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber),
        gasUsed: receipt.gasUsed
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get all actions
router.get('/all', async (_req, res) => {
  try {
    await ensureContractReady();
    const ids = await web3Service.callMethod('getAllActions', []);
    const seen = new Set();
    const unique = [];
    for (const id of ids) {
      const k = String(id);
      if (!seen.has(k)) { seen.add(k); unique.push(id); }
    }
    const actions = [];
    for (const id of unique) {
      try {
        const a = await getActionStruct(id);
        if (a) {
          actions.push({
            id: a.id?.toString?.() ?? String(id),
            nom: a.nom || '',
            description: a.description || '',
            typeAction: a.typeAction || '',
            dateDebut: a.dateDebut?.toString?.() ?? '',
            ville: a.ville || '',
            statut: a.statut?.toString?.() ?? '0',
            statutLabel: actionStatusLabel(a.statut),
            responsableId: a.responsableId?.toString?.() ?? '0',
            createdAt: a.createdAt?.toString?.() ?? '',
            createdBy: a.createdBy || ''
          });
        }
      } catch (e) {
        console.error('Action fetch error', String(id), e.message);
      }
    }
    actions.sort((a, b) => Number(a.id) - Number(b.id));
    res.json({ success: true, data: { count: actions.length, actions } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get one action
router.get('/:actionId', async (req, res) => {
  try {
    const idNum = toUint(req.params.actionId);
    if (idNum === null) return res.status(400).json({ success: false, error: 'actionId invalide' });

    await ensureContractReady();
    const a = await getActionStruct(idNum);
    if (!a) return res.status(404).json({ success: false, error: 'Action introuvable' });

    res.json({
      success: true,
      data: {
        id: a.id?.toString?.() ?? String(idNum),
        nom: a.nom || '',
        description: a.description || '',
        typeAction: a.typeAction || '',
        dateDebut: a.dateDebut?.toString?.() ?? '',
        ville: a.ville || '',
        statut: a.statut?.toString?.() ?? '0',
        statutLabel: actionStatusLabel(a.statut),
        responsableId: a.responsableId?.toString?.() ?? '0',
        createdAt: a.createdAt?.toString?.() ?? '',
        createdBy: a.createdBy || ''
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update action (updateAction simplified)
router.put('/:actionId', async (req, res) => {
  try {
    const idNum = toUint(req.params.actionId);
    if (idNum === null) return res.status(400).json({ success: false, error: 'actionId invalide' });

    const {
      nom,
      description,
      typeAction,
      dateDebut,
      ville,
      statut,
      status,
      responsableId,
      privateKey: pkIn
    } = req.body || {};

    const privateKey = (pkIn || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey requis' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    const current = await getActionStruct(idNum);
    if (!current) return res.status(404).json({ success: false, error: 'Action introuvable' });

    const newNom = (nom ?? current.nom ?? '').toString();
    const newDesc = (description ?? current.description ?? '').toString();
    const newType = (typeAction ?? current.typeAction ?? '').toString();
    const newDateDebut = toUint(dateDebut ?? current.dateDebut);
    const newVille = (ville ?? current.ville ?? '').toString();
    const statusInput = statut ?? status;
    const newStatut = statusInput !== undefined ? mapActionStatus(statusInput) : Number(current.statut);
    const newResp = toUint(responsableId ?? current.responsableId);

    if (!newNom) return res.status(400).json({ success: false, error: 'nom requis' });
    if (newDateDebut === null) return res.status(400).json({ success: false, error: 'dateDebut invalide' });
    if (!newVille) return res.status(400).json({ success: false, error: 'ville requise' });
    if (newResp === null) return res.status(400).json({ success: false, error: 'responsableId invalide' });
    if (newStatut === null || !Number.isFinite(newStatut)) return res.status(400).json({ success: false, error: 'statut invalide' });

    // Simulation
    try {
      await web3Service.contract.methods
        .updateAction(idNum, newNom, newDesc, newType, newDateDebut, newVille, newStatut, newResp)
        .call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.data?.reason || e?.message || 'call failed'}` });
    }

    const receipt = await web3Service.sendTransaction(
      'updateAction',
      [idNum, newNom, newDesc, newType, newDateDebut, newVille, newStatut, newResp],
      null,
      privateKey
    );

    res.json({
      success: true,
      data: {
        actionId: String(idNum),
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update only status
router.put('/:actionId/status', async (req, res) => {
  try {
    const idNum = toUint(req.params.actionId);
    if (idNum === null) return res.status(400).json({ success: false, error: 'actionId invalide' });

    const { statut, status, privateKey: pkIn } = req.body || {};
    const st = mapActionStatus(statut ?? status);
    const privateKey = (pkIn || process.env.DEPLOYER_PRIVATE_KEY || '').trim();

    if (st === null) return res.status(400).json({ success: false, error: 'statut invalide (Planned|Executed|Canceled ou 0..2)' });
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey requis' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    const current = await getActionStruct(idNum);
    if (!current) return res.status(404).json({ success: false, error: 'Action introuvable' });

    // Simulation
    try {
      await web3Service.contract.methods
        .updateActionStatus(idNum, st)
        .call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.data?.reason || e?.message || 'call failed'}` });
    }

    const receipt = await web3Service.sendTransaction(
      'updateActionStatus',
      [idNum, st],
      null,
      privateKey
    );

    let eventStatus = st.toString();
    if (receipt.events?.ActionStatusUpdated?.returnValues?.status) {
      eventStatus = receipt.events.ActionStatusUpdated.returnValues.status.toString();
    } else if (receipt.events?.ActionStatusUpdated?.returnValues?.['1']) {
      eventStatus = receipt.events.ActionStatusUpdated.returnValues['1'].toString();
    }

    res.json({
      success: true,
      data: {
        actionId: String(idNum),
        statut: eventStatus,
        statutLabel: actionStatusLabel(eventStatus),
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete action
router.delete('/:actionId', async (req, res) => {
  try {
    const idNum = toUint(req.params.actionId);
    const privateKey = (req.body?.privateKey || process.env.DEPLOYER_PRIVATE_KEY || '').trim();
    if (idNum === null) return res.status(400).json({ success: false, error: 'actionId invalide' });
    if (!privateKey) return res.status(400).json({ success: false, error: 'privateKey requis' });

    await ensureContractReady();
    const account = await getAccountFromPk(privateKey);
    await ensureOwnerAccount(account);

    const current = await getActionStruct(idNum);
    if (!current) return res.status(404).json({ success: false, error: 'Action introuvable' });

    // Simulation
    try {
      await web3Service.contract.methods.deleteAction(idNum).call({ from: account.address });
    } catch (e) {
      return res.status(400).json({ success: false, error: `Revert (simulation): ${e?.data?.reason || e?.message || 'call failed'}` });
    }

    const receipt = await web3Service.sendTransaction('deleteAction', [idNum], null, privateKey);

    res.json({
      success: true,
      data: {
        actionId: String(idNum),
        transactionHash: receipt.transactionHash,
        blockNumber: String(receipt.blockNumber)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;